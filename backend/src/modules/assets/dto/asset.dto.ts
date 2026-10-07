import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { AssetModel } from '../../../generated/prisma/models.js';

export const BUCKETS = ['reels', 'attachments'] as const;
export type Bucket = (typeof BUCKETS)[number];

/// เพดานต่อไฟล์ — ไฟล์เก็บในฐานข้อมูลของระบบ (standards deployment.md ข้อ 4.3: ไม่เกิน 10 MB · PL ตัดสิน 7 ต.ค. 2569)
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class CreateUploadIntentDto {
  @ApiProperty({ example: 'project-final.zip' })
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @ApiProperty({
    description:
      'ขนาดที่ client แจ้ง ใช้กันโควตาล่วงหน้าเท่านั้น — ขนาดจริงยืนยันตอน commit',
    example: 4_812_004,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'ไฟล์ว่างอัปโหลดไม่ได้' })
  @Max(MAX_FILE_BYTES, {
    message: `ไฟล์ใหญ่ได้ไม่เกิน ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB`,
  })
  sizeBytes!: number;

  @ApiProperty({ enum: BUCKETS, example: 'attachments' })
  @IsIn(BUCKETS, { message: `bucket ต้องเป็น ${BUCKETS.join(' หรือ ')}` })
  bucket!: Bucket;

  /// Content-Type ที่เบราว์เซอร์รู้ (เช่น `audio/webm;codecs=opus` จาก MediaRecorder)
  ///
  /// **ไม่ใช่สิ่งที่ระบบเชื่อ** — ชนิดจริงยังตัดสินจากเนื้อไฟล์ตอน commit แต่ใช้แยก
  /// webm/mp4 ที่เป็นเสียงล้วนออกจากวิดีโอ ซึ่งหัวไฟล์ 16 ไบต์บอกไม่ได้
  @ApiPropertyOptional({
    example: 'audio/webm;codecs=opus',
    description:
      'ใบ้ชนิดไฟล์ (ไม่บังคับ) — ส่ง audio/* มากับไฟล์ .webm/.mp4 ที่เป็นข้อความเสียง ไม่งั้นจะถูกนับเป็นวิดีโอ',
  })
  @IsOptional()
  @IsString()
  @Length(3, 100)
  @Matches(/^[a-z]+\/[a-z0-9.+-]+(\s*;.*)?$/i, {
    message: 'contentType ต้องเป็น MIME type เช่น audio/webm',
  })
  contentType?: string;
}

export class UploadIntentResponseDto {
  @ApiProperty() assetId!: string;

  @ApiProperty({
    description: 'ให้เบราว์เซอร์ PUT ไบต์ไปที่นี่ตรง ๆ ไม่ผ่าน backend',
  })
  uploadUrl!: string;

  @ApiProperty({ example: 'PUT' }) uploadMethod!: string;

  @ApiProperty({
    description: 'header ที่ต้องแนบไปกับ PUT',
    example: { 'content-type': 'application/octet-stream' },
  })
  uploadHeaders!: Record<string, string>;

  @ApiProperty({ example: '2026-08-11T09:31:00+07:00' })
  expiresAt!: string;
}

export class AssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() ownerCoreUserId!: string;
  @ApiProperty() bucket!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'AUDIO', 'CODE', 'DOCUMENT', 'ARCHIVE'] })
  kind!: string;

  @ApiProperty({
    description: 'ขนาดจริงเป็นไบต์ ส่งเป็น string เพราะ BigInt เกินช่วง JSON number',
    example: '4812004',
  })
  sizeBytes!: string;

  @ApiProperty({ enum: ['PENDING', 'READY', 'BLOCKED', 'DELETED'] })
  status!: string;

  @ApiProperty() createdAt!: string;
}

export class DownloadUrlResponseDto {
  @ApiProperty() downloadUrl!: string;
  @ApiProperty() expiresAt!: string;

  @ApiProperty({
    description:
      'true = เบราว์เซอร์จะบังคับดาวน์โหลด ไม่เรนเดอร์เป็นหน้าเว็บ',
  })
  asAttachment!: boolean;
}

export function toAssetResponse(asset: AssetModel): AssetResponseDto {
  return {
    id: asset.id,
    ownerCoreUserId: asset.ownerCoreUserId,
    bucket: asset.bucket,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes.toString(),
    status: asset.status,
    createdAt: asset.createdAt.toISOString(),
  };
}
