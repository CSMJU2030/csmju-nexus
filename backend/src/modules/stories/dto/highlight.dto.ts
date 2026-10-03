import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

/// เพดานสตอรี่ต่อหนึ่งไฮไลต์ — Instagram ให้ 100 ชิ้น
export const MAX_HIGHLIGHT_ITEMS = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateHighlightDto {
  @ApiProperty({ example: 'ค่ายคอม 2569', minLength: 1, maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: 'ชื่อไฮไลต์ต้องยาว 1-40 ตัวอักษร' })
  title!: string;

  @ApiProperty({
    type: [String],
    description: `สตอรี่ของตัวเอง 1-${MAX_HIGHLIGHT_ITEMS} ชิ้น เรียงตามลำดับที่จะแสดง (หมดอายุแล้วก็ใส่ได้)`,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'ไฮไลต์ต้องมีสตอรี่อย่างน้อยหนึ่งชิ้น' })
  @ArrayMaxSize(MAX_HIGHLIGHT_ITEMS, {
    message: `ไฮไลต์หนึ่งอันมีสตอรี่ได้ไม่เกิน ${MAX_HIGHLIGHT_ITEMS} ชิ้น`,
  })
  @ArrayUnique({ message: 'มีสตอรี่ซ้ำกันในรายการ' })
  @IsUUID('4', { each: true, message: 'storyIds ต้องเป็น UUID ทุกตัว' })
  storyIds!: string[];

  @ApiPropertyOptional({
    description: 'สตอรี่ที่ใช้เป็นหน้าปก ต้องอยู่ใน storyIds — ไม่ส่ง = ใช้ชิ้นแรก',
  })
  @IsOptional()
  @IsUUID('4', { message: 'coverStoryId ต้องเป็น UUID' })
  coverStoryId?: string;
}

/// แก้ไฮไลต์ — ส่ง storyIds = แทนที่รายการทั้งชุดตามลำดับใหม่ (ไม่ใช่ต่อท้าย)
///
/// แทนที่ทั้งชุดเพราะหน้าจอแก้ไขของ Instagram เป็นตารางติ๊กเลือก ผู้ใช้เห็นทั้งชุด
/// อยู่แล้ว ส่งทั้งชุดกลับมาง่ายกว่าและไม่มีปัญหาลำดับชนกันระหว่างสองคำสั่ง
export class UpdateHighlightDto {
  @ApiPropertyOptional({ example: 'ค่ายคอม 2569 (ครบ)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: 'ชื่อไฮไลต์ต้องยาว 1-40 ตัวอักษร' })
  title?: string;

  @ApiPropertyOptional({ type: [String], description: 'แทนที่รายการสตอรี่ทั้งชุด' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'ไฮไลต์ต้องมีสตอรี่อย่างน้อยหนึ่งชิ้น — ถ้าไม่ต้องการแล้วให้ลบไฮไลต์' })
  @ArrayMaxSize(MAX_HIGHLIGHT_ITEMS, {
    message: `ไฮไลต์หนึ่งอันมีสตอรี่ได้ไม่เกิน ${MAX_HIGHLIGHT_ITEMS} ชิ้น`,
  })
  @ArrayUnique({ message: 'มีสตอรี่ซ้ำกันในรายการ' })
  @IsUUID('4', { each: true, message: 'storyIds ต้องเป็น UUID ทุกตัว' })
  storyIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'เปลี่ยนหน้าปก (ต้องอยู่ในไฮไลต์) · null = กลับไปใช้ชิ้นแรก',
  })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsUUID('4', { message: 'coverStoryId ต้องเป็น UUID หรือ null' })
  coverStoryId?: string | null;
}

export class HighlightSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() ownerCoreUserId!: string;
  @ApiProperty() title!: string;

  @ApiProperty({ nullable: true, description: 'หน้าปกที่ตั้งไว้ — null = ใช้ชิ้นแรก' })
  coverStoryId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'signed URL ของหน้าปก อายุ 5 นาที — null ถ้าไฮไลต์ว่าง',
  })
  coverMediaUrl!: string | null;

  @ApiProperty({ nullable: true, enum: ['IMAGE', 'VIDEO'] })
  coverMediaKind!: string | null;

  @ApiProperty({ example: 7 }) itemCount!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class HighlightItemDto {
  @ApiProperty() storyId!: string;
  @ApiProperty({ description: 'ลำดับในไฮไลต์ เริ่มที่ 0' }) position!: number;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] })
  mediaKind!: string;

  @ApiProperty({ description: 'signed URL อายุ 5 นาที' })
  mediaUrl!: string;

  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() expiresAt!: string;
}

export class HighlightDetailDto extends HighlightSummaryDto {
  @ApiProperty({ type: [HighlightItemDto], description: 'เรียงตาม position' })
  items!: HighlightItemDto[];
}
