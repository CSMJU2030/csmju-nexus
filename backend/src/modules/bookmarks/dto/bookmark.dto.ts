import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { BookmarkTarget } from '../../../generated/prisma/enums.js';

export class CreateBookmarkDto {
  @ApiProperty({ enum: BookmarkTarget, example: 'POST' })
  @IsEnum(BookmarkTarget, { message: 'targetKind ต้องเป็น POST หรือ REEL' })
  targetKind!: BookmarkTarget;

  @ApiProperty({ example: '9f1c2b3a-0000-4000-8000-000000000000' })
  @IsUUID('4')
  targetId!: string;
}

export class ListBookmarksQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: BookmarkTarget })
  @IsOptional()
  @IsEnum(BookmarkTarget)
  targetKind?: BookmarkTarget;
}

export class BookmarkResponseDto {
  @ApiProperty({ enum: BookmarkTarget }) targetKind!: BookmarkTarget;
  @ApiProperty() targetId!: string;

  @ApiProperty({
    nullable: true,
    description: 'หัวข้อของสิ่งที่บันทึกไว้ ณ เวลาที่อ่าน — null ถ้าถูกลบไปแล้ว',
  })
  title!: string | null;

  @ApiProperty({ nullable: true }) authorCoreUserId!: string | null;
  @ApiProperty() createdAt!: string;
}
