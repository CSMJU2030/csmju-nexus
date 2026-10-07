import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Request } from 'express';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { CoreHubTokenVerifier } from '../../auth/core-hub-token.verifier.js';
import { extractToken } from '../../auth/core-hub-jwt.guard.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import {
  REALTIME_PATH,
  SOCKET_NAMESPACE,
  SYNC_ROOM,
  userRoom,
  type JoinResult,
  type MessageEvent,
  type RtcSignalPayload,
  type ScreenClaimResult,
  type SendMessagePayload,
  type SendResult,
} from '../../common/realtime/events.js';
import { CallLogService } from '../channels/call-log.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MAX_SCREEN_VIEWERS } from '../voice/dto/voice.dto.js';
import { VoiceService } from '../voice/voice.service.js';
import { MessagesService } from '../channels/messages.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeTicketsService } from './realtime-tickets.service.js';

/// เขียน "ออนไลน์ล่าสุด" ระหว่างที่ยังต่ออยู่ได้ไม่ถี่กว่านี้ต่อคน
///
/// heartbeat จากทุกแท็บของทุกคนเขียนฐานข้อมูลทุกครั้งไม่ได้ — ห้าแท็บ ×
/// ทุก 30 วินาที × ทั้งคณะคือการเขียนหลักพันต่อนาทีเพื่อค่าที่ต้องแม่นแค่หลักนาที
const LAST_ACTIVE_THROTTLE_MS = 60_000;

/// จำกัดอัตราการส่งข้อความต่อ socket — กันสแปมห้องและกันคนเขียน bot ยิงรัว
const RATE_LIMIT_MESSAGES = 20;
const RATE_LIMIT_WINDOW_MS = 10_000;

interface SocketState {
  user: CoreHubUser;
  /// เวลาที่ส่งข้อความล่าสุด ใช้ทำ sliding window แบบง่าย
  sentAt: number[];
  /// ห้องที่ socket นี้อยู่ ณ ตอนที่กำลังจะหลุด
  ///
  /// ต้องจำไว้เองเพราะ `socket.rooms` ว่างแล้วตอน handleDisconnect ทำงาน
  /// (รายละเอียดอยู่ที่ handleConnection)
  roomsAtDisconnect: string[];
}

/// event ของห้องที่ทำให้รายการแชทของสมาชิกเปลี่ยน (ข้อความล่าสุด · ยังไม่อ่าน · ชื่อห้อง · สมาชิก)
const INBOX_EVENTS = new Set([
  'message:new',
  'message:deleted',
  'message:updated',
  'channel:updated',
  'channel:deleted',
  'channel:members',
]);

