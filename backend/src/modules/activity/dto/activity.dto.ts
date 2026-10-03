import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { MessageEmbedViewDto } from '../../channels/dto/message.dto.js';
import { ReelResponseDto } from '../../reels/dto/reel.dto.js';

export const ACTIVITY_ORDERS = ['newest', 'oldest'] as const;
export type ActivityOrder = (typeof ACTIVITY_ORDERS)[number];

/// วันที่แบบ ISO — `2026-09-29` (วันตามปฏิทินไทย) หรือเวลาเต็มพร้อม offset
/// ที่จะถูกปัดเป็น "วันนั้นตามเวลากรุงเทพฯ"
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2}))?$/;

const CORE_USER_ID = /^[A-Za-z0-9._-]{3,64}$/;

/// เรียงและกรองช่วงวัน — ตัวกรอง "เรียงตาม · ช่วงวันที่" ของหน้ากิจกรรมของคุณ
///
/// from / to **รวมทั้งวัน** ตามเวลากรุงเทพฯ (UTC+7) ไม่ใช่ UTC: ผู้ใช้เลือก
/// "29 ก.ย." หมายถึงเที่ยงคืนถึงเที่ยงคืนของไทย ถ้าตีเป็น UTC กิจกรรมช่วง
/// 00:00-07:00 ของวันนั้นจะหายไปอยู่วันก่อนหน้า
export class ActivityRangeQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ACTIVITY_ORDERS, default: 'newest' })
  @IsOptional()
  @IsIn(ACTIVITY_ORDERS, { message: 'order ต้องเป็น newest หรือ oldest' })
  order?: ActivityOrder;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'ตั้งแต่วันนี้ (รวม) ตามเวลากรุงเทพฯ — YYYY-MM-DD หรือ ISO 8601 เต็ม',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, {
    message: 'from ต้องเป็นวันที่แบบ ISO เช่น 2026-09-01',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'ถึงวันนี้ (รวมทั้งวัน) ตามเวลากรุงเทพฯ — ต้องไม่อยู่ก่อน from',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, {
    message: 'to ต้องเป็นวันที่แบบ ISO เช่น 2026-09-30',
  })
  to?: string;
}

/// ตัวกรองของรายการที่มี "เจ้าของเป้าหมาย" — ไลก์และความคิดเห็น
export class ActivityQuery extends ActivityRangeQuery {
  @ApiPropertyOptional({
    example: '6700001382-somsak',
    description: 'เฉพาะของที่คนนี้เป็นเจ้าของ (เจ้าของคลิป/โพสต์ที่ฉันไปกดหรือคอมเมนต์)',
  })
  @IsOptional()
  @IsString()
  @Matches(CORE_USER_ID, { message: 'authorCoreUserId ไม่ถูกต้องตามรูปแบบของระบบกลาง' })
  authorCoreUserId?: string;
}

export class ActivityLikesQuery extends ActivityQuery {
  @ApiPropertyOptional({
    enum: ['REEL', 'POST'],
    default: 'REEL',
    description: 'REEL = คลิปที่ฉันกดไลก์ · POST = โพสต์ที่ฉันกดรีแอ็กชัน',
  })
  @IsOptional()
  @IsIn(['REEL', 'POST'], { message: 'target ต้องเป็น REEL หรือ POST' })
  target?: 'REEL' | 'POST';
}

export class ActivityMediaQuery extends ActivityRangeQuery {
  @ApiPropertyOptional({
    enum: ['POST', 'REEL'],
    default: 'REEL',
    description: 'REEL = คลิปของฉัน · POST = โพสต์ของฉัน',
  })
  @IsOptional()
  @IsIn(['POST', 'REEL'], { message: 'kind ต้องเป็น POST หรือ REEL' })
  kind?: 'POST' | 'REEL';
}

export class AccountHistoryQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ACTIVITY_ORDERS, default: 'newest' })
  @IsOptional()
  @IsIn(ACTIVITY_ORDERS, { message: 'order ต้องเป็น newest หรือ oldest' })
  order?: ActivityOrder;
}

/// คลิปที่ฉันกดไลก์ — รูปเดียวกับฟีดทุกช่อง แล้วเพิ่มเวลาที่กดและภาพย่อ
///
/// ขยายจาก ReelResponseDto ไม่ใช่สร้างรูปใหม่ เพื่อให้หน้าบ้านใช้การ์ดคลิป
/// ตัวเดียวกับฟีดได้เลย ไม่ต้องมีตัวแปลงอีกชั้น
export class LikedReelDto extends ReelResponseDto {
  @ApiProperty({ enum: ['REEL'] }) targetKind!: 'REEL';

  @ApiProperty({ description: 'เวลาที่ผู้เรียกกดไลก์ — รายการเรียงตามค่านี้' })
  likedAt!: string;

  @ApiProperty({
    nullable: true,
    description:
      'signed URL ของไฟล์วิดีโอ อายุ 5 นาที (คลิปไม่มีภาพปกแยก — ใช้ <video preload="metadata"> แสดงเฟรมแรก)',
  })
  thumbnailUrl!: string | null;
}

/// คลิปที่ฉันรีโพสต์ — รูปเดียวกับฟีด + เวลาที่รีโพสต์และภาพย่อ
export class RepostedReelDto extends ReelResponseDto {
  @ApiProperty({ enum: ['REEL'] }) targetKind!: 'REEL';
  @ApiProperty({ description: 'เวลาที่ผู้เรียกรีโพสต์ — รายการเรียงตามค่านี้' }) repostedAt!: string;
  @ApiProperty({ nullable: true, description: 'signed URL ของวิดีโอ อายุ 5 นาที' }) thumbnailUrl!: string | null;
}

