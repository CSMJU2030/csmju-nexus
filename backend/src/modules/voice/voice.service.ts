import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { userRoom } from '../../common/realtime/events.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import { ChannelsService } from '../channels/channels.service.js';
import {
  IceServerDto,
  JoinVoiceResponseDto,
  MAX_SCREEN_VIEWERS,
  UpdateVoiceStateDto,
  VoiceOccupantsDto,
  VoiceSessionDto,
} from './dto/voice.dto.js';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly bus: RealtimeBus,
  ) {}

  /// คนในห้องเสียงของหลายห้อง — คิวรีเดียว (ห้องที่ไม่มีใครคืน sessionId = null)
  async occupantsOf(channelIds: string[]): Promise<Map<string, VoiceOccupantsDto>> {
    const out = new Map<string, VoiceOccupantsDto>(
      channelIds.map((id) => [id, { channelId: id, sessionId: null, occupants: [] }]),
    );

    if (channelIds.length === 0) return out;

    const rows = await this.prisma.voiceParticipant.findMany({
      where: { leftAt: null, session: { channelId: { in: channelIds }, endedAt: null } },
      orderBy: { joinedAt: 'asc' },
      include: { session: { select: { channelId: true } } },
    });

    for (const row of rows) {
      const entry = out.get(row.session.channelId)!;

      entry.sessionId = row.sessionId;
      entry.occupants.push({
        coreUserId: row.coreUserId,
        muted: row.muted,
        deafened: row.deafened,
        video: row.video,
        sharing: row.sharing,
      });
    }

    return out;
  }

  /// แจ้งสถานะของตัวเอง (ปิดไมค์/ปิดหูฟัง/กล้อง) — แล้วกระจายให้แถบข้างของทุกคนในห้อง
  async updateState(
    user: CoreHubUser,
    sessionId: string,
    dto: UpdateVoiceStateDto,
  ): Promise<VoiceOccupantsDto> {
    const participant = await this.prisma.voiceParticipant.findFirst({
      where: { sessionId, coreUserId: user.coreUserId, leftAt: null },
      select: { id: true, session: { select: { channelId: true } } },
    });

    if (!participant) {
      throw new NotFoundException('คุณไม่ได้อยู่ในห้องเสียงนี้');
    }

    await this.prisma.voiceParticipant.update({
      where: { id: participant.id },
      data: {
        ...(dto.muted !== undefined ? { muted: dto.muted } : {}),
        ...(dto.deafened !== undefined ? { deafened: dto.deafened } : {}),
        ...(dto.video !== undefined ? { video: dto.video } : {}),
      },
    });

    return this.broadcastOccupants(participant.session.channelId);
  }

  /// แชร์จอเริ่ม/หยุด (มาจาก screen:claim / screen:release ใน gateway)
  async setSharing(coreUserId: string, sessionId: string, sharing: boolean): Promise<void> {
    const updated = await this.prisma.voiceParticipant.updateMany({
      where: { sessionId, coreUserId, leftAt: null },
      data: { sharing },
    });

    if (updated.count > 0) {
      const channelId = await this.channelOfSession(sessionId);

      if (channelId) await this.broadcastOccupants(channelId);
    }
  }

  /// ส่ง voice:occupants ถึงห้องส่วนตัวของสมาชิกทุกคน + ห้องของแชทนั้น
  ///
  /// ถึงห้องส่วนตัว ไม่ใช่แค่ห้องของแชท เพราะแถบข้างแบบ Discord แสดงคนในห้องเสียง
  /// ทุกห้องที่เราเป็นสมาชิก โดยไม่ได้เปิดห้องนั้นค้างไว้ · กลืน error เพราะ
  /// การกระจายพลาดต้องไม่ทำให้การเข้า/ออกห้องเสียงล้ม
  async broadcastOccupants(channelId: string): Promise<VoiceOccupantsDto> {
    const payload = (await this.occupantsOf([channelId])).get(channelId)!;

    try {
      const members = await this.prisma.channelMember.findMany({
        where: { channelId },
        select: { coreUserId: true },
        take: 1000,
      });

      this.bus.pushToRoom({ room: channelId, event: 'voice:occupants', payload });

      for (const member of members) {
        this.bus.pushToRoom({ room: userRoom(member.coreUserId), event: 'voice:occupants', payload });
      }
    } catch (error) {
      this.logger.warn(
        `กระจายรายชื่อคนในห้องเสียงไม่สำเร็จ: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
      );
    }

    return payload;
  }

  /// เข้าห้องเสียง — เพดานคนบังคับที่นี่ ไม่ใช่ที่ UI
  ///
  /// ถ้าปล่อยให้ UI เป็นคนคุม คนที่เขียนสคริปต์เรียก API ตรงจะเข้าเกินเพดานได้
  /// แล้วเสียงของทั้งห้องจะขาดโดยที่ไม่มีใครรู้ว่าทำไม
  async join(
    user: CoreHubUser,
    channelId: string,
  ): Promise<JoinVoiceResponseDto> {
    await this.channels.requireMembership(user, channelId);

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
    });

    const session = await this.prisma.$transaction(async (tx) => {
      // ล็อกแถวห้องก่อนทำอะไรทั้งหมด
      //
      // ทรานแซกชันของ Postgres เป็น READ COMMITTED โดยปริยาย ซึ่ง **ไม่ได้**
      // กันสองคำขอที่วิ่งพร้อมกันอ่านภาพเดียวกันแล้วเขียนทับกัน ของเดิมจึงพัง
      // สองแบบ:
      //   1. สองคนกดเข้าห้องพร้อมกัน ต่างก็หา session ที่เปิดอยู่ไม่เจอ
      //      แล้วต่างก็สร้างใหม่ — ได้ห้องเสียงซ้อนกันสองห้องในช่องเดียว
      //      แล้วสองคนนั้นก็ไม่ได้ยินกันเลยทั้งที่ UI บอกว่าอยู่ห้องเดียวกัน
      //   2. ที่นั่งเหลือหนึ่งที่ สองคนอ่านได้ 7/8 เท่ากัน ผ่านด่านทั้งคู่
      //      แล้วเขียนทั้งคู่ — กลายเป็น 9 คนในห้องที่ P2P รับได้ 8
      //
      // ล็อกที่ "ห้อง" ไม่ใช่ที่ session เพราะตอนเริ่มยังไม่มี session ให้ล็อก
      // คำขอเข้าห้องเดียวกันจึงเข้าคิวกัน ส่วนคนละห้องยังขนานกันได้ตามปกติ
      // คอลัมน์ id เป็น text (Prisma แม็ป String @id เป็น TEXT ไม่ใช่ uuid)
      // จึงห้าม cast พารามิเตอร์เป็น ::uuid ไม่งั้นชนชนิดกันทุกคำขอ
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;

      // หา session ที่ยังเปิดอยู่ ถ้าไม่มีก็เปิดใหม่ — ห้องเสียงแบบ always-on
      // คือ "เข้าเมื่อไหร่ก็ได้" ไม่ต้องมีใครกดเริ่ม
      const open = await tx.voiceSession.findFirst({
        where: { channelId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });

      // session ที่ยัง "เปิด" แต่ไม่มีใครอยู่แล้ว = ค้างจาก socket หลุด
      // (leaveAllFor รุ่นก่อนไม่ได้ปิดให้) — ปิดทิ้งแล้วเปิดใหม่ ไม่งั้นสายใหม่
      // ได้ sessionId เดิม แล้ว CallLogService.ring เจอบันทึกการโทรเก่าที่จบไปแล้ว
      // จึงไม่สร้างการ์ดบันทึกการโทรของสายนี้เลย (พบจาก smoke test 2 ต.ค. 2569)
      const stale =
        open !== null &&
        (await tx.voiceParticipant.count({
          where: { sessionId: open.id, leftAt: null },
        })) === 0;

      if (open && stale) {
        await tx.voiceSession.update({
          where: { id: open.id },
          data: { endedAt: new Date() },
        });
      }

      const active =
        open && !stale ? open : await tx.voiceSession.create({ data: { channelId } });

      const present = await tx.voiceParticipant.findMany({
        where: { sessionId: active.id, leftAt: null },
      });

      const alreadyIn = present.find((p) => p.coreUserId === user.coreUserId);

      if (alreadyIn) {
        return active;
      }

      if (present.length >= channel.maxSeats) {
        throw new ConflictException(
          `ห้องเต็มแล้ว (${present.length}/${channel.maxSeats} คน) — ` +
            'ห้องเสียงแบบ P2P รับได้เท่านี้ รอให้มีคนออกก่อน',
        );
      }

      await tx.voiceParticipant.create({
        data: { sessionId: active.id, coreUserId: user.coreUserId },
      });

      return active;
    });

    const state = await this.buildSession(session.id, channel.maxSeats);
    const iceServers = this.iceServers();

    await this.broadcastOccupants(channelId);

    return {
      ...state,
      iceServers: iceServers,
      turnAvailable: iceServers.some((server) =>
        server.urls.some((url) => url.startsWith('turn:')),
      ),
      maxScreenViewers: MAX_SCREEN_VIEWERS,
    };
  }

  async leave(user: CoreHubUser, sessionId: string): Promise<void> {
    const participant = await this.prisma.voiceParticipant.findFirst({
      where: { sessionId, coreUserId: user.coreUserId, leftAt: null },
    });

    if (!participant) {
      return; // ออกซ้ำไม่ถือว่าผิด ให้เงียบ ๆ ผ่านไป
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.voiceParticipant.update({
        where: { id: participant.id },
        data: { leftAt: new Date() },
      });

      const remaining = await tx.voiceParticipant.count({
        where: { sessionId, leftAt: null },
      });

      // คนสุดท้ายออก = ปิด session เพื่อให้สถิติห้องติวอ่านง่าย
      if (remaining === 0) {
        await tx.voiceSession.update({
          where: { id: sessionId },
          data: { endedAt: new Date() },
        });
      }
    });

    const session = await this.prisma.voiceSession.findUnique({
      where: { id: sessionId },
      select: { channelId: true },
    });

    if (session) await this.broadcastOccupants(session.channelId);
  }

  async listActive(
    user: CoreHubUser,
    channelId?: string,
  ): Promise<VoiceSessionDto[]> {
    // เห็นได้เฉพาะห้องที่ตัวเองเป็นสมาชิก — ไม่งั้นจะรู้ว่าใครติวกับใครอยู่
    const memberships = await this.prisma.channelMember.findMany({
      where: {
        coreUserId: user.coreUserId,
        ...(channelId ? { channelId } : {}),
      },
      select: { channelId: true },
    });

    if (memberships.length === 0) {
      return [];
    }

    const sessions = await this.prisma.voiceSession.findMany({
      where: {
        endedAt: null,
        channelId: { in: memberships.map((m) => m.channelId) },
      },
      include: {
        channel: { select: { maxSeats: true } },
        participants: { where: { leftAt: null } },
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      channelId: session.channelId,
      startedAt: session.startedAt.toISOString(),
      participants: session.participants.map((p) => ({
        coreUserId: p.coreUserId,
        joinedAt: p.joinedAt.toISOString(),
      })),
      maxSeats: session.channel.maxSeats,
      seatsTaken: session.participants.length,
    }));
  }

  /// ใช้โดยชั้น Socket.io — ตอบว่าสองคนนี้อยู่ห้องเสียงเดียวกันไหม
  ///
  /// ถ้าไม่เช็ค จะส่ง SDP ไปหาใครก็ได้ในระบบ ซึ่งเป็นทั้งช่องกวนคนอื่น
  /// และช่องให้รู้ IP ของคนอื่น (§9-V5 ของสเปกสถาปัตยกรรม)
  async sharesVoiceSession(
    coreUserIdA: string,
    coreUserIdB: string,
  ): Promise<string | null> {
    const rows = await this.prisma.voiceParticipant.findMany({
      where: {
        leftAt: null,
        coreUserId: { in: [coreUserIdA, coreUserIdB] },
        session: { endedAt: null },
      },
      select: { sessionId: true, coreUserId: true },
    });

    const bySession = new Map<string, Set<string>>();

    for (const row of rows) {
      const set = bySession.get(row.sessionId) ?? new Set<string>();

      set.add(row.coreUserId);
      bySession.set(row.sessionId, set);
    }

    for (const [sessionId, coreUserIds] of bySession) {
      if (coreUserIds.has(coreUserIdA) && coreUserIds.has(coreUserIdB)) {
        return sessionId;
      }
    }

    return null;
  }

  /// ห้องที่ session นี้สังกัด — ใช้ตรวจว่าผู้รับสายเป็นสมาชิกห้องเดียวกันไหม
  async channelOfSession(sessionId: string): Promise<string | null> {
    const session = await this.prisma.voiceSession.findFirst({
      where: { id: sessionId, endedAt: null },
      select: { channelId: true },
    });

    return session?.channelId ?? null;
  }

  async activeSessionOf(coreUserId: string): Promise<string | null> {
    const participant = await this.prisma.voiceParticipant.findFirst({
      where: { coreUserId, leftAt: null, session: { endedAt: null } },
      orderBy: { joinedAt: 'desc' },
      select: { sessionId: true },
    });

    return participant?.sessionId ?? null;
  }

  /// ปิดการเข้าร่วมที่ค้างเมื่อ socket หลุดโดยไม่ได้กดออก
  async leaveAllFor(coreUserId: string): Promise<string[]> {
    const open = await this.prisma.voiceParticipant.findMany({
      where: { coreUserId, leftAt: null },
      select: { id: true, sessionId: true },
    });

    if (open.length === 0) {
      return [];
    }

    await this.prisma.voiceParticipant.updateMany({
      where: { id: { in: open.map((p) => p.id) } },
      data: { leftAt: new Date() },
    });

    const sessionIds = [...new Set(open.map((p) => p.sessionId))];

    // คนสุดท้ายหลุด = ปิด session เหมือนกดออกเอง (ดู leave) — เดิมขาดขั้นนี้
    // session จึงค้างเปิดทั้งที่ว่าง และสายถัดไปในห้องเดียวกันไม่มีบันทึกการโทร
    await this.prisma.voiceSession.updateMany({
      where: {
        id: { in: sessionIds },
        endedAt: null,
        participants: { none: { leftAt: null } },
      },
      data: { endedAt: new Date() },
    });

    const sessions = await this.prisma.voiceSession.findMany({
      where: { id: { in: sessionIds } },
      select: { channelId: true },
    });

    for (const channelId of new Set(sessions.map((s) => s.channelId))) {
      await this.broadcastOccupants(channelId);
    }

    return sessionIds;
  }

  private async buildSession(
    sessionId: string,
    maxSeats: number,
  ): Promise<VoiceSessionDto> {
    const session = await this.prisma.voiceSession.findUnique({
      where: { id: sessionId },
      include: { participants: { where: { leftAt: null } } },
    });

    if (!session) {
      throw new NotFoundException('ไม่พบห้องเสียงนี้');
    }

    return {
      id: session.id,
      channelId: session.channelId,
      startedAt: session.startedAt.toISOString(),
      participants: session.participants.map((p) => ({
        coreUserId: p.coreUserId,
        joinedAt: p.joinedAt.toISOString(),
      })),
      maxSeats: maxSeats,
      seatsTaken: session.participants.length,
    };
  }

  /// STUN ฟรีพอสำหรับผู้ใช้ส่วนใหญ่ แต่ TURN จำเป็นสำหรับคนที่อยู่หลัง NAT
  /// แบบที่เจาะไม่ได้ ซึ่งพบบ่อยในเน็ตมหาลัยและเน็ตมือถือ
  ///
  /// ถ้าไม่ตั้ง TURN_URL ระบบยังทำงานได้ แต่จะมีคนกลุ่มหนึ่งเชื่อมไม่ติดเลย
  /// และหน้าบ้านต้องบอกผู้ใช้ตรง ๆ ว่าทำไม (turnAvailable = false)
  /// เปิดเป็น public เพราะหน้าบ้านต้องใช้ชุดเดียวกันตอนตรวจเครือข่าย
  ///
  /// ถ้าให้หน้าบ้าน hardcode รายการเอง ผลตรวจจะไม่ตรงกับการโทรจริงทันที
  /// ที่ผู้ดูแลเปลี่ยนค่า TURN — แล้วตัวตรวจก็จะโกหกผู้ใช้
  iceServers(): IceServerDto[] {
    // STUN หลายเจ้า ไม่ใช่เจ้าเดียว — ทั้งหมดใช้ฟรี ไม่ต้องสมัคร
    //
    // STUN ทำหน้าที่เดียวคือบอกเราว่า "จากข้างนอกมองเข้ามา ไอพีและพอร์ตของ
    // คุณคืออะไร" ถ้าเจ้าเดียวล่มหรือถูกไฟร์วอลล์ของมหาลัยบล็อก การโทรจะ
    // ล้มทั้งหมด การใส่หลายเจ้าจากคนละองค์กรจึงเป็นการกระจายความเสี่ยง
    // ที่ไม่มีค่าใช้จ่ายเลย เบราว์เซอร์จะลองทุกตัวขนานกันแล้วใช้ตัวที่ตอบก่อน
    const servers: IceServerDto[] = [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun.cloudflare.com:3478',
        ],
      },
    ];

    const turnUrl = process.env.TURN_URL;

    if (turnUrl) {
      servers.push({
        urls: turnUrl.split(',').map((url) => url.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    } else {
      this.logger.warn(
        'ไม่ได้ตั้ง TURN_URL — ผู้ใช้หลัง NAT ที่เจาะไม่ได้จะเชื่อมเสียงไม่ติด',
      );
    }

    return servers;
  }
}
