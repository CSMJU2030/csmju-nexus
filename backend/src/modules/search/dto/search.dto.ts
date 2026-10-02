import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';

export const SEARCH_KINDS = [
  'all',
  'reels',
  'posts',
  'people',
  'messages',
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/// จำนวนตัวอย่างต่อหมวดเมื่อค้นแบบ all — เท่ากับความสูงของ dropdown ที่อ่านได้
export const PREVIEW_PER_KIND = 5;

export class SearchQuery extends PaginationQuery {
  @ApiProperty({ example: 'pointer', description: 'คำค้น ยาว 2-100 ตัวอักษร' })
  @IsString()
  @Length(2, 100, { message: 'คำค้นต้องยาวอย่างน้อย 2 ตัวอักษร' })
  q!: string;

  @ApiPropertyOptional({
    enum: SEARCH_KINDS,
    default: 'all',
    description: 'all = ตัวอย่างทุกหมวดพร้อมยอดรวม · หมวดเดียว = แบ่งหน้าได้',
  })
  @IsOptional()
  @IsIn(SEARCH_KINDS)
  kind?: SearchKind;
}

export class SearchHitDto {
  @ApiProperty({ example: 'POST' }) kind!: string;
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;

  @ApiProperty({
    nullable: true,
    description: 'ข้อความรอบ ๆ คำค้น ตัดมาไม่เกิน 160 ตัวอักษร',
  })
  snippet!: string | null;

  @ApiProperty({ nullable: true }) authorCoreUserId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'มีเฉพาะผลที่เป็นข้อความแชท ใช้พาไปเปิดห้องที่ถูกต้อง',
  })
  channelId!: string | null;

  @ApiProperty({ nullable: true }) createdAt!: string | null;
}

export class SearchCountsDto {
  @ApiProperty({ example: 3 }) reels!: number;
  @ApiProperty({ example: 12 }) posts!: number;
  @ApiProperty({ example: 1 }) people!: number;
  @ApiProperty({ example: 48 }) messages!: number;
}

export class SearchAllResponseDto {
  @ApiProperty({ example: 'pointer' }) query!: string;
  @ApiProperty({ type: SearchCountsDto }) counts!: SearchCountsDto;

  @ApiProperty({
    type: [SearchHitDto],
    description: `ตัวอย่างไม่เกิน ${PREVIEW_PER_KIND} รายการต่อหมวด เรียงตามหมวด`,
  })
  hits!: SearchHitDto[];
}