/// โพสต์ที่ฉันกดรีแอ็กชัน — หนึ่งแถวต่อหนึ่งโพสต์ (อิโมจิล่าสุดที่กด)
export class ReactedPostDto {
  @ApiProperty({ enum: ['POST'] }) targetKind!: 'POST';
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;

  @ApiProperty({ description: 'ตัวอย่างเนื้อหา 160 ตัวอักษรแรก' })
  preview!: string;

  @ApiProperty() authorCoreUserId!: string;

  @ApiProperty({ example: '❤️', description: 'อิโมจิล่าสุดที่ผู้เรียกกดบนโพสต์นี้' })
  emoji!: string;

  @ApiProperty({
    nullable: true,
    description: 'signed URL ของรูป/วิดีโอชิ้นแรกของโพสต์ อายุ 5 นาที · null ถ้าโพสต์ไม่มีสื่อ',
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ nullable: true, enum: ['IMAGE', 'VIDEO'] })
  thumbnailKind!: 'IMAGE' | 'VIDEO' | null;

  @ApiProperty({ description: 'เวลาที่กดรีแอ็กชันล่าสุด — รายการเรียงตามค่านี้' })
  reactedAt!: string;
}

export class MyCommentDto {
  @ApiProperty() id!: string;

  @ApiProperty({ enum: ['REEL', 'POST'] })
  targetKind!: 'REEL' | 'POST';

  @ApiProperty({ description: 'id ของคลิปหรือโพสต์ที่ความคิดเห็นนี้อยู่' })
  targetId!: string;

  @ApiProperty({ description: 'ชื่อคลิปหรือหัวข้อโพสต์ ณ เวลาที่อ่าน' })
  targetTitle!: string;

  @ApiProperty({ description: 'เจ้าของคลิป/โพสต์นั้น' })
  targetAuthorCoreUserId!: string;

  @ApiProperty() content!: string;
  @ApiProperty() createdAt!: string;
}

/// โพสต์หรือคลิปของฉันเอง — กริด "รูปภาพและวิดีโอ" ของหน้ากิจกรรม
export class MyMediaDto {
  @ApiProperty({ enum: ['POST', 'REEL'] }) targetKind!: 'POST' | 'REEL';
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;

  @ApiProperty({ nullable: true, description: 'คำบรรยายคลิป หรือ 160 ตัวอักษรแรกของโพสต์' })
  preview!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'คลิป = signed URL ของวิดีโอ · โพสต์ = รูป/วิดีโอชิ้นแรก (null ถ้าไม่มีสื่อ) · อายุ 5 นาที',
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ nullable: true, enum: ['VIDEO', 'IMAGE'] })
  thumbnailKind!: 'VIDEO' | 'IMAGE' | null;

  @ApiProperty({ description: 'คลิป = ยอดไลก์ · โพสต์ = ยอดรีแอ็กชันรวม' })
  likeCount!: number;

  @ApiProperty() commentCount!: number;

  @ApiProperty({ nullable: true, description: 'ยอดคนดู (เฉพาะคลิป · โพสต์เป็น null)' })
  viewCount!: number | null;

  @ApiProperty() createdAt!: string;
}

/// การตอบกลับสตอรี่ของฉัน (ข้อความที่ฉันส่งไปหาเจ้าของสตอรี่)
export class MyStoryReplyDto {
  @ApiProperty({ description: 'id ของข้อความตอบกลับ' }) id!: string;
  @ApiProperty({ description: 'ห้อง DM ที่ข้อความอยู่ — เปิดแชทต่อได้' }) channelId!: string;
  @ApiProperty() storyId!: string;

  @ApiProperty({ nullable: true, description: 'เจ้าของสตอรี่ · null ถ้าสตอรี่ถูกลบไปแล้ว' })
  storyAuthorCoreUserId!: string | null;

  @ApiProperty({ enum: ['REPLY', 'REACTION'] }) kind!: 'REPLY' | 'REACTION';
  @ApiProperty({ nullable: true }) emoji!: string | null;
  @ApiProperty({ nullable: true }) content!: string | null;

  @ApiProperty({ type: MessageEmbedViewDto, description: 'การ์ดของสตอรี่ (available = false ถ้าหมดอายุและไม่อยู่ในไฮไลต์)' })
  story!: MessageEmbedViewDto;

  @ApiProperty() createdAt!: string;
}

export const ACCOUNT_HISTORY_KINDS = [
  'BIO_CHANGED',
  'BIO_REMOVED',
  'WEBSITE_CHANGED',
  'COVER_CHANGED',
  'COVER_REMOVED',
  'JOINED',
  'CONTENT_DELETED',
  'ROOM_CREATED',
] as const;
export type AccountHistoryKind = (typeof ACCOUNT_HISTORY_KINDS)[number];

export class AccountHistoryItemDto {
  @ApiProperty({ description: 'id ของแถว audit log · JOINED ใช้ "joined"' })
  id!: string;

  @ApiProperty({ enum: ACCOUNT_HISTORY_KINDS })
  kind!: AccountHistoryKind;

  @ApiProperty({
    nullable: true,
    description:
      'BIO_CHANGED = คำแนะนำตัวใหม่ · WEBSITE_CHANGED = เว็บไซต์ใหม่ (null = ลบ) · CONTENT_DELETED = POST | REEL | STORY · ROOM_CREATED = ชื่อห้อง (หรือชนิดห้องถ้าไม่มีชื่อ) · อื่น ๆ = null',
  })
  detail!: string | null;

  @ApiProperty() createdAt!: string;
}
