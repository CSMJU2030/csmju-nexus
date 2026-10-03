import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { ReactionSummaryDto } from '../../reactions/dto/reaction.dto.js';
import type {
  PostCommentModel,
  PostModel,
} from '../../../generated/prisma/models.js';

/// เพดานรูป/วิดีโอต่อโพสต์ — เท่ากับโพสต์หลายรูปของ Instagram
export const MAX_POST_MEDIA = 10;

/// สร้างโพสต์ — **ต้องมีอย่างน้อยหนึ่งใน title · content · assetIds**
///
/// โพสต์รูปล้วนแบบ Instagram ไม่ต้องมีหัวข้อหรือเนื้อหา · ช่องที่ไม่ส่งเก็บเป็น
/// สตริงว่าง (response คืน "" ไม่ใช่ null) เพื่อไม่ให้ตัวแสดงผลเดิมทุกตัวพัง
export class CreatePostDto {
  @ApiPropertyOptional({ example: 'ถามเรื่อง pointer ใน C ครับ' })
  @IsOptional()
  @IsString()
  @Length(1, 200, { message: 'หัวข้อต้องยาว 1-200 ตัวอักษร' })
  title?: string;

  @ApiPropertyOptional({ example: 'ทำไม *ptr กับ &var ให้ผลไม่เหมือนกันครับ' })
  @IsOptional()
  @IsString()
  @Length(1, 8000, { message: 'เนื้อหายาวได้ไม่เกิน 8000 ตัวอักษร' })
  content?: string;

  @ApiPropertyOptional({
    type: [String],
    description: `รูป/วิดีโอที่อัปโหลดและ commit แล้วของผู้เรียก สูงสุด ${MAX_POST_MEDIA} ไฟล์ เรียงตามลำดับที่แสดง`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_POST_MEDIA, { message: `แนบรูป/วิดีโอได้ไม่เกิน ${MAX_POST_MEDIA} ไฟล์` })
  @ArrayUnique({ message: 'มีไฟล์ซ้ำกันใน assetIds' })
  @IsUUID('4', { each: true, message: 'assetIds ต้องเป็น UUID ทุกตัว' })
  assetIds?: string[];

  @ApiPropertyOptional({
    example: 'CS201',
    description: 'แท็กวิชา ใช้กรองกระดานข่าวตามรายวิชา',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2,4}[0-9]{3}$/, {
    message: 'แท็กวิชาต้องอยู่ในรูปแบบเช่น CS201',
  })
  courseTag?: string;
}

export class CreateCommentDto {
  @ApiProperty({ example: 'ลองวาดภาพหน่วยความจำดูครับ จะเห็นชัดขึ้น' })
  @IsString()
  @Length(1, 4000)
  content!: string;
}

export class ListPostsQuery extends PaginationQuery {
  @ApiPropertyOptional({ example: 'CS201' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  courseTag?: string;

  @ApiPropertyOptional({
    enum: ['all', 'following'],
    default: 'all',
    description: 'following = เฉพาะกระทู้ของคนที่ฉันติดตาม (รวมของตัวเอง)',
  })
  @IsOptional()
  @IsIn(['all', 'following'])
  feed?: 'all' | 'following';

  @ApiPropertyOptional({
    example: '6700001382-somsak',
    description: 'เฉพาะกระทู้ของคนนี้ — ใช้ทำหน้าโปรไฟล์',
  })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  authorCoreUserId?: string;
}

export class PostMediaDto {
  @ApiProperty() assetId!: string;
  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] }) kind!: 'IMAGE' | 'VIDEO';
  @ApiProperty({ description: 'signed URL อายุ 5 นาที' }) url!: string;
  @ApiProperty({ example: 'image/jpeg' }) mimeType!: string;
}

export class PostResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: '"" ถ้าเป็นโพสต์รูปล้วนที่ไม่ตั้งหัวข้อ' }) title!: string;
  @ApiProperty({ description: '"" ถ้าเป็นโพสต์รูปล้วน' }) content!: string;

  @ApiProperty({ type: [PostMediaDto], description: 'รูป/วิดีโอตามลำดับที่โพสต์ ([] ถ้าไม่มี)' })
  media!: PostMediaDto[];

  @ApiProperty({ description: 'ผู้เรียกคอมเมนต์โพสต์นี้ได้ไหม (commentsFrom ของเจ้าของ + การบล็อก)' })
  canComment!: boolean;
  @ApiProperty({ nullable: true }) courseTag!: string | null;
  @ApiProperty({ example: '6700001382-somsak' }) authorCoreUserId!: string;
  @ApiProperty() commentCount!: number;

  @ApiProperty({
    type: ReactionSummaryDto,
    nullable: true,
    description: 'ยอดอิโมจิรีแอ็กชัน พร้อมบอกว่าผู้เรียกกดอะไรไว้',
  })
  reactions!: ReactionSummaryDto | null;

  @ApiProperty({ example: '2026-08-11T09:30:00+07:00' }) createdAt!: string;
}

export class PostCommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() authorCoreUserId!: string;
  @ApiProperty() content!: string;
  @ApiProperty() createdAt!: string;
}

export function toPostResponse(
  post: PostModel,
  reactions: ReactionSummaryDto | null = null,
  extra: { media?: PostMediaDto[]; canComment?: boolean } = {},
): PostResponseDto {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    media: extra.media ?? [],
    canComment: extra.canComment ?? true,
    courseTag: post.courseTag,
    authorCoreUserId: post.authorCoreUserId,
    commentCount: post.commentCount,
    reactions,
    createdAt: post.createdAt.toISOString(),
  };
}

export function toCommentResponse(
  comment: PostCommentModel,
): PostCommentResponseDto {
  return {
    id: comment.id,
    postId: comment.postId,
    authorCoreUserId: comment.authorCoreUserId,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
  };
}