/// Socket.io อยู่ในโพรเซสเดียวกับ REST ได้เพราะ NestJS เป็นเซิร์ฟเวอร์ที่รันค้าง
/// ต่างจาก Next.js บน Vercel ที่เป็น serverless จึงถือ WebSocket ไม่ได้
///
/// ข้อจำกัดที่ต้องรู้: presence และ rate limit เก็บในหน่วยความจำของโพรเซสนี้
/// ถ้าสเกลเป็นหลาย instance ต้องเพิ่ม Redis adapter ของ Socket.io
@WebSocketGateway({
  namespace: SOCKET_NAMESPACE,
  // เบราว์เซอร์ต่อผ่าน rewrite ของหน้าเว็บที่ path นี้ (โดเมนเดียวกัน) — บน server api ไม่เปิดออกนอก
  // long-polling ผ่าน HTTP ใช้ได้เสมอ · WebSocket ใช้ได้เมื่อ reverse proxy ส่ง Upgrade ของ path นี้มาที่ api
  path: REALTIME_PATH,
  addTrailingSlash: false,
  // ต่ำกว่า timeout ของ proxy ใน Next (30 วินาที) ไม่ให้ long-polling ถูกตัดกลางทาง
  pingInterval: 20_000,
  pingTimeout: 20_000,
  cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? true },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private readonly sockets = new Map<string, SocketState>();

  /// จำนวน socket ที่เปิดอยู่ต่อผู้ใช้หนึ่งคน
  ///
  /// นับ ไม่ใช่เก็บเป็น Set ของ coreUserId เพราะคนหนึ่งเปิดได้หลายแท็บ —
  /// ถ้าใช้ Set แล้วลบตอนแท็บใดแท็บหนึ่งปิด เขาจะกลายเป็นออฟไลน์ทั้งที่
  /// ยังเปิดอีกแท็บอยู่ ซึ่งเป็นบั๊ก presence ที่พบบ่อยที่สุด
  private readonly socketsPerUser = new Map<string, number>();

  /// ใครกำลังแชร์หน้าจอในแต่ละห้องเสียง — หนึ่งห้องได้คนเดียว
  private readonly presenters = new Map<string, string>();

  constructor(
    private readonly tickets: RealtimeTicketsService,
    private readonly verifier: CoreHubTokenVerifier,
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
    private readonly voice: VoiceService,
    private readonly bus: RealtimeBus,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly calls: CallLogService,
  ) {}

  /// บันทึกการโทรพลาดต้องไม่ทำให้สัญญาณโทรล้ม — สายสำคัญกว่าบันทึก
  private async logCall(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(
        `บันทึกการโทรไม่สำเร็จ: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
      );
    }
  }

  /// ครั้งล่าสุดที่เขียน lastActiveAt ของแต่ละคน (ตัวกันเขียนถี่)
  private readonly lastActiveWrittenAt = new Map<string, number>();

  /// บันทึก "ออนไลน์ล่าสุด" — กลืน error เพราะ presence พลาดไม่ควรทำให้ socket ล้ม
  private async touchLastActive(coreUserId: string, force = false): Promise<void> {
    const now = Date.now();
    const last = this.lastActiveWrittenAt.get(coreUserId) ?? 0;

    if (!force && now - last < LAST_ACTIVE_THROTTLE_MS) {
      return;
    }

    this.lastActiveWrittenAt.set(coreUserId, now);

    try {
      await this.prisma.subsystemMember.upsert({
        where: { coreUserId },
        update: { lastActiveAt: new Date(now) },
        create: { coreUserId, lastActiveAt: new Date(now) },
      });
    } catch (error) {
      this.logger.warn(
        `บันทึกออนไลน์ล่าสุดของ ${coreUserId} ไม่สำเร็จ: ${
          error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'
        }`,
      );
    }
  }

  /// ผู้ใช้ปิดสถานะกิจกรรมไว้ไหม — ถ้าปิด ไม่กระจาย presence:changed ของเขา
  private async hidesActivity(coreUserId: string): Promise<boolean> {
    try {
      const member = await this.prisma.subsystemMember.findUnique({
        where: { coreUserId },
        select: { showActivityStatus: true },
      });

      return member?.showActivityStatus === false;
    } catch {
      return false;
    }
  }

  /// ยืนยันตัวตนตอนจับมือ — สองทาง ทั้งคู่ตรวจของจริง
  ///
  ///   1. token ของ Core Hub ที่มากับ handshake (คุกกี้ที่เบราว์เซอร์แนบเอง
  ///      หรือ `auth.token` ที่ client ส่งมา) ตรวจลายเซ็นด้วย JWKS ชุดเดียว
  ///      กับฝั่ง HTTP
  ///   2. ตั๋วอายุสั้นที่ขอมาทาง REST ก่อนหน้า
  ///
  /// เดิมทาง 1 คือ "เชื่อ header X-User-Id ที่ Gateway แนบมา" ซึ่งแปลว่าใคร
  /// เปิด WebSocket ตรงเข้าหลังบ้านแล้วใส่ header เองก็เป็นใครก็ได้ทันที
  ///
  /// ทำเป็น middleware ไม่ใช่ทำใน handleConnection เพราะ middleware ปฏิเสธได้
  /// "ก่อน" การเชื่อมต่อจะสำเร็จ ทำให้ client ได้ connect_error ที่อ่านรู้เรื่อง
  /// ถ้าไปเตะออกใน handleConnection client จะเห็นว่าต่อติดแล้วหลุดเอง
  /// ซึ่งแยกไม่ออกจากเน็ตมีปัญหา
  afterInit(server: Server): void {
    server.use((socket, next) => {
      // ตรวจลายเซ็นต้องรอ I/O (อาจต้องดึง JWKS) middleware จึงเป็น async
      //
      // ใช้ .then/.catch ไม่ใช่ callback แบบ async เพราะ socket.io ไม่รอ
      // Promise ที่ callback คืนมา — เขียนเป็น async แล้ว throw จะกลายเป็น
      // unhandled rejection และการเชื่อมต่อจะค้างแทนที่จะถูกปฏิเสธ
      this.identify(socket as Socket)
        .then((user) => {
          this.sockets.set(socket.id, {
            user,
            sentAt: [],
            roomsAtDisconnect: [],
          });
          next();
        })
        .catch((error: unknown) => {
          next(
            error instanceof Error ? error : new Error('ยืนยันตัวตนไม่สำเร็จ'),
          );
        });
    });

    // รับเหตุการณ์จากชั้นข้อมูลผ่าน bus — ฝั่งนั้นไม่รู้จัก gateway นี้เลย
    // (ดูเหตุผลเรื่องวงจร import ใน common/realtime/realtime-bus.ts)
    // ออกจากห้องผ่าน REST แล้ว socket ต้องออกตามด้วย
    this.bus.evictions.subscribe((eviction) => {
      for (const [socketId, state] of this.sockets) {
        if (state.user.coreUserId !== eviction.coreUserId) {
          continue;
        }

        void server.in(socketId).socketsLeave(eviction.room);
      }

      void this.broadcastPresence(eviction.room);
    });

    this.bus.userEvents.subscribe((push) => {
      server.to(userRoom(push.coreUserId)).emit('notification:new', {
        notification: push.notification,
        unreadCount: push.unreadCount,
      });
    });

    this.bus.roomEvents.subscribe((event) => {
      server.to(event.room).emit(event.event, event.payload);
      if (INBOX_EVENTS.has(event.event)) this.pingInbox(event.room);
    });

    // ซิงก์ทั้งเว็บ — ไม่มีเนื้อหา มีแค่หัวข้อ (ดู common/realtime/sync.interceptor.ts)
    this.bus.syncEvents.subscribe((push) => {
      server.to(push.coreUserId ? userRoom(push.coreUserId) : SYNC_ROOM).emit('sync:changed', { topic: push.topic });
    });
  }

  handleConnection(socket: Socket): void {
    const state = this.sockets.get(socket.id);

    if (!state) {
      return;
    }

    // เข้าห้องส่วนตัวทันทีที่ต่อติด เพื่อรับการแจ้งเตือนได้โดยไม่ต้องเปิดห้องแชทไว้
    void socket.join(userRoom(state.user.coreUserId));
    void socket.join(SYNC_ROOM);

    // จดห้องไว้ตอน 'disconnecting' เพราะตอน 'disconnect' มันว่างไปแล้ว
    //
    // ลำดับจริงใน socket.io (dist/socket.js `_onclose`) คือ
    //   emit('disconnecting') → _cleanup() ซึ่งเรียก leaveAll() → emit('disconnect')
    // ส่วน OnGatewayDisconnect ของ Nest ผูกกับ 'disconnect' ตัวหลัง
    // `socket.rooms` (ซึ่งอ่านจาก adapter.socketRooms) จึงคืน Set ว่างเสมอ
    //
    // ผลของบั๊กนี้: ลูป broadcastPresence ใน handleDisconnect ไม่เคยทำงานเลย
    // คนที่ปิดแท็บหรือเน็ตหลุดยังค้างอยู่ในรายชื่อ "ใครอยู่ในห้อง" ของทุกคน
    socket.on('disconnecting', () => {
      const current = this.sockets.get(socket.id);

      if (current) {
        current.roomsAtDisconnect = [...socket.rooms];
      }
    });

    const before = this.socketsPerUser.get(state.user.coreUserId) ?? 0;

    this.socketsPerUser.set(state.user.coreUserId, before + 1);

    // แจ้งทั้งระบบเฉพาะตอนเปลี่ยนจาก "ไม่มีแท็บเลย" เป็น "มีแท็บแรก"
    // คนที่ปิด "แสดงสถานะกิจกรรม" ไม่ถูกประกาศ (Instagram ก็ไม่บอกใคร)
    if (before === 0) {
      const coreUserId = state.user.coreUserId;

      void this.hidesActivity(coreUserId).then((hidden) => {
        if (!hidden) {
          this.server.emit('presence:changed', { coreUserId, online: true });
        }
      });
    }

    void this.touchLastActive(state.user.coreUserId);

    this.logger.log(`${state.user.coreUserId} เชื่อมต่อแล้ว (${socket.id})`);
  }

  /// ใครออนไลน์อยู่ตอนนี้ — ให้ชั้น REST เรียกตอนหน้าจอโหลดครั้งแรก
  ///
  /// ต้องมีทั้ง REST และ event: event บอกการเปลี่ยนแปลง แต่ผู้ใช้ที่เพิ่ง
  /// เปิดหน้าไม่เคยได้ยิน event ของคนที่ออนไลน์อยู่ก่อนแล้ว
  onlineCoreUserIds(): string[] {
    return [...this.socketsPerUser.entries()]
      .filter(([, count]) => count > 0)
      .map(([coreUserId]) => coreUserId);
  }

  handleDisconnect(socket: Socket): void {
    const state = this.sockets.get(socket.id);

    this.sockets.delete(socket.id);

    if (!state) {
      return;
    }

    const remaining = (this.socketsPerUser.get(state.user.coreUserId) ?? 1) - 1;

    if (remaining <= 0) {
      const coreUserId = state.user.coreUserId;

      this.socketsPerUser.delete(coreUserId);
      // แท็บสุดท้ายปิด = เวลานี้คือ "ออนไลน์ล่าสุด" จริง จึงเขียนทันทีไม่รอ throttle
      void this.touchLastActive(coreUserId, true);
      void this.hidesActivity(coreUserId).then((hidden) => {
        if (!hidden) {
          this.server.emit('presence:changed', { coreUserId, online: false });
        }
      });
    } else {
      this.socketsPerUser.set(state.user.coreUserId, remaining);
    }

    // ปิดแท็บทิ้งโดยไม่กดออกจากห้องเสียง = ที่นั่งค้าง ทำให้ห้องเต็มทั้งที่ไม่มีคน
    //
    // ปล่อยที่นั่งเฉพาะเมื่อไม่มีแท็บเหลือแล้ว ไม่งั้นปิดแท็บที่ไม่ได้อยู่ใน
    // สายจะเตะตัวเองออกจากสายที่คุยอยู่ในอีกแท็บ
    if (remaining <= 0) {
      void this.releaseVoice(state.user.coreUserId);
      // ปิดแท็บสุดท้ายระหว่างโทร = วางสาย (ไม่งั้นบันทึกค้าง "กำลังโทร")
      void this.logCall(() => this.calls.onDisconnect(state.user.coreUserId));
    }

    // แจ้งทุกห้องที่ socket นี้อยู่ ว่ามีคนออกไปแล้ว
    const personalRoom = userRoom(state.user.coreUserId);

    for (const room of state.roomsAtDisconnect) {
      // ข้ามห้องส่วนตัว — มันไม่ใช่ห้องแชท จึงไม่มี presence ให้กระจาย
      if (room !== socket.id && room !== personalRoom) {
        void this.broadcastPresence(room);
      }
    }
  }

  /// heartbeat ระหว่างเปิดแอปค้างไว้ — ให้ "ออนไลน์ล่าสุด" สดแม้ socket ไม่หลุด
  /// (ถ้าเครื่องดับกะทันหัน disconnect อาจมาช้ามาก) เขียนไม่ถี่กว่าหนึ่งนาทีต่อคน
  @SubscribeMessage('presence:heartbeat')
  onHeartbeat(@ConnectedSocket() socket: Socket): { ok: boolean } {
    const state = this.sockets.get(socket.id);

    if (!state) {
      return { ok: false };
    }

    void this.touchLastActive(state.user.coreUserId);

    return { ok: true };
  }

  @SubscribeMessage('channel:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channelId?: string },
  ): Promise<JoinResult> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.channelId) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    try {
      // เช็คสมาชิกด้วยตรรกะชุดเดียวกับ REST — ไม่เขียนกฎซ้ำสองที่
      await this.channels.requireMembership(state.user, payload.channelId);
    } catch {
      return { ok: false, error: 'คุณไม่ได้เป็นสมาชิกห้องนี้' };
    }

    await socket.join(payload.channelId);
    await this.broadcastPresence(payload.channelId);

    return {
      ok: true,
      latestSeq: await this.messages.latestSeq(payload.channelId),
    };
  }

  @SubscribeMessage('channel:leave')
  async onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channelId?: string },
  ): Promise<void> {
    if (!payload?.channelId) {
      return;
    }

    await socket.leave(payload.channelId);
    await this.broadcastPresence(payload.channelId);
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<SendResult> {
    const state = this.sockets.get(socket.id);
    const nonce = payload?.clientNonce ?? '';

    if (!state) {
      return { ok: false, clientNonce: nonce, error: 'ยังไม่ได้ยืนยันตัวตน' };
    }

    if (!this.allowSend(state)) {
      return {
        ok: false,
        clientNonce: nonce,
        error: 'ส่งข้อความถี่เกินไป รอสักครู่แล้วลองใหม่',
      };
    }

    try {
      // ตัวตนมาจาก state ของ socket ที่ยืนยันตอนจับมือ
      // ไม่ใช่จาก payload — ถ้าเชื่อ payload ใครก็ส่งข้อความในนามคนอื่นได้
      const message = await this.messages.send(
        state.user,
        payload.channelId,
        {
          content: payload.content,
          assetIds: payload.assetIds,
          embed: payload.embed,
          parentId: payload.parentId,
          replyToMessageId: payload.replyToMessageId,
          clientNonce: payload.clientNonce,
        },
      );

      // เขียนฐานข้อมูลสำเร็จแล้วค่อยกระจาย — ลำดับนี้ห้ามสลับ
      this.server.to(payload.channelId).emit('message:new', message);
      this.pingInbox(payload.channelId);

      // คำตอบในเธรดไม่ขึ้นไทม์ไลน์หลัก แต่ต้องบอกให้ตัวเลข "n คำตอบ"
      // ที่ข้อความต้นเธรดขยับ ไม่งั้นคนที่เปิดห้องอยู่จะไม่รู้ว่ามีคนตอบ
      if (message.parentId) {
        this.server.to(payload.channelId).emit('thread:updated', {
          channelId: payload.channelId,
          parentId: message.parentId,
        });
      }

      return {
        ok: true,
        clientNonce: message.clientNonce,
        messageId: message.id,
        seq: message.seq,
      };
    } catch (error) {
      return {
        ok: false,
        clientNonce: nonce,
        error:
          error instanceof Error ? error.message : 'ส่งข้อความไม่สำเร็จ',
      };
    }
  }

  @SubscribeMessage('typing:start')
  onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channelId?: string },
  ): void {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.channelId || !socket.rooms.has(payload.channelId)) {
      return;
    }

    socket.to(payload.channelId).emit('typing:sync', {
      channelId: payload.channelId,
      coreUserId: state.user.coreUserId,
    });
  }

  /// ส่งต่อสัญญาณ WebRTC ระหว่างสองเบราว์เซอร์
  ///
  /// เซิร์ฟเวอร์ไม่แตะเสียงหรือภาพเลย ทำหน้าที่แค่พาสองฝ่ายมาเจอกัน
  /// เงื่อนไขเดียวที่ยอมส่งต่อคือ "สองคนนี้อยู่ห้องเสียงเดียวกันจริง"
  /// ถ้าไม่เช็ค จะยิง SDP ไปหาใครก็ได้ในระบบ ซึ่งเป็นทั้งช่องกวนคนอื่น
  /// และช่องให้รู้ IP ของคนอื่น
  @SubscribeMessage('rtc:signal')
  async onRtcSignal(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: RtcSignalPayload,
  ): Promise<{ ok: boolean; error?: string }> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.toCoreUserId) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    if (payload.toCoreUserId === state.user.coreUserId) {
      return { ok: false, error: 'ส่งสัญญาณหาตัวเองไม่ได้' };
    }

    const sessionId = await this.voice.sharesVoiceSession(
      state.user.coreUserId,
      payload.toCoreUserId,
    );

    if (!sessionId) {
      return { ok: false, error: 'ปลายทางไม่ได้อยู่ในห้องเสียงเดียวกับคุณ' };
    }

    let delivered = false;

    for (const [socketId, other] of this.sockets) {
      if (other.user.coreUserId !== payload.toCoreUserId) {
        continue;
      }

      this.server.to(socketId).emit('rtc:signal', {
        ...payload,
        fromCoreUserId: state.user.coreUserId,
      });
      delivered = true;
    }

    return delivered
      ? { ok: true }
      : { ok: false, error: 'ปลายทางไม่ได้ออนไลน์อยู่' };
  }

  /// จับจองสิทธิ์แชร์หน้าจอ — หนึ่งห้องแชร์ได้ทีละคน
  ///
  /// เหตุผลไม่ใช่เรื่อง UI แต่เป็นเรื่องแบนด์วิดท์: mesh ทำให้คนแชร์ต้องส่ง
  /// ภาพให้ทุกคนพร้อมกัน ถ้าสองคนแชร์พร้อมกันเน็ตของทั้งห้องจะพัง
  @SubscribeMessage('screen:claim')
  async onScreenClaim(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { sessionId?: string },
  ): Promise<ScreenClaimResult> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.sessionId) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    const mySession = await this.voice.activeSessionOf(state.user.coreUserId);

    if (mySession !== payload.sessionId) {
      return { ok: false, error: 'คุณไม่ได้อยู่ในห้องเสียงนี้' };
    }

    const current = this.presenters.get(payload.sessionId);

    if (current && current !== state.user.coreUserId) {
      // **สิทธิ์ค้างของคนที่ออกไปแล้ว ต้องยึดคืนได้**
      //
      // ตัวปลดสิทธิ์ตอน socket หลุดดูจากแถวผู้เข้าร่วมที่ยังเปิดอยู่ ถ้าคนแชร์
      // กดออกจากห้องก่อน (ซึ่งปิดแถวนั้นไปแล้ว) แล้วค่อยปิดแท็บ ตัวปลดจะหา
      // ไม่เจอ สิทธิ์จึงค้างอยู่ในแมปนี้ **ตลอดไป** และทั้งห้องจะแชร์จอไม่ได้
      // อีกเลยจนกว่าจะรีสตาร์ตหลังบ้าน โดยไม่มีใครรู้ว่าเพราะอะไร
      //
      // ฝั่งหน้าบ้านปิดทางนั้นไปแล้ว แต่ยังมีทางอื่นที่คืนสิทธิ์ไม่ทัน เช่น
      // เน็ตหลุดตอนกำลังแชร์ จึงต้องมีตัวกันไว้ตรงนี้อีกชั้น: ถ้าคนที่ถือ
      // สิทธิ์อยู่ไม่ได้อยู่ในห้องนี้แล้ว ให้ถือว่าสิทธิ์นั้นหมดอายุ
      const holderStillHere =
        (await this.voice.activeSessionOf(current)) === payload.sessionId;

      if (holderStillHere) {
        return {
          ok: false,
          presenterCoreUserId: current,
          error: 'มีคนกำลังแชร์หน้าจออยู่ รอให้เขาหยุดก่อน',
        };
      }

      this.presenters.delete(payload.sessionId);
    }

    this.presenters.set(payload.sessionId, state.user.coreUserId);
    void this.voice.setSharing(state.user.coreUserId, payload.sessionId, true).catch(() => undefined);
    this.server.emit('screen:changed', {
      sessionId: payload.sessionId,
      presenterCoreUserId: state.user.coreUserId,
    });

    return {
      ok: true,
      presenterCoreUserId: state.user.coreUserId,
      maxViewers: MAX_SCREEN_VIEWERS,
    };
  }

  @SubscribeMessage('screen:release')
  onScreenRelease(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { sessionId?: string },
  ): void {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.sessionId) {
      return;
    }

    if (this.presenters.get(payload.sessionId) === state.user.coreUserId) {
      this.presenters.delete(payload.sessionId);
      this.server.emit('screen:changed', {
        sessionId: payload.sessionId,
        presenterCoreUserId: null,
      });
      void this.voice
        .setSharing(state.user.coreUserId, payload.sessionId, false)
        .catch(() => undefined);
    }
  }

  /// เริ่มโทร — ส่งเสียงกริ่งไปหาอีกฝ่าย
  ///
  /// เดิมระบบมีแต่ "เข้าห้องเสียง" ซึ่งเงียบ ผู้ใช้สองคนต้องนัดกันนอกระบบว่า
  /// ใครจะเข้าตอนไหน ตัวนี้เติมขั้น "ก่อนรับสาย" ที่ขาดไป
  ///
  /// สองด่านที่ต้องผ่าน:
  ///   1. ผู้โทรต้องอยู่ใน session นั้นจริง — ไม่งั้นส่งกริ่งในนามห้องที่ไม่ได้อยู่
  ///   2. ผู้รับต้องเป็นสมาชิกห้องเดียวกัน — ไม่งั้นโทรกวนใครก็ได้ในระบบ
  @SubscribeMessage('call:ring')
  async onCallRing(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    payload: { sessionId?: string; toCoreUserId?: string; media?: 'AUDIO' | 'VIDEO' },
  ): Promise<{ ok: boolean; error?: string }> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.sessionId || !payload?.toCoreUserId) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    if (payload.toCoreUserId === state.user.coreUserId) {
      return { ok: false, error: 'โทรหาตัวเองไม่ได้' };
    }

    const mySession = await this.voice.activeSessionOf(state.user.coreUserId);

    if (mySession !== payload.sessionId) {
      return { ok: false, error: 'คุณไม่ได้อยู่ในห้องเสียงนี้' };
    }

    const channelId = await this.voice.channelOfSession(payload.sessionId);

    if (!channelId) {
      return { ok: false, error: 'ไม่พบห้องเสียงนี้' };
    }

    const isMember = await this.channels.isMember(
      payload.toCoreUserId,
      channelId,
    );

    if (!isMember) {
      // ไม่บอกว่า "เขาไม่ได้อยู่ในห้อง" ตรง ๆ เพราะนั่นคือการยืนยันว่า
      // คนชื่อนี้มีอยู่จริงในระบบให้คนที่เดาชื่อ
      return { ok: false, error: 'โทรหาคนนี้ไม่ได้' };
    }

    const media = payload.media === 'VIDEO' ? 'VIDEO' : 'AUDIO';

    this.server.to(userRoom(payload.toCoreUserId)).emit('call:incoming', {
      sessionId: payload.sessionId,
      channelId: channelId,
      fromCoreUserId: state.user.coreUserId,
      media,
    });

    // บันทึกการโทรในแชท (DM/แชทกลุ่ม) — สร้างตอนเริ่มเรียก อัปเดตต่อตามสัญญาณ
    const sessionId = payload.sessionId;
    const callee = payload.toCoreUserId;

    await this.logCall(() =>
      this.calls.ring(state.user, { sessionId, channelId, media, calleeCoreUserId: callee }),
    );

    // บันทึกไว้ด้วย เพื่อให้เห็นเป็น "สายที่ไม่ได้รับ" ถ้าเขาไม่ได้ออนไลน์
    // (นี่คือที่ที่ NotificationKind.VOICE_INVITE ถูกใช้จริงเป็นครั้งแรก)
    await this.notifications.push({
      coreUserId: payload.toCoreUserId,
      kind: 'VOICE_INVITE',
      refId: payload.sessionId,
      actorCoreUserId: state.user.coreUserId,
      payload: { channelId: channelId },
    });

    return { ok: true };
  }

  /// ทั้งสองฝั่งของสายต้องเป็นสมาชิกห้องของ session นั้นจริง
  ///
  /// `call:ring` มีด่านนี้มาตั้งแต่แรก แต่ `call:answer` และ `call:cancel`
  /// **ไม่มีเลย** — ใครก็ตามที่ล็อกอินอยู่ส่ง
  /// `call:cancel {toCoreUserId: someone}` เพื่อตัดสายที่คนอื่นกำลังเรียกอยู่ได้
  /// หรือส่ง `call:answer {accepted: false}` ให้หน้าจอของเหยื่อขึ้นว่า
  /// อีกฝ่ายปฏิเสธสายทั้งที่เขาไม่ได้ปฏิเสธ
  private async bothInCallChannel(
    fromCoreUserId: string,
    toCoreUserId: string,
    sessionId: string,
  ): Promise<boolean> {
    const channelId = await this.voice.channelOfSession(sessionId);

    if (!channelId) {
      return false;
    }

    const [fromIsMember, toIsMember] = await Promise.all([
      this.channels.isMember(fromCoreUserId, channelId),
      this.channels.isMember(toCoreUserId, channelId),
    ]);

    return fromIsMember && toIsMember;
  }

  /// รับหรือปฏิเสธสาย — ส่งผลกลับให้ผู้โทรรู้ว่าจะต่อสายหรือวาง
  @SubscribeMessage('call:answer')
  async onCallAnswer(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    payload: { sessionId?: string; toCoreUserId?: string; accepted?: boolean },
  ): Promise<void> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.sessionId || !payload?.toCoreUserId) {
      return;
    }

    // ผู้รับสายยังไม่ได้เข้า session ตอนตอบ จึงเช็คได้แค่ว่าทั้งคู่เป็นสมาชิก
    // ห้องเดียวกัน — พอที่จะกันคนนอกไม่ให้ตอบแทนคนอื่น
    const allowed = await this.bothInCallChannel(
      state.user.coreUserId,
      payload.toCoreUserId,
      payload.sessionId,
    );

    if (!allowed) {
      return;
    }

    this.server.to(userRoom(payload.toCoreUserId)).emit('call:answered', {
      sessionId: payload.sessionId,
      fromCoreUserId: state.user.coreUserId,
      accepted: payload.accepted === true,
    });

    const answer = {
      sessionId: payload.sessionId,
      callerCoreUserId: payload.toCoreUserId,
      accepted: payload.accepted === true,
    };

    await this.logCall(() => this.calls.answer(state.user, answer));
  }

  /// ผู้โทรวางก่อนอีกฝ่ายรับ — ให้ฝั่งนั้นเลิกส่งเสียงกริ่ง
  @SubscribeMessage('call:cancel')
  async onCallCancel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { sessionId?: string; toCoreUserId?: string },
  ): Promise<void> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.sessionId || !payload?.toCoreUserId) {
      return;
    }

    // ผู้ยกเลิกคือผู้โทร ซึ่งอยู่ใน session อยู่แล้ว จึงบังคับได้เข้มเท่า
    // call:ring — ถ้าไม่ได้อยู่ในสายนี้ ก็ไม่มีสิทธิ์สั่งให้สายนี้เงียบ
    const mySession = await this.voice.activeSessionOf(state.user.coreUserId);

    if (mySession !== payload.sessionId) {
      return;
    }

    const allowed = await this.bothInCallChannel(
      state.user.coreUserId,
      payload.toCoreUserId,
      payload.sessionId,
    );

    if (!allowed) {
      return;
    }

    this.server.to(userRoom(payload.toCoreUserId)).emit('call:cancelled', {
      sessionId: payload.sessionId,
      fromCoreUserId: state.user.coreUserId,
    });

    const cancelled = payload.sessionId;

    await this.logCall(() => this.calls.cancel(state.user, cancelled));
  }

  /// วางสายที่รับแล้ว — ให้อีกฝั่งเก็บสายตามด้วย
  ///
  /// เดิมไม่มี event นี้เลย: `call:cancel` ถูกส่งเฉพาะตอนที่ยัง "กำลังเรียก"
  /// อยู่ พอสายถูกรับแล้วฝ่ายที่วางก่อนจะเงียบหายไปโดยไม่บอกใคร อีกฝั่ง
  /// ยังเห็นแผงสายค้างอยู่ ตัวนับเวลายังเดิน ไมค์ยังเปิด และที่นั่งในห้อง
  /// ยังถูกจองไว้ จนกว่าเขาจะกดวางเอง
  @SubscribeMessage('call:end')
  async onCallEnd(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { sessionId?: string; toCoreUserId?: string },
  ): Promise<void> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.sessionId || !payload?.toCoreUserId) {
      return;
    }

    const mySession = await this.voice.activeSessionOf(state.user.coreUserId);

    if (mySession !== payload.sessionId) {
      return;
    }

    const allowed = await this.bothInCallChannel(
      state.user.coreUserId,
      payload.toCoreUserId,
      payload.sessionId,
    );

    if (!allowed) {
      return;
    }

    this.server.to(userRoom(payload.toCoreUserId)).emit('call:ended', {
      sessionId: payload.sessionId,
      fromCoreUserId: state.user.coreUserId,
    });

    const ended = payload.sessionId;

    await this.logCall(() => this.calls.end(state.user, ended));
  }

  /// ให้ชั้น REST เรียกเมื่อส่งข้อความผ่าน HTTP เพื่อให้คนที่เปิดห้องอยู่เห็นทันที
  broadcastMessage(channelId: string, message: MessageEvent): void {
    this.server?.to(channelId).emit('message:new', message);
    this.pingInbox(channelId);
  }

  private readonly inboxTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /// รายการแชท/ตัวเลขยังไม่อ่านของ **สมาชิกทุกคน** ขยับทันที แม้ไม่ได้เปิดห้องนั้นอยู่
  /// (event ของห้องถึงเฉพาะคนที่เปิดห้อง) · รวบหลายข้อความในเสี้ยววินาทีเป็นสัญญาณเดียว
  private pingInbox(channelId: string): void {
    if (!this.server || this.inboxTimers.has(channelId)) return;

    this.inboxTimers.set(
      channelId,
      setTimeout(() => {
        this.inboxTimers.delete(channelId);
        void this.prisma.channelMember
          .findMany({ where: { channelId }, select: { coreUserId: true } })
          .then((members) => {
            for (const member of members) {
              this.server.to(userRoom(member.coreUserId)).emit('sync:changed', { topic: 'inbox' });
            }
          })
          .catch(() => undefined);
      }, 250),
    );
  }

  /// ให้ชั้น REST เรียกเมื่อมีข้อความถูกลบ เพื่อให้คนที่เปิดห้องอยู่เห็นทันที
  notifyMessageDeleted(channelId: string, messageId: string): void {
    this.server
      ?.to(channelId)
      .emit('message:deleted', { channelId: channelId, messageId: messageId });
    this.pingInbox(channelId);
  }

  private async releaseVoice(coreUserId: string): Promise<void> {
    const sessionIds = await this.voice.leaveAllFor(coreUserId);

    for (const sessionId of sessionIds) {
      if (this.presenters.get(sessionId) === coreUserId) {
        this.presenters.delete(sessionId);
        this.server.emit('screen:changed', {
          sessionId: sessionId,
          presenterCoreUserId: null,
        });
      }
    }
  }

  private async broadcastPresence(channelId: string): Promise<void> {
    const socketIds = await this.server.in(channelId).allSockets();
    const coreUserIds = new Set<string>();

    for (const id of socketIds) {
      const state = this.sockets.get(id);

      if (state) {
        coreUserIds.add(state.user.coreUserId);
      }
    }

    this.server.to(channelId).emit('presence:sync', {
      channelId: channelId,
      onlineCoreUserIds: [...coreUserIds],
    });
  }

  private allowSend(state: SocketState): boolean {
    const now = Date.now();

    state.sentAt = state.sentAt.filter(
      (at) => now - at < RATE_LIMIT_WINDOW_MS,
    );

    if (state.sentAt.length >= RATE_LIMIT_MESSAGES) {
      return false;
    }

    state.sentAt.push(now);

    return true;
  }

  private async identify(socket: Socket): Promise<CoreHubUser> {
    // `handshake.headers` หน้าตาเหมือน headers ของ express จึงส่งให้ตัวอ่าน
    // token **ตัวเดียวกับฝั่ง HTTP** ได้เลย ไม่ใช่โค้ดที่เขียนเลียนแบบ
    // ซึ่งวันหนึ่งจะเพี้ยนจากกันโดยไม่มีใครรู้
    //
    // client ที่ส่งคุกกี้ข้าม origin ไม่ได้ ส่ง token มาทาง `auth.token` แทน
    const authToken = socket.handshake.auth?.token;
    const headers = {
      ...socket.handshake.headers,
      authorization:
        typeof authToken === 'string' && authToken
          ? `Bearer ${authToken}`
          : socket.handshake.headers.authorization,
    };

    const token = extractToken({ headers } as unknown as Request);

    if (token) {
      const { user } = await this.verifier.verify(token);

      return user;
    }

    // ทาง 2: แลกตั๋วอายุสั้นที่ขอมาทาง REST ก่อนหน้า
    const ticket =
      (socket.handshake.auth?.ticket as string | undefined) ??
      (socket.handshake.query?.ticket as string | undefined);

    return this.tickets.redeem(ticket);
  }
}
