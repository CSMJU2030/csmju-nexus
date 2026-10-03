import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export const NOTE_AUDIENCES = ['MUTUAL_FOLLOWERS', 'CLOSE_FRIENDS'] as const;
export type NoteAudienceValue = (typeof NOTE_AUDIENCES)[number];

/// อายุของโน้ต — 24 ชั่วโมงเหมือน Instagram (เก็บเป็นเวลาหมดอายุตายตัว
/// ด้วยเหตุผลเดียวกับ STORY_TTL_MS: เปลี่ยนค่านี้แล้วโน้ตเก่าต้องไม่ยืดอายุตาม)
export const NOTE_TTL_MS = 24 * 60 * 60 * 1000;

/// เพดานจำนวนโน้ตที่ส่งกลับหนึ่งครั้ง — แถวโน้ตเหนือกล่องข้อความเลื่อนแนวนอน
/// คนไม่เลื่อนดูเกินนี้ และทุกแถวยังต้องแปลงชื่อที่หน้าบ้านอีกรอบ
export const NOTE_LIST_LIMIT = 100;

export class PutNoteDto {
  @ApiProperty({ example: 'ใครว่างติวคืนนี้บ้าง 📚', minLength: 1, maxLength: 60 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 60, { message: 'โน้ตต้องยาว 1-60 ตัวอักษร (ไม่นับช่องว่างหัวท้าย)' })
  text!: string;

  @ApiPropertyOptional({
    enum: NOTE_AUDIENCES,
    default: 'MUTUAL_FOLLOWERS',
    description: 'MUTUAL_FOLLOWERS = คนที่ติดตามกันทั้งสองทาง · CLOSE_FRIENDS = เฉพาะเพื่อนสนิท',
  })
  @IsOptional()
  @IsIn(NOTE_AUDIENCES, { message: 'audience ต้องเป็น MUTUAL_FOLLOWERS หรือ CLOSE_FRIENDS' })
  audience?: NoteAudienceValue;
}

export class NoteDto {
  @ApiProperty() coreUserId!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: NOTE_AUDIENCES }) audience!: NoteAudienceValue;
  @ApiProperty() createdAt!: string;

  @ApiProperty({ description: 'หลังเวลานี้โน้ตหายเอง (บังคับตอนอ่าน)' })
  expiresAt!: string;

  @ApiProperty({ description: 'true = โน้ตของผู้เรียกเอง (อยู่ลำดับแรกเสมอ)' })
  isMe!: boolean;
}
