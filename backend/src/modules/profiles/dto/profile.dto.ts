import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

/// เว็บไซต์บนโปรไฟล์ — http/https เท่านั้น ตรวจด้วยตัวแยก URL มาตรฐาน (WHATWG)
///
/// ไม่ใช้ regex เพราะ URL ที่ "ดูถูก" กับ URL ที่เบราว์เซอร์เปิดได้จริงไม่ใช่ชุดเดียวกัน
/// และต้องกัน javascript: / data: ซึ่งเป็น stored XSS ทันทีที่หน้าบ้านทำเป็นลิงก์
export function IsHttpUrl(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isHttpUrl',
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;

          try {
            const url = new URL(value);

            return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
          } catch {
            return false;
          }
        },
        defaultMessage: () => 'website ต้องเป็นลิงก์ http:// หรือ https:// ที่ถูกต้อง',
      },
    },
    options,
  );
}
import { RelationDto } from '../../follows/dto/follow.dto.js';

export class ResolveProfilesQuery {
  @ApiPropertyOptional({
    description: 'รายชื่อ coreUserId คั่นด้วยลูกน้ำ สูงสุด 100 ชื่อต่อครั้ง',
    example: '6700001382-somsak,6700000001-ajarn',
  })
  @IsOptional()
  @IsString()
  @Length(1, 6500)
  coreUserIds?: string;
}

export class ProfileSummaryDto {
  @ApiProperty({ example: '6700001382-somsak' }) coreUserId!: string;

  @ApiProperty({
    description:
      'ชื่อที่แสดง มาจาก Core ผ่านแคช — ถ้ายังไม่เคยซิงก์จะคืน coreUserId ไปก่อน',
    example: 'สมศักดิ์ ใจดี',
  })
  displayName!: string;

  @ApiProperty({ nullable: true }) avatarUrl!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'เวลาที่ซิงก์จาก Core ล่าสุด — null คือยังไม่เคยซิงก์',
  })
  syncedAt!: string | null;

  @ApiProperty({
    enum: ['ADMIN', 'STAFF'],
    nullable: true,
    description:
      'เครื่องหมายยืนยันข้างชื่อ · null = สมาชิกทั่วไป · มาจาก layer2Role ของระบบย่อยนี้ ไม่ใช่ coreRole (ซึ่งเราห้ามเก็บตามหน้า 10)',
  })
  badge!: 'ADMIN' | 'STAFF' | null;
}

export class ProfileStatsDto {
  @ApiProperty({ example: 12 }) reelCount!: number;
  @ApiProperty({ example: 34 }) postCount!: number;
  @ApiProperty({ example: 128 }) followerCount!: number;
  @ApiProperty({ example: 76 }) followingCount!: number;
}

export class ProfileDetailDto extends ProfileSummaryDto {
  @ApiProperty({ type: ProfileStatsDto }) stats!: ProfileStatsDto;

  @ApiProperty({
    type: RelationDto,
    description: 'ความสัมพันธ์ระหว่างผู้เรียกกับเจ้าของโปรไฟล์นี้',
  })
  relation!: RelationDto;

  @ApiProperty({
    nullable: true,
    description:
      'สิทธิ์ในระบบย่อยนี้ (Layer 2) — แสดงเฉพาะโปรไฟล์ตัวเอง เพราะสิทธิ์ของคนอื่นไม่ใช่ข้อมูลสาธารณะ',
    example: 'GUEST',
  })
  layer2Role!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'เข้าใช้ระบบย่อยนี้ครั้งแรกเมื่อไหร่',
  })
  joinedAt!: string | null;

  /// คำแนะนำตัวกับรูปปกเขียนไว้ให้คนในชุมชนนี้อ่าน (Local Data ของระบบย่อย)
  /// จึงเห็นได้ทุกคน — เดิมส่งมาเฉพาะ /profiles/me โปรไฟล์ของคนอื่นเลยไม่มี
  /// คำแนะนำตัวเลย ต่างจาก Instagram ที่ bio คือสิ่งแรกที่คนอ่าน
  @ApiProperty({ nullable: true, description: 'คำแนะนำตัวในระบบย่อยนี้' })
  bio!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'signed URL ของรูปปก — อายุสั้น ขอใหม่ได้ทุกครั้งที่โหลดโปรไฟล์',
  })
  coverUrl!: string | null;

  @ApiProperty({ nullable: true, example: 'https://example.com/somsak', description: 'เว็บไซต์บนโปรไฟล์ (http/https)' })
  website!: string | null;
}

/// แก้ได้เฉพาะสิ่งที่เป็นของระบบย่อยนี้
///
/// **ไม่มี displayName / avatarUrl / faculty ในนี้โดยตั้งใจ** —
/// Blueprint หน้า 10 กำหนดว่า Core เป็นแหล่งความจริงของตัวตน ถ้าเปิดให้แก้
/// ที่นี่จะเกิดสองเวอร์ชันของชื่อคนเดียวกัน แล้วไม่มีใครรู้ว่าอันไหนจริง
///
/// สิ่งที่แก้ได้คือ **เนื้อหาที่ผู้ใช้เขียนเพื่อชุมชนนี้** ซึ่งเป็นของเขาเอง
/// เหมือนโพสต์หรือคอมเมนต์
export class UpdateMyProfileDto {
  @ApiPropertyOptional({
    example: 'ปี 3 สาขาวิทยาการคอมพิวเตอร์ · สนใจ backend และ DevOps',
    description: 'คำแนะนำตัวในระบบย่อยนี้ · ส่งสตริงว่างเพื่อลบ',
  })
  @IsOptional()
  @IsString()
  @Length(0, 300, { message: 'คำแนะนำตัวยาวได้ไม่เกิน 300 ตัวอักษร' })
  bio?: string;

  @ApiPropertyOptional({
    description:
      'ไฟล์รูปปก ต้องอัปโหลดและ commit เสร็จแล้ว · ส่ง null เพื่อเอารูปปกออก',
    nullable: true,
  })
  @IsOptional()
  // ยอมรับ null เพื่อสั่งลบรูปปก — ValidateIf ปล่อยผ่านเมื่อเป็น null
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  coverAssetId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://example.com/somsak',
    description: 'เว็บไซต์บนโปรไฟล์ — http/https เท่านั้น ≤ 200 ตัวอักษร · null หรือ "" = ลบ',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsString({ message: 'website ต้องเป็นข้อความ' })
  @MaxLength(200, { message: 'website ยาวได้ไม่เกิน 200 ตัวอักษร' })
  @IsHttpUrl()
  website?: string | null;
}

export class MyProfileDto extends ProfileDetailDto {
  @ApiProperty({
    description:
      'field ที่แก้ที่ระบบย่อยนี้ไม่ได้ เพราะ Core เป็นแหล่งความจริง (หน้า 10)',
    example: ['displayName', 'avatarUrl', 'faculty', 'coreRole'],
  })
  managedByCore!: string[];
}
