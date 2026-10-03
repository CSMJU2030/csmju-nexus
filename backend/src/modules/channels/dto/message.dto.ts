import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_EMOJI_LENGTH, SINGLE_EMOJI } from '../../reactions/dto/reaction.dto.js';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';

export class MessageEmbedDto {
  @ApiProperty({ enum: ['REEL', 'POST'] })
  @IsIn(['REEL', 'POST'])
  kind!: 'REEL' | 'POST';

  @ApiProperty()
  @IsUUID('4')
  refId!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'ส่งไฟล์โปรเจกต์ให้แล้วนะ' })
  @IsOptional()
  @IsString()
  @Length(1, 4000, { message: 'ข้อความยาวได้ไม่เกิน 4000 ตัวอักษร' })
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'แนบไฟล์ได้ครั้งละไม่เกิน 10 ไฟล์' })
  @IsUUID('4', { each: true })
  assetIds?: string[];

  @ApiPropertyOptional({
    type: MessageEmbedDto,
    description: 'แชร์คลิป Reels หรือโพสต์เข้าแชท — แสดงเป็น mini player',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageEmbedDto)
  embed?: MessageEmbedDto;

  @ApiPropertyOptional({
    description:
      'ตอบกลับในเธรดของข้อความนี้ (แบบ Discord/Teams) — ข้อความที่มี parentId ' +
      'จะไม่โผล่ในไทม์ไลน์หลัก และเธรดซ้อนเธรดไม่ได้',
  })
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @ApiPropertyOptional({
    description:
      '"ตอบกลับ" แบบ Instagram — อ้างข้อความนี้ไว้เหนือข้อความใหม่ในไทม์ไลน์หลัก ต้องอยู่ห้องเดียวกัน (คนละเรื่องกับ parentId ที่เป็นเธรด)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'replyToMessageId ต้องเป็น UUID' })
  replyToMessageId?: string;

  @ApiProperty({
    description:
      'client สร้างเอง กันส่งซ้ำตอนเน็ตกระตุก และใช้เป็นคีย์ชั่วคราวใน UI',
    example: '01J9F2K7Q8',
  })
  @IsString()
  @Length(6, 64)
  clientNonce!: string;
}

export class EditMessageDto {
  @ApiProperty({ example: 'ขอแก้เป็น struct ไม่ใช่ class ครับ' })
  @IsString()
  @Length(1, 4000)
  content!: string;
}

export class ListMessagesQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description:
      'ดึงเฉพาะข้อความที่ seq มากกว่าค่านี้ — ใช้ตอน socket หลุดแล้วต่อใหม่ ' +
      'เพื่อเติมช่วงที่ขาดโดยไม่ต้องโหลดทั้งห้อง',
    example: 1420,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSeq?: number;
}

export class MessageAttachmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ example: '48120' }) sizeBytes!: string;
}

/// การ์ดของสิ่งที่แชร์เข้าแชท — คำนวณตอนอ่านทุกครั้ง (ดู EmbedsService)
export class MessageEmbedViewDto {
  @ApiProperty({ enum: ['POST', 'REEL', 'STORY'] }) kind!: 'POST' | 'REEL' | 'STORY';
  @ApiProperty() targetId!: string;

  @ApiProperty({ description: 'ชื่อเดิมของ targetId — คงไว้ให้หน้าบ้านรุ่นก่อนไม่พัง', deprecated: true })
  refId!: string;

  @ApiProperty({ nullable: true, description: 'เจ้าของโพสต์/คลิป/สตอรี่ · null เมื่อถูกลบไปแล้ว' })
  authorCoreUserId!: string | null;

  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ nullable: true, description: '120 ตัวอักษรแรกของเนื้อหา/คำบรรยาย' }) preview!: string | null;

  @ApiProperty({ nullable: true, description: 'signed URL อายุ 5 นาที' })
  thumbnailUrl!: string | null;

  @ApiProperty({ nullable: true, enum: ['IMAGE', 'VIDEO'] })
  thumbnailKind!: 'IMAGE' | 'VIDEO' | null;

  @ApiProperty({
    description:
      'false = ถูกลบแล้ว · สตอรี่หมดอายุและไม่อยู่ในไฮไลต์ · หรือผู้ดูบล็อกกันกับเจ้าของ (title/preview/thumbnail เป็น null)',
  })
  available!: boolean;
}

