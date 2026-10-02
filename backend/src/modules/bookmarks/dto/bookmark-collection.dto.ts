import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { BookmarkTarget } from '../../../generated/prisma/enums.js';
import { CreateBookmarkDto } from './bookmark.dto.js';

/// เพดานรายการที่ใส่มาพร้อมตอนสร้างคอลเลกชัน — หน้าจอ "คอลเลกชันใหม่" ของ
/// Instagram ให้ติ๊กเลือกจากที่บันทึกไว้ หนึ่งหน้าจอไม่เคยถึงร้อย
export const MAX_COLLECTION_SEED_ITEMS = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/// ของหนึ่งชิ้นในคอลเลกชัน — รูปเดียวกับ body ของ POST /bookmarks
export class CollectionItemRefDto extends CreateBookmarkDto {}

export class CreateBookmarkCollectionDto {
  @ApiProperty({ example: 'สรุปก่อนสอบ', minLength: 1, maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'ชื่อคอลเลกชันต้องยาว 1-60 ตัวอักษร' })
  name!: string;

  @ApiPropertyOptional({
    type: [CollectionItemRefDto],
    description: `ของที่จะใส่ตั้งแต่ต้น (สูงสุด ${MAX_COLLECTION_SEED_ITEMS}) — ทุกชิ้นต้องบันทึกไว้แล้ว`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLLECTION_SEED_ITEMS, {
    message: `ใส่ได้ครั้งละไม่เกิน ${MAX_COLLECTION_SEED_ITEMS} รายการ`,
  })
  @ValidateNested({ each: true })
  @Type(() => CollectionItemRefDto)
  items?: CollectionItemRefDto[];
}

export class RenameBookmarkCollectionDto {
  @ApiProperty({ example: 'สรุปก่อนสอบปลายภาค' })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'ชื่อคอลเลกชันต้องยาว 1-60 ตัวอักษร' })
  name!: string;
}

export class CollectionCoverDto {
  @ApiProperty({ enum: BookmarkTarget }) targetKind!: BookmarkTarget;
  @ApiProperty() targetId!: string;
}

export class BookmarkCollectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 12 }) itemCount!: number;

  @ApiProperty({
    type: CollectionCoverDto,
    nullable: true,
    description: 'ของชิ้นล่าสุดที่ใส่เข้าคอลเลกชัน ใช้เป็นภาพปก — null ถ้าว่าง',
  })
  cover!: CollectionCoverDto | null;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
