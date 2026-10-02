import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/// รูปแบบ coreUserId ของ CSMJU2030 เช่น "6700001382-somsak"
/// ตรวจที่นี่เพื่อไม่ให้ใครยัดอักขระแปลก ๆ ลงกราฟการติดตาม
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

export class FollowDto {
  @ApiProperty({ example: '6700000001-ajarn' })
  @IsString()
  @Length(2, 64)
  @Matches(USERNAME_PATTERN, { message: 'รูปแบบ coreUserId ไม่ถูกต้อง' })
  coreUserId!: string;
}

export class FollowEdgeDto {
  @ApiProperty({ example: '6700001382-somsak' }) coreUserId!: string;
  @ApiProperty() createdAt!: string;
}

/// ความสัมพันธ์ระหว่างฉันกับอีกคน — หน้าบ้านใช้ตัดสินว่าปุ่มควรเขียนว่าอะไร
///
/// ติดตามเป็นทิศทางเดียว ความเป็นเพื่อนสองทางคำนวณจากการมีทั้งสองด้าน
/// จึงไม่ต้องมีขั้นตอน "ส่งคำขอเป็นเพื่อน / กดตอบรับ" ให้ผู้ใช้ทำ
export class RelationDto {
  @ApiProperty({ description: 'ฉันติดตามเขาอยู่ไหม' })
  following!: boolean;

  @ApiProperty({ description: 'เขาติดตามฉันอยู่ไหม' })
  followedBy!: boolean;

  @ApiProperty({ description: 'ติดตามกันทั้งสองทาง = เพื่อนกันแบบ Facebook' })
  mutual!: boolean;

  @ApiProperty({ description: 'ผู้เรียกบล็อกคนนี้ไว้ — ปุ่มโปรไฟล์ต้องเป็น "เลิกบล็อก"' })
  blockedByMe!: boolean;
}

export class SuggestionDto {
  @ApiProperty() coreUserId!: string;

  @ApiProperty({
    type: [String],
    description: 'คนที่ฉันติดตามซึ่งติดตามเขาอยู่ (สูงสุด 3 คน ล่าสุดก่อน) — "ติดตามโดย A, B"',
  })
  followedBy!: string[];

  @ApiProperty({ description: 'จำนวนคนที่ฉันติดตามซึ่งติดตามเขาอยู่ทั้งหมด' })
  followedByCount!: number;

  @ApiProperty({ description: 'ชื่อเดิมของ followedByCount', deprecated: true })
  mutualCount!: number;
}

export class FollowStatsDto {
  @ApiProperty({ example: 42 }) followerCount!: number;
  @ApiProperty({ example: 17 }) followingCount!: number;
}