/// กล่อง "ตอบกลับ" เหนือข้อความ
export class MessageReplyToDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorCoreUserId!: string;

  @ApiProperty({ nullable: true, description: '120 ตัวอักษรแรก · null ถ้าเป็นไฟล์แนบล้วนหรือถูกลบ' })
  preview!: string | null;

  @ApiProperty({ nullable: true, enum: ['IMAGE', 'VIDEO', 'AUDIO', 'FILE'] })
  attachmentKind!: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | null;

  @ApiProperty({ description: 'ข้อความต้นทางถูกลบไปแล้ว — หน้าบ้านเขียนว่า "ข้อความถูกลบ"' })
  deleted!: boolean;
}

/// บันทึกการโทรในแชท — มีเฉพาะข้อความระบบที่เกิดจากการโทร (content เป็น null)
///
/// ระหว่างสาย endedAt = null: กำลังเรียก → status 'MISSED' (ค่าที่จะเป็นถ้าไม่มีใครรับ)
/// · รับแล้วกำลังคุย → status 'ANSWERED' และ durationSec = null · จบแล้ว endedAt มีค่าเสมอ
export class CallLogDto {
  @ApiProperty({ enum: ['AUDIO', 'VIDEO'] }) media!: 'AUDIO' | 'VIDEO';

  @ApiProperty({ enum: ['ANSWERED', 'MISSED', 'DECLINED', 'CANCELLED'] })
  status!: 'ANSWERED' | 'MISSED' | 'DECLINED' | 'CANCELLED';

  @ApiProperty({ nullable: true, description: 'ความยาวสายเป็นวินาที (เฉพาะ ANSWERED ที่จบแล้ว)' })
  durationSec!: number | null;

  @ApiProperty() callerCoreUserId!: string;
  @ApiProperty() startedAt!: string;

  @ApiProperty({ nullable: true, description: 'null = สายยังไม่จบ (กำลังเรียกหรือกำลังคุย)' })
  endedAt!: string | null;
}

export class StoryReplyInfoDto {
  @ApiProperty({ enum: ['REPLY', 'REACTION'] }) kind!: 'REPLY' | 'REACTION';
  @ApiProperty({ nullable: true }) emoji!: string | null;
}

/// ปลายทางของการส่งต่อ/แชร์ — ห้องที่มีอยู่แล้ว หรือคนที่จะเปิด DM ให้อัตโนมัติ
export class MessageTargetsDto {
  @ApiPropertyOptional({ type: [String], description: 'ห้องที่ผู้เรียกเป็นสมาชิก' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'ส่งได้ครั้งละไม่เกิน 20 ปลายทาง' })
  @IsUUID('4', { each: true, message: 'channelIds ต้องเป็น UUID ทุกตัว' })
  channelIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'ส่งเข้า DM ของคนเหล่านี้ (เปิดห้องให้ถ้ายังไม่มี)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'ส่งได้ครั้งละไม่เกิน 20 ปลายทาง' })
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9._-]{3,64}$/, {
    each: true,
    message: 'coreUserId ไม่ถูกต้องตามรูปแบบของระบบกลาง',
  })
  peerCoreUserIds?: string[];
}

export class ForwardMessageDto extends MessageTargetsDto {}

export class DeliveryResultDto {
  @ApiProperty({ type: [String], description: 'ห้องที่ส่งถึงจริง ตามลำดับที่ส่ง' })
  channelIds!: string[];

