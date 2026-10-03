import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import { ApiEnvelope } from '../../common/http/api-envelope.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { EventsGateway } from './events.gateway.js';

/// เพดานรายชื่อที่ขอสถานะได้ต่อครั้ง — กล่องข้อความหนึ่งหน้าไม่เกินนี้
const MAX_PRESENCE_IDS = 100;

export class PresenceUserDto {
  @ApiProperty() coreUserId!: string;

  @ApiProperty({
    description: 'ออนไลน์อยู่ตอนนี้ — false เสมอถ้าฝ่ายใดฝ่ายหนึ่งปิดแสดงสถานะกิจกรรม หรือบล็อกกัน',
  })
  online!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'ออนไลน์ล่าสุด — null ถ้าไม่เคยบันทึก ฝ่ายใดฝ่ายหนึ่งปิดแสดงสถานะ หรือบล็อกกัน',
  })
  lastActiveAt!: string | null;
}

export class PresenceQuery {
  @ApiPropertyOptional({
    description:
      'รายชื่อ coreUserId คั่นด้วยลูกน้ำ · เว้นว่างเพื่อขอทุกคนที่ออนไลน์อยู่',
    example: '6700001382-somsak,6700000001-ajarn',
  })
  @IsOptional()
  @IsString()
  @Length(1, 6500)
  coreUserIds?: string;

  @ApiPropertyOptional({
    description: `ขอสถานะรายคน (ออนไลน์ + ออนไลน์ล่าสุด) คั่นลูกน้ำ สูงสุด ${MAX_PRESENCE_IDS} คน → ช่อง users`,
    example: '6700001382-somsak,6700000001-ajarn',
  })
  @IsOptional()
  @IsString()
  @Length(1, 6500)
  ids?: string;
}

export class PresenceResponseDto {
  @ApiProperty({
    type: [String],
    description: 'คนที่มี socket เปิดอยู่ตอนนี้',
    example: ['6700001382-somsak'],
  })
  onlineCoreUserIds!: string[];

  @ApiProperty({
    example: 3,
    description: 'จำนวนคนที่ออนไลน์ทั้งระบบ (ไม่ขึ้นกับตัวกรอง coreUserIds)',
  })
  totalOnline!: number;

  @ApiProperty({
    type: [PresenceUserDto],
    description: 'สถานะรายคนตามที่ขอใน ids (ลำดับเดียวกัน) — ว่างถ้าไม่ได้ส่ง ids',
  })
  users!: PresenceUserDto[];
}

/// ใครออนไลน์อยู่ตอนนี้
///
/// ต้องมีทั้ง REST และ event `presence:changed`:
///   - event บอก "การเปลี่ยนแปลง" แต่คนที่เพิ่งเปิดหน้าไม่เคยได้ยิน event
///     ของคนที่ออนไลน์อยู่ก่อนแล้ว
///   - REST ให้ภาพตั้งต้น แล้ว event ทำให้มันสดต่อ
///
/// ข้อจำกัดที่ต้องรู้: สถานะออนไลน์นับจาก socket ที่เปิดอยู่ในโพรเซสนี้
/// ถ้าสเกลเป็นหลาย instance ต้องย้ายไป Redis ไม่งั้นแต่ละ instance จะเห็น
/// คนละครึ่งของผู้ใช้
///
/// TODO(PL): ถาม PM ว่าต้องมีปุ่ม "ซ่อนสถานะออนไลน์" ไหม — ตอนนี้ทุกคน
/// ในระบบย่อยเห็นสถานะของกันหมด (เหมือน Discord) ซึ่ง Instagram ให้ปิดได้
@ApiTags('presence')
@Controller('presence')
export class PresenceController {
  constructor(
    private readonly events: EventsGateway,
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'ใครออนไลน์อยู่ตอนนี้ และออนไลน์ล่าสุด (ids)',
    description:
      'เคารพ showActivityStatus แบบ Instagram: ถ้าผู้เรียกหรือเจ้าของปิดไว้ online = false และ lastActiveAt = null · คนที่บล็อกกันเห็นเป็นออฟไลน์เสมอ',
  })
  @ApiEnvelope(PresenceResponseDto)
  async get(
    @CurrentUser() user: CoreHubUser,
    @Query() query: PresenceQuery,
  ): Promise<PresenceResponseDto> {
    const split = (value?: string) =>
      [...new Set((value ?? '').split(',').map((name) => name.trim()).filter(Boolean))];

    const asked = split(query.coreUserIds);
    const ids = split(query.ids).slice(0, MAX_PRESENCE_IDS);
    const online = this.events.onlineCoreUserIds();
    const candidates = asked.length > 0 ? online.filter((name) => asked.includes(name)) : online;

    // ปิดสถานะกิจกรรม = ไม่เห็นของใครและไม่มีใครเห็นของเรา (กติกาเดียวกับ Instagram)
    const lookup = [...new Set([user.coreUserId, ...ids, ...(asked.length ? candidates : [])])];
    const [members, blocked] = await Promise.all([
      this.prisma.subsystemMember.findMany({
        where: { coreUserId: { in: lookup } },
        select: { coreUserId: true, showActivityStatus: true, lastActiveAt: true },
      }),
      this.blocks.blockedAmong(user.coreUserId, [...ids, ...candidates]),
    ]);
    const byId = new Map(members.map((m) => [m.coreUserId, m]));
    const iShare = byId.get(user.coreUserId)?.showActivityStatus !== false;
    const visible = (id: string) =>
      id === user.coreUserId ||
      (iShare && byId.get(id)?.showActivityStatus !== false && !blocked.has(id));

    const onlineSet = new Set(online);

    return {
      onlineCoreUserIds: asked.length > 0 ? candidates.filter(visible) : candidates,
      totalOnline: online.length,
      users: ids.map((id) => {
        const show = visible(id);

        return {
          coreUserId: id,
          online: show && onlineSet.has(id),
          lastActiveAt: show ? (byId.get(id)?.lastActiveAt?.toISOString() ?? null) : null,
        };
      }),
    };
  }
}
