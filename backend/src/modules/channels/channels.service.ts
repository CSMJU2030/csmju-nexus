import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { canAdministerChannel } from '../../common/auth/member-role.js';
import { isStaffLike } from '../../auth/role-mapping.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { callLogView, callPreview } from './call-log.view.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type {
  ChannelRole,
  InboxFolder,
} from '../../generated/prisma/enums.js';
import type { ChannelModel } from '../../generated/prisma/models.js';
import {
  AddMembersDto,
  ChannelResponseDto,
  ClearChannelResponseDto,
  CreateChannelDto,
  CreateDirectChannelDto,
  type InboxView,
  type LastMessageDto,
  MAX_GROUP_DM_MEMBERS,
  toChannelResponse,
  UpdateChannelDto,
  UpdateInboxDto,
} from './dto/channel.dto.js';

/// ใครแก้หรือลบห้องได้ — **จุดเดียวที่ตัดสิน** ทั้ง API และปุ่มบนหน้าจอ
///
///   ผู้สร้างห้อง      ห้องเป็นของเขา
///   ผู้ดูแลห้อง       ถูกตั้งให้ดูแลแทน (เช่นผู้สร้างเรียนจบไปแล้ว)
///   ผู้ดูแลระบบ       จัดการห้องที่ผิดกฎได้
///
/// ต่างจาก `canAdministerChannel` ที่ให้บุคลากรทุกคนเพิ่มสมาชิกได้ —
/// การลบห้องทำลายประวัติแชทของทุกคนในห้องแบบกู้คืนไม่ได้ จึงแคบกว่า
/// อาจารย์ที่เป็นแค่สมาชิกห้องกลุ่มของนักศึกษาไม่ควรลบห้องนั้นทิ้งได้
///
/// ห้อง DM จัดการไม่ได้เลย — ไม่มีเจ้าของ และลบแล้วอีกฝ่ายเสียประวัติด้วย
/// (ถ้าอยากให้หายจากกล่องข้อความของตัวเอง ใช้ "ลบแชท" = POST /channels/:id/clear)
///
/// แชทกลุ่ม (GROUP_DM) ใช้กฎเดียวกับห้องกลุ่ม: ผู้สร้างหรือผู้ดูแลเปลี่ยนชื่อ
/// และลบได้ ส่วนสมาชิกคนอื่น "ออกจากแชท" ได้เสมอผ่าน DELETE /members/me
export function canManageChannel(
  channel: { kind: string; createdByCoreUserId: string | null },
  channelRole: string,
  user: CoreHubUser,
): boolean {
  if (channel.kind === 'DM') return false;

  return (
    channel.createdByCoreUserId === user.coreUserId ||
    channelRole === 'MODERATOR' ||
    user.coreRole === 'admin'
  );
}

/// ห้องที่มีเรื่อง "คำขอข้อความ" และรายชื่อคู่สนทนา
const DIRECT_KINDS: readonly string[] = ['DM', 'GROUP_DM'];

/// แถวสมาชิกของผู้เรียก — ทุกค่าที่ response ต้องใช้ ดึงมาในคิวรีเดียวกับห้อง
const MY_MEMBERSHIP_SELECT = {
  role: true,
  lastReadSeq: true,
  inboxFolder: true,
  inboxPinnedAt: true,
  muted: true,
  clearedAt: true,
  markedUnread: true,
} as const;

interface MyMembership {
  role: ChannelRole;
  lastReadSeq: number;
  inboxFolder: InboxFolder | null;
  inboxPinnedAt: Date | null;
  muted: boolean;
  clearedAt: Date | null;
  markedUnread: boolean;
}

