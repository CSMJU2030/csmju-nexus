import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import type {
  ReelCommentModel,
  ReelModel,
} from '../../../generated/prisma/models.js';

/// JSON field ต้องเป็น camelCase ทั้งหมด (api-conventions.md ข้อ 3)
/// จึงตั้งชื่อ property เป็น camelCase ตรง ๆ แทนที่จะพึ่ง interceptor แปลงชื่อ
/// เพราะแบบนี้ openapi.json สะท้อนของจริงเสมอ ไม่มีเวทมนตร์ซ่อน

export class CreateReelDto {
  @ApiProperty({ example: 'โชว์ UI ฟีด Reels ด้วย Tailwind' })
  @IsString()
  @Length(1, 120, { message: 'title ต้องยาว 1-120 ตัวอักษร' })
  title!: string;

  @ApiPropertyOptional({ example: 'ทำด้วย Next.js + Framer Motion #CSNexus' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  caption?: string;

  @ApiProperty({
    description: 'id ของ Asset ที่ commit แล้วและสถานะเป็น READY',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'assetId ต้องเป็น UUID' })
  assetId!: string;

  @ApiProperty({
    description: 'ความยาวคลิปเป็นมิลลิวินาที สูงสุด 60 วินาที',
    example: 28500,
  })
  @IsInt()
  @Min(1000, { message: 'คลิปต้องยาวกว่า 1 วินาที' })
  @Max(60_000, { message: 'คลิปยาวได้ไม่เกิน 60 วินาที เพื่อคุมค่าข้อมูลขาออก' })
  durationMs!: number;
}

export class ReelResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty() assetId!: string;
  @ApiProperty() durationMs!: number;

  @ApiProperty({
    description: 'Shared Identity ของเจ้าของคลิป — ไม่มี student_id ซ้ำซ้อน',
    example: '6700001382-somsak',
  })
  authorCoreUserId!: string;

  @ApiProperty() likeCount!: number;
  @ApiProperty() viewCount!: number;
  @ApiProperty({ description: 'ผู้เรียกกดไลก์คลิปนี้ไว้หรือยัง' })
  likedByMe!: boolean;

  /// นับรวมความคิดเห็นระดับบนสุดและคำตอบที่ยังไม่ถูกลบ — ตัวเลขใต้ไอคอนความคิดเห็น
  ///
  /// คำนวณเป็นชุดต่อหนึ่งหน้า (groupBy ครั้งเดียว) เดิมหน้าบ้านต้องยิง
  /// GET /comments หนึ่งครั้งต่อคลิปเพื่ออ่าน meta.total ซึ่งเป็น N+1 ข้ามเครือข่าย
  @ApiProperty({
    example: 14,
    description: 'จำนวนความคิดเห็นทั้งหมด (รวมคำตอบ ไม่นับที่ถูกลบ)',
  })
  commentCount!: number;

  @ApiProperty({ example: 3, description: 'จำนวนคนที่รีโพสต์คลิปนี้' })
  repostCount!: number;

  @ApiProperty({ description: 'ผู้เรียกรีโพสต์คลิปนี้ไว้ไหม' })
  repostedByMe!: boolean;

  @ApiProperty({
    description:
      'ผู้เรียกคอมเมนต์คลิปนี้ได้ไหม (commentsFrom ของเจ้าของ + การบล็อก) — false ให้ซ่อนช่องพิมพ์',
  })
  canComment!: boolean;

  @ApiProperty({
    description: 'ISO 8601 พร้อม offset ตามมาตรฐาน',
    example: '2026-08-11T09:30:00+07:00',
  })
  createdAt!: string;
}

/// map แถวจากฐานข้อมูลเป็น payload มาตรฐาน (camelCase · ตัดฟิลด์ภายในออก)
export function toReelResponse(
  reel: ReelModel,
  options: {
    likedByMe: boolean;
    commentCount?: number;
    repostedByMe?: boolean;
    canComment?: boolean;
  },
): ReelResponseDto {
  return {
    id: reel.id,
    title: reel.title,
    caption: reel.caption,
    assetId: reel.assetId,
    durationMs: reel.durationMs,
    authorCoreUserId: reel.authorCoreUserId,
    likeCount: reel.likeCount,
    viewCount: reel.viewCount,
    likedByMe: options.likedByMe,
    commentCount: options.commentCount ?? 0,
    repostCount: reel.repostCount,
    repostedByMe: options.repostedByMe ?? false,
    canComment: options.canComment ?? true,
    createdAt: reel.createdAt.toISOString(),
  };
}

export class ListReelsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    enum: ['all', 'following'],
    default: 'all',
    description:
      'following = เฉพาะคลิปของคนที่ฉันติดตาม (รวมของตัวเอง) — ฟีดแบบ Instagram',
  })
  @IsOptional()
  @IsIn(['all', 'following'])
  feed?: 'all' | 'following';

  @ApiPropertyOptional({
    example: '6700001382-somsak',
    description: 'เฉพาะคลิปของคนนี้ — ใช้ทำหน้าโปรไฟล์',
  })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  authorCoreUserId?: string;
}

export class CreateReelCommentDto {
  @ApiProperty({ example: 'ตัดต่อดีมากครับ' })
  @IsString()
  @Length(1, 1000)
  content!: string;

  @ApiPropertyOptional({
    description:
      'ตอบกลับความคิดเห็นนี้ — ต้องเป็นความคิดเห็นระดับบนสุดของคลิปเดียวกัน (ตอบได้ชั้นเดียวแบบ Instagram)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'parentId ต้องเป็น UUID' })
  parentId?: string;
}

export class ListReelCommentsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description:
      'ไม่ส่ง = ความคิดเห็นระดับบนสุด (ใหม่สุดก่อน) · ส่ง id = คำตอบของความคิดเห็นนั้น (เก่าไปใหม่)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'parentId ต้องเป็น UUID' })
  parentId?: string;
}

export class ReelCommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() reelId!: string;
  @ApiProperty() authorCoreUserId!: string;
  @ApiProperty() content!: string;

  @ApiProperty({
    nullable: true,
    description: 'null = ความคิดเห็นระดับบนสุด · มีค่า = คำตอบของความคิดเห็นนั้น',
  })
  parentId!: string | null;

  @ApiProperty({ example: 3, description: 'จำนวนคำตอบ (เฉพาะระดับบนสุด คำตอบเป็น 0 เสมอ)' })
  replyCount!: number;

  @ApiProperty({ example: 12 }) likeCount!: number;

  @ApiProperty({ description: 'ผู้เรียกกดใจความคิดเห็นนี้ไว้ไหม' })
  likedByMe!: boolean;

  @ApiProperty() createdAt!: string;
}

export class RepostStateDto {
  @ApiProperty({ example: 4 }) repostCount!: number;
  @ApiProperty() repostedByMe!: boolean;
}

export class CommentLikeDto {
  @ApiProperty({ example: 12 }) likeCount!: number;
  @ApiProperty() likedByMe!: boolean;
}

export function toReelCommentResponse(
  comment: ReelCommentModel,
  options: { likedByMe: boolean },
): ReelCommentResponseDto {
  return {
    id: comment.id,
    reelId: comment.reelId,
    authorCoreUserId: comment.authorCoreUserId,
    content: comment.content,
    parentId: comment.parentId,
    replyCount: comment.replyCount,
    likeCount: comment.likeCount,
    likedByMe: options.likedByMe,
    createdAt: comment.createdAt.toISOString(),
  };
}