  @ApiProperty({ type: [String], description: 'id ของข้อความที่สร้าง (ลำดับเดียวกับ channelIds)' })
  messageIds!: string[];
}

export class CreateShareDto extends MessageTargetsDto {
  @ApiProperty({ enum: ['POST', 'REEL', 'STORY'] })
  @IsIn(['POST', 'REEL', 'STORY'], { message: 'targetKind ต้องเป็น POST, REEL หรือ STORY' })
  targetKind!: 'POST' | 'REEL' | 'STORY';

  @ApiProperty()
  @IsUUID('4', { message: 'targetId ต้องเป็น UUID' })
  targetId!: string;

  @ApiPropertyOptional({ description: 'ข้อความแนบไปกับการแชร์ (ไม่เกิน 1000 ตัวอักษร)' })
  @IsOptional()
  @IsString()
  @Length(1, 1000, { message: 'ข้อความแนบยาว 1-1000 ตัวอักษร' })
  message?: string;
}

export class StoryReplyDto {
  @ApiPropertyOptional({ description: 'พิมพ์ตอบ — ส่ง content หรือ emoji อย่างใดอย่างหนึ่ง' })
  @IsOptional()
  @IsString()
  @Length(1, 1000, { message: 'ข้อความตอบกลับยาว 1-1000 ตัวอักษร' })
  content?: string;

  @ApiPropertyOptional({ example: '😍', description: 'กดอิโมจิ (อิโมจิมาตรฐานหนึ่งตัว)' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_EMOJI_LENGTH)
  @Matches(SINGLE_EMOJI, { message: 'emoji ต้องเป็นอิโมจิมาตรฐานหนึ่งตัว' })
  emoji?: string;
}

export class MessageResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({
    description: 'ลำดับจริงของข้อความในห้อง — ใช้ตัวนี้เรียง ไม่ใช่ createdAt',
    example: 1421,
  })
  seq!: number;

  @ApiProperty() channelId!: string;
  @ApiProperty() authorCoreUserId!: string;
  @ApiProperty({ nullable: true }) content!: string | null;
  @ApiProperty({ type: [MessageAttachmentDto] })
  attachments!: MessageAttachmentDto[];

  @ApiProperty({ nullable: true, type: MessageEmbedViewDto })
  embed!: MessageEmbedViewDto | null;

  @ApiProperty({ nullable: true, type: MessageReplyToDto, description: 'กล่อง "ตอบกลับ" — null ถ้าไม่ได้ตอบใคร' })
  replyTo!: MessageReplyToDto | null;

  @ApiProperty({ description: 'ส่งต่อมาจากห้องอื่น — แสดงป้าย "ส่งต่อแล้ว"' })
  forwarded!: boolean;

  @ApiProperty({
    nullable: true,
    type: CallLogDto,
    description: 'บันทึกการโทร — null ถ้าเป็นข้อความปกติ · แก้ไข ส่งต่อ และตอบกลับข้อความนี้ไม่ได้',
  })
  callLog!: CallLogDto | null;

  @ApiProperty({
    nullable: true,
    type: StoryReplyInfoDto,
    description: 'ข้อความนี้ตอบสตอรี่ (embed เป็น STORY) — REPLY = พิมพ์ตอบ · REACTION = กดอิโมจิ',
  })
  storyReply!: StoryReplyInfoDto | null;

  @ApiProperty({
    nullable: true,
    description: 'ถ้าไม่ null ข้อความนี้เป็นคำตอบในเธรดของ id นั้น',
  })
  parentId!: string | null;

  @ApiProperty({ example: 0, description: 'จำนวนคำตอบในเธรดของข้อความนี้' })
  replyCount!: number;

  @ApiProperty({ nullable: true }) pinnedAt!: string | null;
  @ApiProperty({ nullable: true }) pinnedByCoreUserId!: string | null;

  @ApiProperty() clientNonce!: string;
  @ApiProperty({ nullable: true }) editedAt!: string | null;
  @ApiProperty() createdAt!: string;
}