type ChannelRow = ChannelModel & {
  members: MyMembership[];
  _count: { members: number };
};

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
    private readonly blocks: BlocksService,
    private readonly notifications: NotificationsService,
  ) {}

  /// กล่องข้อความของฉัน — ปักหมุดอยู่บนสุด แล้วเรียงตามความเคลื่อนไหวล่าสุด
  ///
  /// **เรียงและแบ่งหน้าที่ฐานข้อมูล** ไม่ใช่ในหน่วยความจำ — เดิมดึงหน้าตาม
  /// เวลาที่สร้างห้องแล้วค่อยเรียงตามข้อความล่าสุด "ภายในหน้านั้น" ห้องเก่าที่
  /// เพิ่งมีคนทักจึงค้างอยู่หน้าสองทั้งที่ควรขึ้นบนสุด พอมีปักหมุดด้วยก็ยิ่งผิด
  ///
  /// ห้องที่ "ลบแชท" ไปแล้วและยังไม่มีข้อความใหม่หลังจากนั้นไม่อยู่ในรายการ —
  /// พอมีข้อความใหม่เข้ามา ห้องจะกลับมาเองเหมือน Instagram
  async listMine(
    user: CoreHubUser,
    query: PaginationQuery,
  ): Promise<Paginated<ChannelResponseDto>> {
    // LATERAL หยิบข้อความล่าสุดหนึ่งแถวต่อห้องจากดัชนี [channelId, seq DESC]
    // เงื่อนไขเดียวกับ lastMessages() — ห้องที่เรียงขึ้นก่อนต้องเป็นห้องเดียวกับ
    // ที่หน้าบ้านเห็น lastMessage ใหม่สุด ไม่งั้นลำดับกับตัวอย่างข้อความจะขัดกัน
    const [page, counted] = await Promise.all([
      this.prisma.$queryRaw<{ channel_id: string }[]>`
        SELECT cm.channel_id
        FROM channel_members cm
        JOIN channels c ON c.id = cm.channel_id
        LEFT JOIN LATERAL (
          SELECT m.created_at
          FROM messages m
          WHERE m.channel_id = cm.channel_id
            AND m.parent_id IS NULL
            AND m.deleted_at IS NULL
          ORDER BY m.seq DESC
          LIMIT 1
        ) last ON true
        WHERE cm.core_user_id = ${user.coreUserId}
          AND (cm.cleared_at IS NULL OR last.created_at > cm.cleared_at)
        ORDER BY cm.inbox_pinned_at DESC NULLS LAST,
                 COALESCE(last.created_at, c.created_at) DESC,
                 c.id DESC
        OFFSET ${query.skip}
        LIMIT ${query.take}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total
        FROM channel_members cm
        LEFT JOIN LATERAL (
          SELECT m.created_at
          FROM messages m
          WHERE m.channel_id = cm.channel_id
            AND m.parent_id IS NULL
            AND m.deleted_at IS NULL
          ORDER BY m.seq DESC
          LIMIT 1
        ) last ON true
        WHERE cm.core_user_id = ${user.coreUserId}
          AND (cm.cleared_at IS NULL OR last.created_at > cm.cleared_at)
      `,
    ]);

    const ids = page.map((row) => row.channel_id);
    const rows = await this.loadForUser(user, ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((row): row is ChannelRow => row !== undefined);

    const items = await this.present(user, ordered);

    return new Paginated(items, query.meta(Number(counted[0]?.total ?? 0)));
  }

  async create(
    user: CoreHubUser,
    dto: CreateChannelDto,
  ): Promise<ChannelResponseDto> {
    // ห้องเรียนประจำวิชาเป็นพื้นที่ทางการ ให้เฉพาะบุคลากร อาจารย์ และ admin สร้าง
    // เดิมกันแค่ student — guest กับ alumni (GUEST เหมือนกัน) จึงสร้างได้ ซึ่ง
    // conformance L2-12 จับได้ตอนรันกับ Core Hub จริงที่มีบัญชี guest
    if (dto.kind === 'COURSE' && !isStaffLike(user.coreRole)) {
      throw new ForbiddenException(
        'ห้องประจำวิชาสร้างได้เฉพาะอาจารย์และบุคลากร — สร้างห้องกลุ่มแทนได้',
      );
    }

    const channel = await this.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          kind: dto.kind,
          name: dto.name,
          courseTag: dto.courseTag ?? null,
          maxSeats: dto.maxSeats ?? 8,
          description: dto.description,
          createdByCoreUserId: user.coreUserId,
          // คนสร้างเป็นผู้ดูแลห้องโดยอัตโนมัติ
          members: {
            create: { coreUserId: user.coreUserId, role: 'MODERATOR' },
          },
        },
      });

      // แผงผู้ดูแลต้องตอบได้ว่าห้องนี้มาจากไหน แม้ห้องจะถูกลบไปแล้ว
      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'channel.create',
          targetKind: 'CHANNEL',
          targetId: created.id,
          metadata: {
            kind: created.kind,
            name: created.name,
            description: created.description,
            course_tag: created.courseTag,
          },
        },
      });

      return created;
    });

    return this.findOne(user, channel.id);
  }

  /// แชทส่วนตัวหรือแชทกลุ่ม จากกล่อง "ข้อความใหม่"
  ///
  /// หนึ่งคน = DM ซึ่งต้องหาห้องเดิมก่อนเสมอ ไม่งั้นสองคนจะมีหลายห้องคุยกันเอง
  /// หลายคน = สร้างแชทกลุ่มใหม่ทุกครั้ง (Instagram ก็ทำแบบนี้ — คนชุดเดียวกัน
  /// มีได้หลายกลุ่มตามเรื่องที่คุย เช่น "งานกลุ่ม" กับ "ไปกินข้าว")
  async createOrFindDirect(
    user: CoreHubUser,
    dto: CreateDirectChannelDto,
  ): Promise<ChannelResponseDto> {
    if (
      (dto.peerCoreUserId === undefined) ===
      (dto.peerCoreUserIds === undefined)
    ) {
      throw new BadRequestException(
        'ส่ง peerCoreUserId (แชทส่วนตัว) หรือ peerCoreUserIds (แชทกลุ่ม) อย่างใดอย่างหนึ่ง',
      );
    }

    const requested = dto.peerCoreUserIds ?? [dto.peerCoreUserId!];
    const peers = [...new Set(requested)].filter(
      (coreUserId) => coreUserId !== user.coreUserId,
    );

    if (peers.length === 0) {
      throw new BadRequestException('สร้างห้องแชทกับตัวเองไม่ได้');
    }

    if (peers.length === 1) {
      return this.findOne(user, await this.ensureDirect(user, peers[0]));
    }

    return this.createGroupDm(user, peers, dto.name ?? null);
  }

  /// id ของห้อง DM กับคนนี้ — หาห้องเดิมก่อน ไม่มีค่อยสร้าง
  ///
  /// ใช้ร่วมกันทั้งปุ่ม "ส่งข้อความ" การส่งต่อ การแชร์ และการตอบสตอรี่ ทุกทางจึง
  /// ผ่านด่านบล็อกเดียวกัน — บล็อกกันแล้ว (ทิศไหนก็ได้) เปิด DM 1:1 ไม่ได้
  async ensureDirect(user: CoreHubUser, peer: string): Promise<string> {
    if (peer === user.coreUserId) {
      throw new BadRequestException('สร้างห้องแชทกับตัวเองไม่ได้');
    }

    if (await this.blocks.isBlockedEither(user.coreUserId, peer)) {
      throw new ForbiddenException('ส่งข้อความหาคนนี้ไม่ได้');
    }

    const existing = await this.prisma.channel.findFirst({
      where: {
        kind: 'DM',
        AND: [
          { members: { some: { coreUserId: user.coreUserId } } },
          { members: { some: { coreUserId: peer } } },
        ],
      },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const channel = await this.prisma.channel.create({
      data: {
        kind: 'DM',
        name: null,
        maxSeats: 2,
        members: {
          create: [
            { coreUserId: user.coreUserId, role: 'MEMBER' },
            { coreUserId: peer, role: 'MEMBER' },
          ],
        },
      },
      select: { id: true },
    });

    return channel.id;
  }

  /// DM 1:1 ที่คู่สนทนาบล็อกกันกับผู้เรียก → 403 · ห้องชนิดอื่นผ่านเสมอ
  ///
  /// แชทกลุ่มไม่ถูกบล็อกตาม Instagram — คนที่บล็อกกันยังอยู่กลุ่มเดียวกันได้
  /// ถ้าตัดแชทกลุ่มด้วย คนหนึ่งคนจะทำให้ทั้งกลุ่มคุยกันไม่ได้
  async assertNotBlockedDirect(user: CoreHubUser, channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        kind: true,
        members: {
          where: { coreUserId: { not: user.coreUserId } },
          select: { coreUserId: true },
          take: 1,
        },
      },
    });

    const peer = channel?.kind === 'DM' ? channel.members[0]?.coreUserId : undefined;

    if (peer && (await this.blocks.isBlockedEither(user.coreUserId, peer))) {
      throw new ForbiddenException('ส่งข้อความหาคนนี้ไม่ได้');
    }
  }

  /// ผู้เรียกต้องเป็นสมาชิกทุกห้องในรายการ — คิวรีเดียว · ขาดห้องไหน = 404 ทั้งชุด
  async assertMemberOfAll(user: CoreHubUser, channelIds: string[]): Promise<void> {
    if (channelIds.length === 0) {
      return;
    }

    const found = await this.prisma.channelMember.count({
      where: { coreUserId: user.coreUserId, channelId: { in: channelIds } },
    });

    if (found !== new Set(channelIds).size) {
      throw new NotFoundException('ไม่พบห้องปลายทางบางห้อง หรือคุณไม่ได้เป็นสมาชิก');
    }
  }

  /// ตั้งชื่อเล่นของสมาชิกคนหนึ่ง "ในห้องนี้" (null = ลบชื่อเล่น)
  ///
  /// Instagram ให้ทุกคนในแชทตั้งชื่อเล่นให้ทุกคนได้ รวมตัวเอง — ชื่อเล่นเป็น
  /// ของห้อง ไม่ใช่ของคน ทุกคนในห้องจึงเห็นชื่อเดียวกัน · เฉพาะ DM และแชทกลุ่ม
  /// ห้องเรียน/ห้องกลุ่มใหญ่ไม่เปิด เพราะการตั้งชื่อให้คนอื่นในห้อง 200 คนคือช่องแกล้งกัน
  async setNickname(
    user: CoreHubUser,
    channelId: string,
    target: string,
    nickname: string | null,
  ): Promise<ChannelResponseDto> {
    await this.requireMembership(user, channelId);

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      select: { kind: true, name: true, description: true },
    });

    if (!DIRECT_KINDS.includes(channel.kind)) {
      throw new BadRequestException('ตั้งชื่อเล่นได้เฉพาะแชทส่วนตัวและแชทกลุ่ม');
    }

    const updated = await this.prisma.channelMember.updateMany({
      where: { channelId, coreUserId: target },
      data: { nickname },
    });

    if (updated.count === 0) {
      throw new NotFoundException('คนนี้ไม่ได้อยู่ในแชทนี้');
    }

    const response = await this.findOne(user, channelId);

    // ทุกคนในห้องต้องเห็นชื่อเล่นใหม่ทันที — event เดียวกับการแก้ชื่อห้อง
    this.bus.pushToRoom({
      room: channelId,
      event: 'channel:updated',
      payload: {
        channelId: channelId,
        name: channel.name,
        description: channel.description,
        nicknames: response.nicknames,
      },
    });

    return response;
  }

  /// "ทำเครื่องหมายว่ายังไม่ได้อ่าน" — ถอยหมุดอ่านไปก่อนข้อความล่าสุดหนึ่งข้อความ
  ///
  /// ตั้งใจเขียนถอยหลังตรงนี้ที่เดียว (markRead ห้ามถอยเสมอ) · ธง markedUnread
  /// ล้างเองเมื่อบันทึกหมุดอ่านครั้งถัดไป ซึ่งคือตอนผู้ใช้เปิดห้องนั้นอีกครั้ง
  async markUnread(
    user: CoreHubUser,
    channelId: string,
  ): Promise<ChannelResponseDto> {
    const membership = await this.requireMembership(user, channelId);

    const last = await this.prisma.message.findFirst({
      where: {
        channelId,
        parentId: null,
        deletedAt: null,
        ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
      },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    if (!last) {
      throw new BadRequestException('ห้องนี้ยังไม่มีข้อความให้ทำเครื่องหมายว่ายังไม่ได้อ่าน');
    }

    await this.prisma.channelMember.update({
      where: { channelId_coreUserId: { channelId, coreUserId: user.coreUserId } },
      data: { lastReadSeq: last.seq - 1, markedUnread: true },
    });

    return this.findOne(user, channelId);
  }

  /// แชทกลุ่ม — ผู้สร้างเป็นผู้ดูแล ไม่บังคับชื่อและวัตถุประสงค์
  ///
  /// ไม่บังคับวัตถุประสงค์เหมือนห้อง GROUP เพราะคนในแชทกลุ่มถูกเลือกมาเองทีละคน
  /// ทุกคนรู้บริบทอยู่แล้ว — กฎนั้นมีไว้สำหรับห้องที่คนถูกเพิ่มเข้ามาทีหลังจากรายชื่อยาว
  private async createGroupDm(
    user: CoreHubUser,
    peers: string[],
    name: string | null,
  ): Promise<ChannelResponseDto> {
    if (peers.length + 1 > MAX_GROUP_DM_MEMBERS) {
      throw new BadRequestException(
        `แชทกลุ่มมีได้ไม่เกิน ${MAX_GROUP_DM_MEMBERS} คนรวมตัวคุณ`,
      );
    }

    const channel = await this.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          kind: 'GROUP_DM',
          name,
          description: null,
          // ห้องเสียงแบบ mesh รับไหวแปดคน (ดู CreateChannelDto.maxSeats)
          maxSeats: 8,
          createdByCoreUserId: user.coreUserId,
          members: {
            create: [
              { coreUserId: user.coreUserId, role: 'MODERATOR' },
              ...peers.map((coreUserId) => ({
                coreUserId,
                role: 'MEMBER' as const,
              })),
            ],
          },
        },
        select: { id: true, name: true },
      });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'channel.create',
          targetKind: 'CHANNEL',
          targetId: created.id,
          metadata: {
            kind: 'GROUP_DM',
            name: created.name,
            member_count: peers.length + 1,
          },
        },
      });

      return created;
    });

    // คนที่ถูกดึงเข้าแชทกลุ่มรู้ตัว (การตั้งค่า groupRequests ปิดได้)
    await this.notifications.pushMany(peers, {
      kind: 'CHANNEL_INVITE',
      refId: channel.id,
      actorCoreUserId: user.coreUserId,
      payload: { channelId: channel.id, kind: 'GROUP_DM', name: channel.name },
    });

    return this.findOne(user, channel.id);
  }

  async findOne(
    user: CoreHubUser,
    channelId: string,
  ): Promise<ChannelResponseDto> {
    const [row] = await this.loadForUser(user, [channelId]);

    if (!row) {
      // ตอบ 404 ไม่ใช่ 403 เพื่อไม่ให้คนนอกรู้ว่าห้องนี้มีอยู่จริง
      throw new NotFoundException('ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก');
    }

    const [response] = await this.present(user, [row]);

    return response;
  }

  /// ห้องหลายห้องพร้อมแถวสมาชิก "ของผู้เรียก" — คิวรีเดียว
  ///
  /// ห้องที่ผู้เรียกไม่ได้เป็นสมาชิกหลุดออกไปเองเพราะเงื่อนไข some
  private loadForUser(
    user: CoreHubUser,
    channelIds: string[],
  ): Promise<ChannelRow[]> {
    if (channelIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.channel.findMany({
      where: {
        id: { in: channelIds },
        members: { some: { coreUserId: user.coreUserId } },
      },
      include: {
        members: {
          where: { coreUserId: user.coreUserId },
          select: MY_MEMBERSHIP_SELECT,
        },
        _count: { select: { members: true } },
      },
    });
  }

  /// แปลงห้องหลายห้องเป็น response — **จำนวนคิวรีคงที่ไม่ขึ้นกับจำนวนห้อง**
  ///
  /// ทุก endpoint ที่คืนห้องผ่านที่นี่ (รายการ รายละเอียด สร้าง แก้) เพื่อให้
  /// แฟ้ม คำขอข้อความ และป้าย "เห็นแล้ว" คำนวณแบบเดียวกันทุกที่ ห้าคิวรีต่อครั้ง:
  ///
  ///   1. ยังไม่อ่าน (groupBy)   2. สมาชิกของ DM/แชทกลุ่ม   3. ข้อความล่าสุด
  ///   4. ผู้เรียกติดตามใครบ้าง   5. ห้องไหนที่ผู้เรียกเคยพิมพ์
  ///
  /// สองอันหลังยิงเฉพาะเมื่อมีห้องที่ "อาจเป็นคำขอข้อความ" เท่านั้น
  private async present(
    user: CoreHubUser,
    rows: ChannelRow[],
  ): Promise<ChannelResponseDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const direct = rows.filter((row) => DIRECT_KINDS.includes(row.kind));

    const voiceIds = rows.filter((row) => row.kind === 'VOICE').map((row) => row.id);

    const [unreadByChannel, directMembers, lastByChannel, occupants] = await Promise.all([
      this.unreadCounts(
        rows.map((row) => ({
          channelId: row.id,
          lastReadSeq: row.members[0]?.lastReadSeq ?? 0,
        })),
      ),
      this.membersOfDirectChannels(direct.map((row) => row.id)),
      this.lastMessages(rows.map((row) => row.id)),
      this.voiceOccupants(voiceIds),
    ]);

    // คนที่ต้องเช็คว่าผู้เรียกติดตามไหม: คู่สนทนาของ DM · ผู้สร้างของแชทกลุ่ม
    // เฉพาะห้องที่ผู้เรียกยังไม่ได้เลือกแฟ้มเอง และมีข้อความแล้ว
    const candidates = new Map<string, string>();

    for (const row of direct) {
      const membership = row.members[0];

      if (membership?.inboxFolder || !lastByChannel.has(row.id)) {
        continue;
      }

      const counterpart =
        row.kind === 'DM'
          ? directMembers.get(row.id)?.find((m) => m.coreUserId !== user.coreUserId)
              ?.coreUserId
          : row.createdByCoreUserId;

      // ผู้สร้างแชทกลุ่มเอง หรือ DM ที่อีกฝ่ายออกไปแล้ว ไม่มีใครให้ "ขอ"
      if (counterpart && counterpart !== user.coreUserId) {
        candidates.set(row.id, counterpart);
      }
    }

    const [followed, spokeIn] = await Promise.all([
      this.followedAmong(user, [...new Set(candidates.values())]),
      this.channelsWhereAuthored(user, [...candidates.keys()]),
    ]);

    return rows.map((row) => {
      const membership = row.members[0];
      const myRole = membership?.role ?? 'MEMBER';
      const members = directMembers.get(row.id) ?? [];
      const peer =
        row.kind === 'DM'
          ? members.find((m) => m.coreUserId !== user.coreUserId) ?? null
          : null;

      const counterpart = candidates.get(row.id);
      const isRequest =
        counterpart !== undefined &&
        !followed.has(counterpart) &&
        !spokeIn.has(row.id);

      const inbox: InboxView = {
        folder: membership?.inboxFolder ?? (isRequest ? 'REQUEST' : 'PRIMARY'),
        pinnedAt: membership?.inboxPinnedAt ?? null,
        muted: membership?.muted ?? false,
        clearedAt: membership?.clearedAt ?? null,
        peerLastReadSeq: peer?.lastReadSeq ?? null,
        memberCoreUserIds:
          row.kind === 'GROUP_DM'
            ? members.slice(0, MAX_GROUP_DM_MEMBERS).map((m) => m.coreUserId)
            : null,
        nicknames: Object.fromEntries(
          members
            .filter((m) => m.nickname)
            .map((m) => [m.coreUserId, m.nickname as string]),
        ),
        markedUnread: membership?.markedUnread ?? false,
        voiceOccupants: row.kind === 'VOICE' ? (occupants.get(row.id) ?? []) : null,
      };

      const last = lastByChannel.get(row.id) ?? null;

      return toChannelResponse(row, {
        memberCount: row._count.members,
        myRole,
        unreadCount: unreadByChannel.get(row.id) ?? 0,
        peerCoreUserId: peer?.coreUserId ?? null,
        canManage: canManageChannel(row, myRole, user),
        // บรรทัดตัวอย่างของบันทึกการโทรขึ้นกับว่าใครอ่าน ("คุณเริ่ม…" vs "ไม่ได้รับสาย…")
        lastMessage:
          last?.callLog ? { ...last, content: callPreview(last.callLog, user.coreUserId) } : last,
        inbox,
      });
    });
  }

  /// ข้อความล่าสุดของหลายห้องพร้อมกัน — **คิวรีเดียว**
  ///
  /// ใช้ DISTINCT ON ของ Postgres ที่วิ่งบนดัชนี [channelId, seq DESC] ที่มีอยู่แล้ว
  /// ไม่ใช้ `distinct` ของ Prisma เพราะมันดึงทุกแถวมากรองในหน่วยความจำ —
  /// ห้องที่มีข้อความหมื่นแถวจะถูกดึงมาทั้งหมื่นแถวเพื่อเอาแถวเดียว
  private async lastMessages(
    channelIds: string[],
  ): Promise<Map<string, LastMessageDto>> {
    if (channelIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      {
        channel_id: string;
        seq: number;
        content: string | null;
        author_core_user_id: string;
        created_at: Date;
        attachment_count: bigint;
        call_media: 'AUDIO' | 'VIDEO' | null;
        call_status: string | null;
        call_duration_sec: number | null;
        call_caller: string | null;
        call_started_at: Date | null;
        call_ended_at: Date | null;
      }[]
    >`
      SELECT DISTINCT ON (m.channel_id)
        m.channel_id,
        m.seq,
        m.content,
        m.author_core_user_id,
        m.created_at,
        (SELECT count(*) FROM assets a WHERE a.message_id = m.id) AS attachment_count,
        cl.media AS call_media,
        cl.status AS call_status,
        cl.duration_sec AS call_duration_sec,
        cl.caller_core_user_id AS call_caller,
        cl.started_at AS call_started_at,
        cl.ended_at AS call_ended_at
      FROM messages m
      LEFT JOIN call_logs cl ON cl.message_id = m.id
      WHERE m.channel_id = ANY(${channelIds}::text[])
        AND m.parent_id IS NULL
        AND m.deleted_at IS NULL
      ORDER BY m.channel_id, m.seq DESC
    `;

    return new Map(
      rows.map((row) => [
        row.channel_id,
        {
          seq: row.seq,
          content: row.content,
          authorCoreUserId: row.author_core_user_id,
          attachmentCount: Number(row.attachment_count),
          createdAt: row.created_at.toISOString(),
          callLog:
            row.call_media && row.call_status && row.call_caller && row.call_started_at
              ? callLogView({
                  media: row.call_media,
                  status: row.call_status,
                  durationSec: row.call_duration_sec,
                  callerCoreUserId: row.call_caller,
                  startedAt: row.call_started_at,
                  endedAt: row.call_ended_at,
                })
              : null,
        },
      ]),
    );
  }

  /// สมาชิกของห้อง DM และแชทกลุ่มหลายห้องพร้อมกัน — **คิวรีเดียวเสมอ**
  ///
  /// เขียนเป็น batch ตั้งแต่แรกเพราะจุดที่เรียกคือรายการห้อง ถ้าหาทีละห้อง
  /// ผู้ใช้ที่มี 30 ห้องจะจ่ายเพิ่ม 30 คิวรีต่อการเปิดหน้าหนึ่งครั้ง ซึ่งเป็น
  /// บทเรียนเดียวกับที่ `unreadCounts` เคยโดนมาแล้ว
  ///
  /// ดึง lastReadSeq มาด้วยเพื่อทำป้าย "เห็นแล้ว" ของ DM ในคิวรีเดียวกัน
  /// ห้องกลุ่มปกติ (GROUP/COURSE) ไม่อยู่ในนี้ เพราะมีสมาชิกได้หลักร้อย
  private async membersOfDirectChannels(
    channelIds: string[],
  ): Promise<
    Map<string, { coreUserId: string; lastReadSeq: number; nickname: string | null }[]>
  > {
    if (channelIds.length === 0) {
      return new Map();
    }

    const members = await this.prisma.channelMember.findMany({
      where: { channelId: { in: channelIds } },
      select: { channelId: true, coreUserId: true, lastReadSeq: true, nickname: true },
      orderBy: [{ joinedAt: 'asc' }, { coreUserId: 'asc' }],
    });

    const byChannel = new Map<
      string,
      { coreUserId: string; lastReadSeq: number; nickname: string | null }[]
    >();

    for (const member of members) {
      const list = byChannel.get(member.channelId) ?? [];

      list.push({
        coreUserId: member.coreUserId,
        lastReadSeq: member.lastReadSeq,
        nickname: member.nickname,
      });
      byChannel.set(member.channelId, list);
    }

    return byChannel;
  }

  /// คนในห้องเสียงของห้อง VOICE หลายห้อง — คิวรีเดียว (แถบข้างแบบ Discord)
  ///
  /// คิวรีเองที่นี่แทนการเรียก VoiceService เพราะ VoiceModule import ChannelsModule
  /// อยู่แล้ว ถ้าย้อนกลับจะเป็นวงจร — ตรรกะเดียวกับ VoiceService.occupantsOf
  private async voiceOccupants(
    channelIds: string[],
  ): Promise<
    Map<string, { coreUserId: string; muted: boolean; deafened: boolean; video: boolean; sharing: boolean }[]>
  > {
    const out = new Map<
      string,
      { coreUserId: string; muted: boolean; deafened: boolean; video: boolean; sharing: boolean }[]
    >();

    if (channelIds.length === 0) return out;

    const rows = await this.prisma.voiceParticipant.findMany({
      where: { leftAt: null, session: { channelId: { in: channelIds }, endedAt: null } },
      orderBy: { joinedAt: 'asc' },
      select: {
        coreUserId: true,
        muted: true,
        deafened: true,
        video: true,
        sharing: true,
        session: { select: { channelId: true } },
      },
    });

    for (const row of rows) {
      const list = out.get(row.session.channelId) ?? [];

      list.push({
        coreUserId: row.coreUserId,
        muted: row.muted,
        deafened: row.deafened,
        video: row.video,
        sharing: row.sharing,
      });
      out.set(row.session.channelId, list);
    }

    return out;
  }

  private async followedAmong(
    user: CoreHubUser,
    coreUserIds: string[],
  ): Promise<Set<string>> {
    if (coreUserIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.follow.findMany({
      where: {
        followerCoreUserId: user.coreUserId,
        followingCoreUserId: { in: coreUserIds },
      },
      select: { followingCoreUserId: true },
    });

    return new Set(rows.map((row) => row.followingCoreUserId));
  }

  /// ห้องที่ผู้เรียกเคยส่งข้อความ — "ตอบแล้ว" = ยอมรับคำขอโดยปริยาย (แบบ Instagram)
  ///
  /// นับทุกข้อความรวมที่ลบไปแล้วและคำตอบในเธรด เพราะการตอบคือการตัดสินใจ
  /// คุยด้วยแล้ว ลบข้อความทีหลังไม่ได้แปลว่าห้องกลับไปเป็นคำขอ
  private async channelsWhereAuthored(
    user: CoreHubUser,
    channelIds: string[],
  ): Promise<Set<string>> {
    if (channelIds.length === 0) {
      return new Set();
    }

    // ดัชนี unique (channelId, authorCoreUserId, clientNonce) รองรับตรง ๆ
    const rows = await this.prisma.$queryRaw<{ channel_id: string }[]>`
      SELECT DISTINCT m.channel_id
      FROM messages m
      WHERE m.channel_id = ANY(${channelIds}::text[])
        AND m.author_core_user_id = ${user.coreUserId}
    `;

    return new Set(rows.map((row) => row.channel_id));
  }

  async addMembers(
    user: CoreHubUser,
    channelId: string,
    dto: AddMembersDto,
  ): Promise<{ added: number }> {
    const membership = await this.requireMembership(user, channelId);
    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: { _count: { select: { members: true } } },
    });

    if (channel.kind === 'DM') {
      throw new BadRequestException('เพิ่มคนเข้าแชทส่วนตัวไม่ได้');
    }

    if (!canAdministerChannel(membership.role, user)) {
      throw new ForbiddenException(
        'เฉพาะผู้ดูแลห้อง อาจารย์ หรือผู้ดูแลระบบเท่านั้นที่เพิ่มสมาชิกได้',
      );
    }

    const unique = [...new Set(dto.coreUserIds)].filter(
      (name) => name !== user.coreUserId,
    );

    // นับเฉพาะคนที่ยังไม่อยู่ในห้อง — คนที่อยู่แล้ว skipDuplicates ข้ามให้
    if (channel.kind === 'GROUP_DM') {
      const already = await this.prisma.channelMember.count({
        where: { channelId, coreUserId: { in: unique } },
      });

      if (channel._count.members + unique.length - already > MAX_GROUP_DM_MEMBERS) {
        throw new BadRequestException(
          `แชทกลุ่มมีได้ไม่เกิน ${MAX_GROUP_DM_MEMBERS} คน`,
        );
      }
    }

    // ใครที่อยู่ในห้องแล้วไม่ต้องได้แจ้งเตือนซ้ำ — หาก่อนเขียน
    const existing = new Set(
      (
        await this.prisma.channelMember.findMany({
          where: { channelId, coreUserId: { in: unique } },
          select: { coreUserId: true },
        })
      ).map((row) => row.coreUserId),
    );

    const result = await this.prisma.channelMember.createMany({
      data: unique.map((coreUserId) => ({ channelId, coreUserId })),
      skipDuplicates: true,
    });

    await this.notifications.pushMany(
      unique.filter((id) => !existing.has(id)),
      {
        kind: 'CHANNEL_INVITE',
        refId: channelId,
        actorCoreUserId: user.coreUserId,
        payload: { channelId: channelId, kind: channel.kind, name: channel.name },
      },
    );

    return { added: result.count };
  }

  /// แก้ชื่อหรือวัตถุประสงค์ของห้อง
  async update(
    user: CoreHubUser,
    channelId: string,
    dto: UpdateChannelDto,
  ): Promise<ChannelResponseDto> {
    const membership = await this.requireMembership(user, channelId);
    const current = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
    });

    if (!canManageChannel(current, membership.role, user)) {
      throw new ForbiddenException(
        'แก้ไขห้องได้เฉพาะผู้สร้างห้อง ผู้ดูแลห้อง หรือผู้ดูแลระบบ',
      );
    }

    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException(
        'ไม่มีอะไรให้แก้ — ส่ง name หรือ description มาอย่างน้อยหนึ่งช่อง',
      );
    }

    const channel = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'channel.update',
          targetKind: 'CHANNEL',
          targetId: channelId,
          metadata: {
            before: { name: current.name, description: current.description },
            after: { name: updated.name, description: updated.description },
          },
        },
      });

      return updated;
    });

    // สมาชิกคนอื่นที่เปิดห้องค้างไว้ต้องเห็นชื่อใหม่ทันที ไม่ใช่หลังรีเฟรช
    this.bus.pushToRoom({
      room: channelId,
      event: 'channel:updated',
      payload: {
        channelId: channelId,
        name: channel.name,
        description: channel.description,
      },
    });

    return this.findOne(user, channelId);
  }

  /// จัดห้องในกล่องข้อความ "ของฉัน" — แฟ้ม ปักหมุด ปิดเสียง
  ///
  /// เขียนเฉพาะแถวสมาชิกของผู้เรียก คนอื่นในห้องไม่เห็นและไม่ได้รับผลใด ๆ
  /// (การซ่อนคำขอข้อความต้องไม่บอกผู้ส่งว่าถูกซ่อน เหมือน Instagram)
  async updateInbox(
    user: CoreHubUser,
    channelId: string,
    dto: UpdateInboxDto,
  ): Promise<ChannelResponseDto> {
    if (
      dto.folder === undefined &&
      dto.pinned === undefined &&
      dto.muted === undefined
    ) {
      throw new BadRequestException(
        'ไม่มีอะไรให้แก้ — ส่ง folder, pinned หรือ muted มาอย่างน้อยหนึ่งช่อง',
      );
    }

    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_coreUserId: { channelId, coreUserId: user.coreUserId } },
      select: { inboxPinnedAt: true },
    });

    if (!membership) {
      throw new NotFoundException('ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก');
    }

    await this.prisma.channelMember.update({
      where: { channelId_coreUserId: { channelId, coreUserId: user.coreUserId } },
      data: {
        ...(dto.folder !== undefined ? { inboxFolder: dto.folder } : {}),
        ...(dto.muted !== undefined ? { muted: dto.muted } : {}),
        // ปักซ้ำไม่ขยับเวลา — ไม่งั้นกดปักห้องที่ปักอยู่แล้วจะสลับลำดับหมุดเอง
        ...(dto.pinned !== undefined
          ? {
              inboxPinnedAt: dto.pinned
                ? (membership.inboxPinnedAt ?? new Date())
                : null,
            }
          : {}),
      },
    });

    return this.findOne(user, channelId);
  }

  /// "ลบแชท" แบบ Instagram — เฉพาะฝั่งฉัน
  ///
  /// ไม่ลบข้อความจริง (อีกฝ่ายยังต้องเห็นประวัติครบ) แค่จำเวลาไว้ แล้วทุกทาง
  /// อ่านข้อความของผู้เรียกกรอง createdAt > clearedAt · ห้องหายจากกล่อง
  /// ข้อความจนกว่าจะมีข้อความใหม่ · ยังไม่อ่านถูกล้างไปด้วย (อ่านถึงข้อความ
  /// ล่าสุดแล้ว) ไม่งั้น badge จะนับข้อความที่ผู้ใช้สั่งลบไปแล้ว
  async clear(
    user: CoreHubUser,
    channelId: string,
  ): Promise<ClearChannelResponseDto> {
    await this.requireMembership(user, channelId);

    // คำสั่งเดียวให้ฐานข้อมูลเป็นคนเลือกเวลาและ seq ล่าสุด — เวลาเดียวกับที่
    // ข้อความใหม่ใช้ (DEFAULT CURRENT_TIMESTAMP) จึงเทียบกันได้ตรง
    const [row] = await this.prisma.$queryRaw<{ cleared_at: Date }[]>`
      UPDATE channel_members
      SET cleared_at = now(),
          marked_unread = false,
          last_read_seq = GREATEST(
            last_read_seq,
            COALESCE((SELECT max(seq) FROM messages WHERE channel_id = ${channelId}), 0)
          )
      WHERE channel_id = ${channelId}
        AND core_user_id = ${user.coreUserId}
      RETURNING cleared_at
    `;

    return {
      channelId: channelId,
      clearedAt: row.cleared_at.toISOString(),
    };
  }

  /// ในรายชื่อที่ให้มา ใครปิดเสียงห้องนี้ไว้บ้าง — ใช้กรองผู้รับแจ้งเตือน
  ///
  /// คิวรีเดียวต่อการแจ้งเตือนหนึ่งชุด ไม่ใช่ต่อผู้รับหนึ่งคน (@everyone ในห้อง
  /// 200 คนจะกลายเป็น 200 คิวรีถ้าถามทีละคน)
  async mutedAmong(
    channelId: string,
    coreUserIds: string[],
  ): Promise<Set<string>> {
    if (coreUserIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.channelMember.findMany({
      where: { channelId, coreUserId: { in: coreUserIds }, muted: true },
      select: { coreUserId: true },
    });

    return new Set(rows.map((row) => row.coreUserId));
  }

  /// ลบห้องทั้งห้อง — ข้อความ ห้องเสียง และนัดประชุมของห้องหายไปด้วย
  ///
  /// **กู้คืนไม่ได้** จึงเก็บสิ่งที่ถูกลบไว้ใน audit log ก่อน (ชื่อ วัตถุประสงค์
  /// ผู้สร้าง จำนวนสมาชิกและข้อความ) แผงผู้ดูแลจะได้ตอบได้ว่าห้องที่หายไป
  /// เคยเป็นอะไรและใครลบ
  async remove(user: CoreHubUser, channelId: string): Promise<void> {
    const membership = await this.requireMembership(user, channelId);
    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: {
        members: { select: { coreUserId: true } },
        _count: { select: { messages: true } },
      },
    });

    if (!canManageChannel(channel, membership.role, user)) {
      throw new ForbiddenException(
        channel.kind === 'DM'
          ? 'ลบแชทส่วนตัวไม่ได้ — อีกฝ่ายจะเสียประวัติการคุยไปด้วย (ใช้ "ลบแชท" เพื่อซ่อนจากฝั่งคุณแทน)'
          : 'ลบห้องได้เฉพาะผู้สร้างห้อง ผู้ดูแลห้อง หรือผู้ดูแลระบบ',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'channel.delete',
          targetKind: 'CHANNEL',
          targetId: channelId,
          metadata: {
            kind: channel.kind,
            name: channel.name,
            description: channel.description,
            course_tag: channel.courseTag,
            created_by_core_user_id: channel.createdByCoreUserId,
            member_count: channel.members.length,
            message_count: channel._count.messages,
          },
        },
      });

      // สมาชิก ข้อความ ห้องเสียง นัดประชุม ลบตามด้วย onDelete: Cascade
      await tx.channel.delete({ where: { id: channelId } });
    });

    // บอกทุกคนที่เปิดห้องค้างไว้ก่อน แล้วค่อยเตะออกจากห้องของ socket
    // ถ้าเตะก่อน event นี้จะไปไม่ถึงใครเลย หน้าจอของเขาจะค้างที่ห้องที่ไม่มีแล้ว
    this.bus.pushToRoom({
      room: channelId,
      event: 'channel:deleted',
      payload: {
        channelId: channelId,
        name: channel.name,
        deletedByCoreUserId: user.coreUserId,
      },
    });

    for (const member of channel.members) {
      this.bus.evictFromRoom({
        room: channelId,
        coreUserId: member.coreUserId,
      });
    }
  }

  /// ออกจากห้อง
  ///
  /// แชทกลุ่มมีสองกรณีเพิ่ม: คนสุดท้ายออก = ห้องไม่มีเจ้าของแล้ว ลบทิ้งเลย
  /// (ไม่งั้นจะเหลือห้องกำพร้าที่ไม่มีใครเข้าถึงได้อีกตลอดไป) และผู้ดูแลคน
  /// สุดท้ายออก = ตั้งคนที่อยู่มานานที่สุดเป็นผู้ดูแลแทน ไม่งั้นไม่มีใครแก้ชื่อได้
  async leave(user: CoreHubUser, channelId: string): Promise<void> {
    await this.requireMembership(user, channelId);

    await this.prisma.$transaction(async (tx) => {
      await tx.channelMember.delete({
        where: { channelId_coreUserId: { channelId, coreUserId: user.coreUserId } },
      });

      const channel = await tx.channel.findUniqueOrThrow({
        where: { id: channelId },
        select: { kind: true },
      });

      if (channel.kind !== 'GROUP_DM') {
        return;
      }

      const remaining = await tx.channelMember.findMany({
        where: { channelId },
        orderBy: { joinedAt: 'asc' },
        select: { coreUserId: true, role: true },
      });

      if (remaining.length === 0) {
        await tx.channel.delete({ where: { id: channelId } });
        return;
      }

      if (!remaining.some((member) => member.role === 'MODERATOR')) {
        await tx.channelMember.update({
          where: {
            channelId_coreUserId: {
              channelId,
              coreUserId: remaining[0].coreUserId,
            },
          },
          data: { role: 'MODERATOR' },
        });
      }
    });

    // ลบแถวสมาชิกอย่างเดียวไม่พอ — socket ยังอยู่ในห้องของ socket.io
    // และการกระจายข้อความไม่ได้ตรวจสมาชิกซ้ำ อดีตสมาชิกจึงยังเห็นข้อความ
    // ใหม่แบบสดทุกข้อความ ทั้งที่กด "ออกจากห้อง" ไปแล้วและเปิดหน้าห้องไม่ได้
    this.bus.evictFromRoom({ room: channelId, coreUserId: user.coreUserId });
  }

  /// อัปเดตว่าอ่านถึงข้อความไหนแล้ว — ทำให้ badge ยังไม่อ่านคำนวณด้วยการลบเลข
  /// แทนที่จะต้อง COUNT ทุกครั้งที่โหลดรายการห้อง
  async markRead(
    user: CoreHubUser,
    channelId: string,
    seq: number,
  ): Promise<{ lastReadSeq: number }> {
    const membership = await this.requireMembership(user, channelId);

    // ไม่ให้ถอยหลัง — และต้องให้ **ฐานข้อมูล** เป็นคนบังคับ ไม่ใช่คำนวณในหน่วยความจำ
    //
    // เดิมอ่าน lastReadSeq มาก่อนแล้วค่อย Math.max ในโพรเซส: เปิดแชทค้างไว้
    // ทั้งบนโน้ตบุ๊กและมือถือ ทั้งคู่อ่านได้ 40 เท่ากัน โน้ตบุ๊กคำนวณได้ 120
    // มือถือได้ 60 แล้วมือถือเขียนทีหลัง — ค่าสุดท้ายคือ 60 badge ที่อ่านแล้ว
    // จึงเด้งกลับมาเป็นยังไม่อ่านเองเฉย ๆ
    //
    // เงื่อนไข lastReadSeq < seq ทำให้การเขียนที่ถอยหลังไม่เข้าเงื่อนไขเลย
    await this.prisma.channelMember.updateMany({
      where: { channelId, coreUserId: user.coreUserId, lastReadSeq: { lt: seq } },
      data: { lastReadSeq: seq },
    });

    // เปิดห้องอ่านแล้ว = ป้าย "ยังไม่ได้อ่าน" ที่ผู้ใช้ตั้งเองหมดหน้าที่
    await this.prisma.channelMember.updateMany({
      where: { channelId, coreUserId: user.coreUserId, markedUnread: true },
      data: { markedUnread: false },
    });

    return { lastReadSeq: Math.max(membership.lastReadSeq, seq) };
  }

  /// อีกคนเป็นสมาชิกห้องนี้ไหม — ต่างจาก requireMembership ที่ถามถึงผู้เรียกเอง
  ///
  /// ใช้ตอนโทร: ต้องรู้ว่าปลายทางอยู่ห้องเดียวกันก่อนส่งเสียงกริ่ง
  /// คืน boolean ไม่ throw เพราะผู้เรียกต้องแปลงเป็นข้อความที่ไม่บอกว่า
  /// คนชื่อนั้นมีอยู่จริงหรือไม่
  async isMember(coreUserId: string, channelId: string): Promise<boolean> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_coreUserId: { channelId, coreUserId } },
      select: { coreUserId: true },
    });

    return membership !== null;
  }

  /// ใช้ร่วมกันทั้ง REST และ Socket.io — จุดเดียวที่ตัดสินว่า "อยู่ห้องนี้ไหม"
  ///
  /// คืน clearedAt มาด้วย เพราะทุกทางอ่านข้อความต้องกรองตาม "ลบแชท" ของผู้เรียก
  /// และจุดนี้เป็นคิวรีที่ทุกทางอ่านจ่ายอยู่แล้ว
  async requireMembership(
    user: CoreHubUser,
    channelId: string,
  ): Promise<{ role: ChannelRole; lastReadSeq: number; clearedAt: Date | null }> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_coreUserId: { channelId, coreUserId: user.coreUserId } },
      select: { role: true, lastReadSeq: true, clearedAt: true },
    });

    if (!membership) {
      // ตอบ 404 ไม่ใช่ 403 เพื่อไม่ให้คนนอกรู้ว่าห้องนี้มีอยู่จริง
      throw new NotFoundException('ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก');
    }

    return membership;
  }

  /// นับข้อความที่ยังไม่อ่านของหลายห้องพร้อมกัน
  ///
  /// ใช้ groupBy ครั้งเดียวแทน COUNT ต่อห้อง · เงื่อนไข seq > lastReadSeq
  /// ต่างกันไปในแต่ละห้อง จึงกรองด้วย OR ของคู่ (channelId, seq) แล้วให้
  /// ฐานข้อมูลใช้ดัชนี [channelId, seq] ที่มีอยู่แล้ว
  ///
  /// ไม่นับข้อความในเธรด เพราะ badge นี้หมายถึงไทม์ไลน์หลัก ถ้านับด้วย
  /// ผู้ใช้จะเห็นเลข 1 แล้วเปิดห้องมาไม่พบอะไรใหม่เลย คำตอบในเธรดถึงเจ้าของ
  /// กระทู้ทางการแจ้งเตือน THREAD_REPLY อยู่แล้ว
  private async unreadCounts(
    memberships: { channelId: string; lastReadSeq: number }[],
  ): Promise<Map<string, number>> {
    if (memberships.length === 0) {
      return new Map();
    }

    const grouped = await this.prisma.message.groupBy({
      by: ['channelId'],
      where: {
        deletedAt: null,
        parentId: null,
        OR: memberships.map((row) => ({
          channelId: row.channelId,
          seq: { gt: row.lastReadSeq },
        })),
      },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.channelId, row._count._all]));
  }
}
