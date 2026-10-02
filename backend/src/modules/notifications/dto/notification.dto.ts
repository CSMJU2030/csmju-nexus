import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, Matches } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { camelizeKeys } from '../../../common/util/camel-keys.js';
import { NotificationKind } from '../../../generated/prisma/enums.js';
import type { NotificationModel } from '../../../generated/prisma/models.js';

const KINDS = Object.values(NotificationKind);

/// หนึ่งค่าหรือหลายค่าคั่นลูกน้ำ เช่น `REEL_COMMENT,POST_COMMENT`
///
/// สร้าง regex จาก enum ของ Prisma เพื่อให้เพิ่มชนิดแจ้งเตือนใหม่แล้วตัวกรอง
/// รับค่าใหม่ได้เองโดยไม่ต้องตามแก้ที่นี่
const KIND_LIST = new RegExp(`^(${KINDS.join('|')})(,(${KINDS.join('|')}))*$`);

export class ListNotificationsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description: 'true = เอาเฉพาะที่ยังไม่อ่าน',
    example: 'true',
  })
  @IsOptional()
  @IsBooleanString({ message: 'unreadOnly ต้องเป็น true หรือ false' })
  unreadOnly?: string;

  /// แท็บกรองของแผงแจ้งเตือนแบบ Instagram ("ความคิดเห็น" "การติดตาม" "การกล่าวถึง")
  @ApiPropertyOptional({
    description: `กรองตามชนิด — ค่าเดียวหรือหลายค่าคั่นลูกน้ำ: ${KINDS.join(', ')}`,
    example: 'REEL_COMMENT,POST_COMMENT',
  })
  @IsOptional()
  @Matches(KIND_LIST, {
    message: `kind ต้องเป็นค่าต่อไปนี้ (คั่นลูกน้ำได้): ${KINDS.join(', ')}`,
  })
  kind?: string;

  /// แยกเป็นอาเรย์ — ผ่าน ValidationPipe มาแล้วจึงเชื่อได้ว่าเป็นค่าใน enum ทุกตัว
  get kinds(): NotificationKind[] | undefined {
    return this.kind
      ? [...new Set(this.kind.split(','))] as NotificationKind[]
      : undefined;
  }
}

export class NotificationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'MENTION' }) kind!: string;
  @ApiProperty({ description: 'id ของสิ่งที่ถูกกระทำ' }) refId!: string;

  @ApiProperty({ nullable: true, example: '6700000001-ajarn' })
  actorCoreUserId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'บริบทเพิ่มเติมตอนเกิดเหตุ เช่น channelId, emoji, preview',
    example: { channelId: 'b1f0c2de-...', preview: 'ฝากดูโค้ดหน่อยครับ' },
  })
  payload!: unknown;

  @ApiProperty({ nullable: true }) readAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class UnreadCountDto {
  @ApiProperty({ example: 7 }) unreadCount!: number;
}

export function toNotificationResponse(
  row: NotificationModel,
): NotificationResponseDto {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    actorCoreUserId: row.actorCoreUserId,
    payload: camelizeKeys(row.payload ?? null),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
