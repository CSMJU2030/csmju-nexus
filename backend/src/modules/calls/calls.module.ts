import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CoreRoles } from '../../common/auth/core-roles.decorator.js';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

/// สายยาวสุดที่ยอมรับ — กันเลขขยะ (เช่น ms ที่ส่งมาผิดหน่วย) ล้นคอลัมน์ Int
const MAX_DURATION_SEC = 24 * 60 * 60;

export class CreateCallFeedbackDto {
  @ApiProperty({ description: 'ห้องที่โทร — ผู้เรียกต้องเป็นสมาชิก' })
  @IsUUID('4', { message: 'channelId ต้องเป็น UUID' })
  channelId!: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsInt({ message: 'rating ต้องเป็นจำนวนเต็ม 1-5' })
  @Min(1, { message: 'rating ต้องเป็นจำนวนเต็ม 1-5' })
  @Max(5, { message: 'rating ต้องเป็นจำนวนเต็ม 1-5' })
  rating!: number;

  @ApiPropertyOptional({ minimum: 0, example: 312, description: 'ความยาวสายเป็นวินาที' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'durationSec ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'durationSec ต้องไม่ติดลบ' })
  @Max(MAX_DURATION_SEC, { message: 'durationSec ยาวเกิน 24 ชั่วโมง' })
  durationSec?: number;

  @ApiProperty({ enum: ['AUDIO', 'VIDEO'] })
  @IsIn(['AUDIO', 'VIDEO'], { message: 'kind ต้องเป็น AUDIO หรือ VIDEO' })
  kind!: 'AUDIO' | 'VIDEO';
}

export class CallFeedbackDto {
  @ApiProperty() id!: string;
  @ApiProperty() channelId!: string;
  @ApiProperty() coreUserId!: string;
  @ApiProperty() rating!: number;
  @ApiProperty({ nullable: true }) durationSec!: number | null;
  @ApiProperty({ enum: ['AUDIO', 'VIDEO'] }) kind!: 'AUDIO' | 'VIDEO';
  @ApiProperty() createdAt!: string;
}

/// คะแนนหลังวางสาย — สายเสียง/วิดีโอเป็น P2P จึงไม่มีเซิร์ฟเวอร์กลางวัดคุณภาพ
/// ความเห็นของผู้ใช้คือสัญญาณเดียวว่า TURN หรือ mesh มีปัญหาตรงไหน
@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: CoreHubUser, dto: CreateCallFeedbackDto): Promise<CallFeedbackDto> {
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_coreUserId: { channelId: dto.channelId, coreUserId: user.coreUserId } },
      select: { coreUserId: true },
    });

    if (!member) {
      // 404 ไม่ใช่ 403 — ไม่ยืนยันให้คนนอกรู้ว่าห้องนี้มีจริง
      throw new NotFoundException('ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก');
    }

    const row = await this.prisma.callFeedback.create({
      data: {
        channelId: dto.channelId,
        coreUserId: user.coreUserId,
        rating: dto.rating,
        durationSec: dto.durationSec ?? null,
        kind: dto.kind,
      },
    });

    return toDto(row);
  }

  async list(query: PaginationQuery): Promise<Paginated<CallFeedbackDto>> {
    const [rows, total] = await Promise.all([
      this.prisma.callFeedback.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.callFeedback.count(),
    ]);

    return new Paginated(rows.map(toDto), query.meta(total));
  }
}

function toDto(row: {
  id: string;
  channelId: string;
  coreUserId: string;
  rating: number;
  durationSec: number | null;
  kind: 'AUDIO' | 'VIDEO';
  createdAt: Date;
}): CallFeedbackDto {
  return {
    id: row.id,
    channelId: row.channelId,
    coreUserId: row.coreUserId,
    rating: row.rating,
    durationSec: row.durationSec,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
  };
}

@ApiTags('calls')
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('feedback')
  @ApiOperation({ summary: 'ให้คะแนนสายหลังวางสาย (1-5)' })
  @ApiEnvelope(CallFeedbackDto, { status: 201 })
  @ApiEnvelopeError(400, 'ค่าไม่ถูกต้อง')
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateCallFeedbackDto) {
    return this.calls.create(user, dto);
  }

  @Get('feedback')
  @CoreRoles('staff', 'admin')
  @ApiOperation({ summary: 'คะแนนสายทั้งหมด ใหม่ไปเก่า (บุคลากรและผู้ดูแล)' })
  @ApiEnvelopeList(CallFeedbackDto)
  @ApiEnvelopeError(403, 'เฉพาะบุคลากรและผู้ดูแล')
  list(@Query() query: PaginationQuery) {
    return this.calls.list(query);
  }
}

@Module({
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
