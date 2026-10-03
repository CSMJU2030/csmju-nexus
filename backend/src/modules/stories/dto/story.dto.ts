import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/// อายุของสตอรี่ — 24 ชั่วโมงเหมือน Instagram และ Facebook
///
/// เก็บเป็นเวลาหมดอายุตายตัวในฐานข้อมูล ไม่คำนวณสด ๆ ตอนคิวรี
/// เพราะถ้าวันหนึ่งเปลี่ยนค่านี้ สตอรี่เก่าจะยืดหรือหดอายุตามย้อนหลัง
/// ซึ่งไม่ตรงกับที่ผู้โพสต์ตกลงไว้ตอนกดโพสต์
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export class CreateStoryDto {
  @ApiProperty({
    description: 'ไฟล์ที่อัปโหลดและ commit เสร็จแล้ว ต้องเป็นรูปหรือวิดีโอ',
  })
  @IsUUID('4')
  assetId!: string;

  @ApiPropertyOptional({ example: 'ติวกันคืนนี้ 20:00 นะ' })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  caption?: string;
}

export class StoryItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorCoreUserId!: string;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] })
  kind!: string;

  @ApiProperty({
    description:
      'signed URL อายุสั้น — ถ้าเปิดค้างไว้นานแล้วโหลดไม่ขึ้น ให้ดึงรายการใหม่',
  })
  mediaUrl!: string;

  @ApiProperty({ description: 'ใช้ขอ URL ใหม่ถ้าอันเดิมหมดอายุ' })
  assetId!: string;

  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty({ description: 'ผู้เรียกดูสตอรี่นี้ไปแล้วหรือยัง' })
  viewedByMe!: boolean;

  @ApiProperty({
    example: 12,
    description: 'จำนวนผู้ชม — เจ้าของเห็นเลขจริง คนอื่นเห็น 0',
  })
  viewCount!: number;

  @ApiProperty() createdAt!: string;
  @ApiProperty() expiresAt!: string;
}

/// สตอรี่จัดกลุ่มตามเจ้าของ — รูปแบบที่แถวรูปโปรไฟล์ด้านบนฟีดต้องใช้
export class StoryTrayDto {
  @ApiProperty() authorCoreUserId!: string;

  @ApiProperty({
    description: 'ยังมีสตอรี่ที่ผู้เรียกไม่ได้ดู — ใช้ตัดสินว่าวงแหวนติดสีไหม',
  })
  hasUnseen!: boolean;

  @ApiProperty({ description: 'true = เป็นสตอรี่ของผู้เรียกเอง' })
  isMe!: boolean;

  @ApiProperty({ type: [StoryItemDto] })
  stories!: StoryItemDto[];
}

export class StoryViewerDto {
  @ApiProperty() coreUserId!: string;

  @ApiProperty() viewedAt!: string;
}

export class StoryInsightsDto {
  @ApiProperty({ example: 42 }) viewCount!: number;
  @ApiProperty({ example: 3, description: 'จำนวนข้อความที่พิมพ์ตอบ (ไม่นับที่ลบแล้ว)' }) replyCount!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { '😍': 5, '🔥': 2 },
    description: 'จำนวนการกดอิโมจิแยกตามอิโมจิ',
  })
  reactionCounts!: Record<string, number>;
}

/// หนึ่งชิ้นในคลังสตอรี่ของเจ้าของ — รวมชิ้นที่หมดอายุแล้ว
export class StoryArchiveItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() assetId!: string;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] })
  mediaKind!: string;

  @ApiProperty({ description: 'signed URL อายุ 5 นาที — หมดอายุให้ดึงรายการใหม่' })
  mediaUrl!: string;

  @ApiProperty({ nullable: true }) caption!: string | null;

  @ApiProperty({ description: 'จำนวนผู้ชม (เจ้าของเห็นเลขจริงเสมอ เพราะเป็นของตัวเอง)' })
  viewCount!: number;

  @ApiProperty({ description: 'หมดอายุแล้ว = ไม่อยู่ในแถวสตอรี่ แต่ยังอยู่ในคลังและในไฮไลต์' })
  isExpired!: boolean;

  @ApiProperty() createdAt!: string;
  @ApiProperty() expiresAt!: string;
}
