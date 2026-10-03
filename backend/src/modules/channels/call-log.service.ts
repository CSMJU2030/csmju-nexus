import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import type { CallStatus } from '../../generated/prisma/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MessagesService, MESSAGE_INCLUDE } from './messages.service.js';

/// เสียงเรียกดังได้นานเท่านี้ก่อนนับเป็น "ไม่ได้รับสาย" — ใกล้เคียง Instagram
///
/// ตั้งผ่าน env ได้ (CALL_RING_TIMEOUT_MS) เพื่อให้ทดสอบไม่ต้องรอจริง
const RING_TIMEOUT_MS = Number(process.env.CALL_RING_TIMEOUT_MS ?? 45_000);

/// สายที่ค้าง RINGING นานกว่านี้ตอนเซิร์ฟเวอร์เริ่มทำงาน = ค้างจากรอบก่อนแน่นอน
///
/// ต้องเผื่อนานกว่าเวลาเรียกมาก เพราะชุดทดสอบ e2e เปิดแอปอีกตัวบนฐานข้อมูล
/// เดียวกับเซิร์ฟเวอร์ dev ที่รันอยู่ — ถ้าเก็บกวาดทุกแถวที่ยังไม่จบ จะไปตัดสาย
/// ที่กำลังดังอยู่จริงบนเซิร์ฟเวอร์อีกตัว
const STALE_RINGING_MS = 10 * 60 * 1000;
const STALE_ONGOING_MS = 12 * 60 * 60 * 1000;

/// สายที่กำลังเกิดขึ้น — เก็บในหน่วยความจำของโพรเซสเดียวกับ socket ที่ส่งสัญญาณโทร
interface LiveCall {
  messageId: string;
  channelId: string;
  sessionId: string;
  callerCoreUserId: string;
  invitees: Set<string>;
  declined: Set<string>;
  answeredAt: Date | null;
  timer: NodeJS.Timeout | null;
}

const keyOf = (sessionId: string, caller: string) => `${sessionId}:${caller}`;

