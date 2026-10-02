import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import {
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { EventsGateway } from './events.gateway.js';

/// เพดานสมาชิกที่จัดเรียงตามสถานะได้ต่อครั้ง — ห้องเรียนใหญ่สุดไม่เกินนี้
const MEMBER_SCAN_LIMIT = 2000;

export class ListChannelMembersQuery extends PaginationQuery {
  @ApiPropertyOptional({
    enum: ['online', 'offline'],
    description: 'กรองเฉพาะกลุ่ม "ออนไลน์" หรือ "ออฟไลน์" แบบรายชื่อด้านขวาของ Discord (meta.total คือจำนวนในกลุ่มนั้น)',
  })
  @IsOptional()
  @IsIn(['online', 'offline'], { message: 'status ต้องเป็น online หรือ offline' })
  status?: 'online' | 'offline';
}

export class ChannelMemberDto {
  @ApiProperty() coreUserId!: string;
  @ApiProperty({ enum: ['MEMBER', 'MODERATOR'] }) role!: string;
  @ApiProperty({ nullable: true, description: 'ชื่อเล่นในห้องนี้ (DM/แชทกลุ่ม)' }) nickname!: string | null;
  @ApiProperty() joinedAt!: string;

  @ApiProperty({
    description: 'ออนไลน์อยู่ — false เสมอถ้าฝ่ายใดปิด showActivityStatus หรือบล็อกกัน (ตัวเองเห็นของตัวเองเสมอ)',
  })
  online!: boolean;

  @ApiProperty({ nullable: true, description: 'ออนไลน์ล่าสุด — null ภายใต้เงื่อนไขเดียวกับ online' })
  lastActiveAt!: string | null;

  @ApiProperty({ description: 'อยู่ในห้องเสียงของห้องนี้ตอนนี้' })
  inVoice!: boolean;
}

/// รายชื่อสมาชิกห้องพร้อมสถานะออนไลน์ — แผงสมาชิกด้านขวาแบบ Discord
///
/// อยู่ในโมดูล realtime เพราะสถานะออนไลน์นับจาก socket ของโพรเซสนี้ (EventsGateway)
/// เรียง: ออนไลน์ก่อน → ผู้ดูแลก่อน → เข้าห้องก่อน · แบ่งหน้าหลังเรียง
@ApiTags('channels')
@Controller('channels')
export class ChannelMembersController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly events: EventsGateway,
  ) {}

  @Get(':id/members')
  @ApiOperation({
    summary: 'สมาชิกของห้องพร้อมสถานะออนไลน์ (แบ่งหน้า · ออนไลน์ก่อน)',
    description:
      'ต้องเป็นสมาชิก · status=online|offline แยกสองกลุ่มได้ · เคารพ showActivityStatus ของทั้งสองฝั่งและการบล็อก',
  })
  @ApiEnvelopeList(ChannelMemberDto)
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  async list(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListChannelMembersQuery,
  ): Promise<Paginated<ChannelMemberDto>> {
    await this.channels.requireMembership(user, id);

    const members = await this.prisma.channelMember.findMany({
      where: { channelId: id },
      orderBy: [{ joinedAt: 'asc' }, { coreUserId: 'asc' }],
      take: MEMBER_SCAN_LIMIT,
      select: { coreUserId: true, role: true, nickname: true, joinedAt: true },
    });

    const ids = members.map((m) => m.coreUserId);
    const [profiles, blocked, voice] = await Promise.all([
      this.prisma.subsystemMember.findMany({
        where: { coreUserId: { in: [...ids, user.coreUserId] } },
        select: { coreUserId: true, showActivityStatus: true, lastActiveAt: true },
      }),
      this.blocks.blockedAmong(user.coreUserId, ids),
      this.prisma.voiceParticipant.findMany({
        where: { leftAt: null, session: { channelId: id, endedAt: null } },
        select: { coreUserId: true },
      }),
    ]);

    const byId = new Map(profiles.map((p) => [p.coreUserId, p]));
    const iShare = byId.get(user.coreUserId)?.showActivityStatus !== false;
    const online = new Set(this.events.onlineCoreUserIds());
    const inVoice = new Set(voice.map((v) => v.coreUserId));

    const rows = members.map((member) => {
      const self = member.coreUserId === user.coreUserId;
      const visible =
        self ||
        (iShare &&
          byId.get(member.coreUserId)?.showActivityStatus !== false &&
          !blocked.has(member.coreUserId));

      return {
        coreUserId: member.coreUserId,
        role: member.role,
        nickname: member.nickname,
        joinedAt: member.joinedAt.toISOString(),
        online: visible && online.has(member.coreUserId),
        lastActiveAt: visible
          ? (byId.get(member.coreUserId)?.lastActiveAt?.toISOString() ?? null)
          : null,
        inVoice: inVoice.has(member.coreUserId),
      };
    });

    const filtered = query.status
      ? rows.filter((row) => row.online === (query.status === 'online'))
      : rows;

    const sorted = filtered
      .map((row, index) => ({ row, index }))
      .sort(
        (a, b) =>
          Number(b.row.online) - Number(a.row.online) ||
          Number(b.row.role === 'MODERATOR') - Number(a.row.role === 'MODERATOR') ||
          a.index - b.index,
      )
      .map(({ row }) => row);

    return new Paginated(
      sorted.slice(query.skip, query.skip + query.take),
      query.meta(sorted.length),
    );
  }
}