/// บันทึกการโทรในแชท DM / แชทกลุ่มแบบ Instagram
///
/// หนึ่งสาย = หนึ่งข้อความระบบ สร้างตอนเริ่มโทร แล้วอัปเดตตามสัญญาณโทรจาก
/// events.gateway (ring → answer/decline → cancel/timeout/end) · กระจาย
/// `message:new` ตอนสร้าง และ `message:updated` ทุกครั้งที่สถานะเปลี่ยน
///
/// สถานะในฐานข้อมูล: RINGING → ONGOING → ANSWERED · หรือ MISSED / DECLINED / CANCELLED
/// (RINGING/ONGOING คือ "ยังไม่จบ" — response แสดงเป็น MISSED/ANSWERED พร้อม endedAt = null)
@Injectable()
export class CallLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallLogService.name);
  private readonly live = new Map<string, LiveCall>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly bus: RealtimeBus,
  ) {}

  /// ปิดสายที่ค้างจากเซิร์ฟเวอร์รอบก่อน — ไม่งั้นแชทจะขึ้น "กำลังโทร" ตลอดไป
  async onModuleInit(): Promise<void> {
    try {
      const now = Date.now();

      await this.prisma.callLog.updateMany({
        where: { status: 'RINGING', startedAt: { lt: new Date(now - STALE_RINGING_MS) } },
        data: { status: 'MISSED', endedAt: new Date() },
      });

      await this.prisma.$executeRaw`
        UPDATE call_logs
        SET status = 'ANSWERED',
            ended_at = now(),
            duration_sec = GREATEST(0, EXTRACT(EPOCH FROM (now() - answered_at))::int)
        WHERE status = 'ONGOING'
          AND answered_at < ${new Date(now - STALE_ONGOING_MS)}
      `;
    } catch (error) {
      this.logger.warn(
        `ปิดสายที่ค้างไม่สำเร็จ: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const call of this.live.values()) {
      if (call.timer) clearTimeout(call.timer);
    }
  }

  /// ผู้โทรเริ่มเรียก (call:ring) — สร้างบันทึกครั้งแรก ส่วนการเรียกคนเพิ่มใน
  /// สายเดียวกัน (แชทกลุ่ม) แค่เพิ่มคนที่ถูกเรียก ไม่สร้างข้อความใหม่
  async ring(
    caller: CoreHubUser,
    input: { sessionId: string; channelId: string; media: 'AUDIO' | 'VIDEO'; calleeCoreUserId: string },
  ): Promise<string | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: input.channelId },
      select: { kind: true },
    });

    // บันทึกการโทรมีเฉพาะแชทส่วนตัวและแชทกลุ่ม (ห้องเรียนใช้ห้องเสียงแบบเปิดตลอด)
    if (!channel || (channel.kind !== 'DM' && channel.kind !== 'GROUP_DM')) {
      return null;
    }

    const key = keyOf(input.sessionId, caller.coreUserId);
    const current = this.live.get(key);

    if (current) {
      current.invitees.add(input.calleeCoreUserId);

      return current.messageId;
    }

    const existing = await this.prisma.callLog.findUnique({
      where: {
        sessionId_callerCoreUserId: { sessionId: input.sessionId, callerCoreUserId: caller.coreUserId },
      },
    });

    // session เดิมที่จบไปแล้ว = ไม่เรียกซ้ำบนบันทึกเก่า (ห้องเสียงเปิด session ใหม่ทุกสาย)
    if (existing && existing.endedAt) {
      return null;
    }

    const messageId =
      existing?.messageId ??
      (await this.prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            channelId: input.channelId,
            authorCoreUserId: caller.coreUserId,
            content: null,
            clientNonce: `call-${input.sessionId}`,
            callLog: {
              create: {
                channelId: input.channelId,
                sessionId: input.sessionId,
                callerCoreUserId: caller.coreUserId,
                media: input.media,
              },
            },
          },
          select: { id: true },
        });

        return message.id;
      }));

    const call: LiveCall = {
      messageId,
      channelId: input.channelId,
      sessionId: input.sessionId,
      callerCoreUserId: caller.coreUserId,
      invitees: new Set([input.calleeCoreUserId]),
      declined: new Set(),
      answeredAt: existing?.answeredAt ?? null,
      timer: null,
    };

    if (!call.answeredAt) {
      call.timer = setTimeout(() => {
        void this.ringTimeout(input.sessionId, caller.coreUserId);
      }, RING_TIMEOUT_MS);
      call.timer.unref();
    }

    this.live.set(key, call);

    if (!existing) {
      await this.broadcast(caller, messageId, 'message:new');
    }

    return messageId;
  }

  /// ผู้ถูกเรียกรับ/ปฏิเสธ (call:answer) — รับคนแรกพอ สายนับว่า "รับแล้ว"
  /// ปฏิเสธครบทุกคนที่ถูกเรียก = DECLINED
  async answer(
    callee: CoreHubUser,
    input: { sessionId: string; callerCoreUserId: string; accepted: boolean },
  ): Promise<void> {
    const call = this.live.get(keyOf(input.sessionId, input.callerCoreUserId));

    if (!call || !call.invitees.has(callee.coreUserId)) {
      return;
    }

    if (!input.accepted) {
      call.declined.add(callee.coreUserId);

      if (!call.answeredAt && [...call.invitees].every((id) => call.declined.has(id))) {
        await this.finish(call, 'DECLINED');
      }

      return;
    }

    if (call.answeredAt) {
      return;
    }

    call.answeredAt = new Date();

    if (call.timer) {
      clearTimeout(call.timer);
      call.timer = null;
    }

    await this.prisma.callLog.update({
      where: { messageId: call.messageId },
      data: { status: 'ONGOING', answeredAt: call.answeredAt },
    });
    await this.broadcastAs(call, 'message:updated');
  }

  /// ผู้โทรวางก่อนมีคนรับ (call:cancel) = CANCELLED
  async cancel(caller: CoreHubUser, sessionId: string): Promise<void> {
    const call = this.live.get(keyOf(sessionId, caller.coreUserId));

    if (call && !call.answeredAt) {
      await this.finish(call, 'CANCELLED');
    }
  }

  /// วางสาย (call:end) จากฝั่งไหนก็ได้ — รับแล้ว = ANSWERED พร้อมความยาว ·
  /// ยังไม่มีใครรับแล้วผู้โทรวาง = CANCELLED
  async end(user: CoreHubUser, sessionId: string): Promise<void> {
    for (const call of this.live.values()) {
      if (call.sessionId !== sessionId) continue;

      const involved = call.callerCoreUserId === user.coreUserId || call.invitees.has(user.coreUserId);

      if (!involved) continue;

      if (call.answeredAt) {
        await this.finish(call, 'ANSWERED');
      } else if (call.callerCoreUserId === user.coreUserId) {
        await this.finish(call, 'CANCELLED');
      }
    }
  }

  /// แท็บสุดท้ายของผู้ใช้ปิด/หลุด — สายที่เขาโทรอยู่ต้องจบตาม ไม่ค้าง "กำลังโทร"
  async onDisconnect(coreUserId: string): Promise<void> {
    for (const call of this.live.values()) {
      const involved = call.callerCoreUserId === coreUserId || call.invitees.has(coreUserId);

      if (!involved) continue;

      if (call.answeredAt) {
        await this.finish(call, 'ANSWERED');
      } else if (call.callerCoreUserId === coreUserId) {
        await this.finish(call, 'CANCELLED');
      }
    }
  }

  /// เสียงเรียกหมดเวลาโดยไม่มีใครรับ = MISSED + แจ้งเตือน MISSED_CALL
  ///
  /// แจ้งเฉพาะคนที่ถูกเรียกแล้วไม่ได้กดปฏิเสธ (กดปฏิเสธเองไม่ใช่ "พลาด")
  /// การแจ้งเตือนผ่าน NotificationsService จึงเคารพการตั้งค่า messages ของผู้รับ
  async ringTimeout(sessionId: string, callerCoreUserId: string): Promise<void> {
    const call = this.live.get(keyOf(sessionId, callerCoreUserId));

    if (!call || call.answeredAt) {
      return;
    }

    const media = await this.finish(call, 'MISSED');
    const missedBy = [...call.invitees].filter((id) => !call.declined.has(id));

    for (const coreUserId of missedBy) {
      await this.notifications.push({
        coreUserId,
        kind: 'MISSED_CALL',
        refId: call.messageId,
        actorCoreUserId: callerCoreUserId,
        payload: { channelId: call.channelId, messageId: call.messageId, media },
      });
    }
  }

  private async finish(call: LiveCall, status: CallStatus): Promise<string> {
    this.live.delete(keyOf(call.sessionId, call.callerCoreUserId));

    if (call.timer) {
      clearTimeout(call.timer);
      call.timer = null;
    }

    const endedAt = new Date();
    const durationSec =
      status === 'ANSWERED' && call.answeredAt
        ? Math.max(0, Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000))
        : null;

    const row = await this.prisma.callLog.update({
      where: { messageId: call.messageId },
      data: { status, endedAt, durationSec },
      select: { media: true },
    });

    await this.broadcastAs(call, 'message:updated');

    return row.media;
  }

  private async broadcastAs(call: LiveCall, event: 'message:new' | 'message:updated') {
    await this.broadcast(
      { coreUserId: call.callerCoreUserId } as CoreHubUser,
      call.messageId,
      event,
    );
  }

  /// ส่งข้อความรูปเดียวกับ REST ทุกช่อง (รวม callLog) เข้าห้อง
  private async broadcast(
    viewer: CoreHubUser,
    messageId: string,
    event: 'message:new' | 'message:updated',
  ): Promise<void> {
    try {
      const row = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: MESSAGE_INCLUDE,
      });

      if (!row) return;

      const [payload] = await this.messages.present(viewer, [row]);

      this.bus.pushToRoom({ room: row.channelId, event, payload });
    } catch (error) {
      this.logger.warn(
        `กระจายบันทึกการโทรไม่สำเร็จ: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
      );
    }
  }
}
