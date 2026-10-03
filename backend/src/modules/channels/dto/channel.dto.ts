import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ChannelModel } from '../../../generated/prisma/models.js';
import { VoiceOccupantDto } from '../../voice/dto/voice.dto.js';

export const CREATABLE_KINDS = ['GROUP', 'COURSE', 'VOICE'] as const;
export type CreatableKind = (typeof CREATABLE_KINDS)[number];

export class CreateChannelDto {
  @ApiProperty({
    enum: CREATABLE_KINDS,
    description: 'DM สร้างผ่าน /direct-channels แทน เพราะต้องหาห้องเดิมก่อน',
  })
  @IsIn(CREATABLE_KINDS)
  kind!: CreatableKind;

  @ApiProperty({ example: 'ติวสอบ Data Structures' })
  @IsString()
  @Length(1, 80, { message: 'ชื่อห้องต้องยาว 1-80 ตัวอักษร' })
  name!: string;

  /// สร้างห้องนี้ไว้เพื่ออะไร — **บังคับ**
  ///
  /// คนที่ถูกเพิ่มเข้าห้องทีหลังเห็นแค่ชื่อ ซึ่งมักสั้นจนเดาไม่ออก ("กลุ่ม 3")
  /// ถ้าไม่บังคับตอนสร้าง จะไม่มีวันถูกกรอก เพราะไม่มีใครย้อนมาแก้ห้องเก่า
  @ApiProperty({ example: 'ติวก่อนสอบกลางภาค บทที่ 1-5 ทุกวันพุธ' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 300, { message: 'บอกวัตถุประสงค์ของห้อง 1-300 ตัวอักษร' })
  description!: string;

  @ApiPropertyOptional({ example: 'CS201' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  courseTag?: string;

  @ApiPropertyOptional({
    minimum: 2,
    default: 8,
    description:
      'เพดานคนในห้องเสียง — mesh P2P รับไหวถึง 8 คน เกินกว่านั้นเสียงจะขาด',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  maxSeats?: number;
}

const CORE_USER_ID = /^[A-Za-z0-9._-]{3,64}$/;

/// เพดานสมาชิกแชทกลุ่ม (รวมผู้สร้าง) — เท่ากับของ Instagram Direct
///
/// ใหญ่กว่านี้ควรเป็นห้อง GROUP ที่มีวัตถุประสงค์และผู้ดูแลชัดเจน ไม่ใช่แชทกลุ่ม
/// ที่ใครก็ถูกดึงเข้าได้โดยไม่มีบริบท
export const MAX_GROUP_DM_MEMBERS = 32;

/// เปิดแชทส่วนตัว (1 คน) หรือแชทกลุ่ม (2-31 คน)
///
/// ส่งอย่างใดอย่างหนึ่ง — `peerCoreUserId` คือสัญญาเดิมที่หน้าบ้านใช้อยู่
/// ส่วน `peerCoreUserIds` คือกล่อง "ข้อความใหม่" ของ Instagram ที่เลือกได้หลายคน
/// ถ้าเลือกมาคนเดียวก็ได้ DM เดิม (หาห้องเดิมก่อน) ไม่ใช่แชทกลุ่มหนึ่งคน
export class CreateDirectChannelDto {
  @ApiPropertyOptional({
    example: '6700001999-somchai',
    description: 'coreUserId ของอีกฝ่าย (แชทส่วนตัว) — ส่งอันนี้หรือ peerCoreUserIds อย่างใดอย่างหนึ่ง',
  })
  @IsOptional()
  @IsString()
  @Matches(CORE_USER_ID, {
    message: 'coreUserId ไม่ถูกต้องตามรูปแบบของระบบกลาง',
  })
  peerCoreUserId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['6700001999-somchai', '6700001888-somsri'],
    description:
      '1 คน = แชทส่วนตัว (หาห้องเดิมก่อน) · 2-31 คน = สร้างแชทกลุ่มใหม่ (GROUP_DM) โดยผู้เรียกเป็นผู้ดูแล',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'เลือกอย่างน้อยหนึ่งคน' })
  @ArrayMaxSize(MAX_GROUP_DM_MEMBERS - 1, {
    message: `แชทกลุ่มมีได้ไม่เกิน ${MAX_GROUP_DM_MEMBERS} คนรวมตัวคุณ`,
  })
  @IsString({ each: true })
  @Matches(CORE_USER_ID, {
    each: true,
    message: 'coreUserId ไม่ถูกต้องตามรูปแบบของระบบกลาง',
  })
  peerCoreUserIds?: string[];

  @ApiPropertyOptional({
    example: 'ทีมโปรเจกต์จบ',
    description: 'ชื่อแชทกลุ่ม (ไม่บังคับ) — ไม่มีชื่อหน้าบ้านใช้รายชื่อสมาชิกแทน · แชทส่วนตัวไม่ใช้ช่องนี้',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80, { message: 'ชื่อแชทกลุ่มต้องยาว 1-80 ตัวอักษร' })
  name?: string;
}

export const INBOX_FOLDERS = ['PRIMARY', 'GENERAL', 'HIDDEN'] as const;
export type SettableInboxFolder = (typeof INBOX_FOLDERS)[number];

/// จัดห้องนี้ในกล่องข้อความ "ของฉัน" — ไม่กระทบสมาชิกคนอื่นในห้อง
export class UpdateInboxDto {
  @ApiPropertyOptional({
    enum: INBOX_FOLDERS,
    description:
      'ย้ายแฟ้ม · ย้ายคำขอข้อความ (REQUEST) ไป PRIMARY = "ยอมรับคำขอ" · HIDDEN = ซ่อนคำขอ/แชท',
  })
  @IsOptional()
  @IsIn(INBOX_FOLDERS, { message: 'folder ต้องเป็น PRIMARY, GENERAL หรือ HIDDEN' })
  folder?: SettableInboxFolder;

  @ApiPropertyOptional({ description: 'true = ปักหมุดไว้บนสุดของกล่องข้อความ' })
  @IsOptional()
  @IsBoolean({ message: 'pinned ต้องเป็น true หรือ false' })
  pinned?: boolean;

  @ApiPropertyOptional({
    description: 'true = ปิดแจ้งเตือนเรื่องข้อความของห้องนี้ (ยังนับยังไม่อ่านตามปกติ)',
  })
  @IsOptional()
  @IsBoolean({ message: 'muted ต้องเป็น true หรือ false' })
  muted?: boolean;
}

export class ClearChannelResponseDto {
  @ApiProperty() channelId!: string;

  @ApiProperty({
    description: 'ข้อความที่สร้างก่อนเวลานี้ถูกซ่อนจากผู้เรียก — อีกฝ่ายยังเห็นครบ',
  })
  clearedAt!: string;
}

export class AddMembersDto {
  @ApiProperty({ type: [String], example: ['6700001999-somchai'] })
  @IsArray()
  @ArrayMaxSize(50, { message: 'เพิ่มได้ครั้งละไม่เกิน 50 คน' })
  @IsString({ each: true })
  coreUserIds!: string[];
}

/// แก้ชื่อหรือวัตถุประสงค์ของห้อง — ชนิดห้องกับผู้สร้างแก้ไม่ได้ เพราะเป็นประวัติ
export class UpdateChannelDto {
  @ApiPropertyOptional({ example: 'ติวสอบ Data Structures (กลุ่ม B)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80, { message: 'ชื่อห้องต้องยาว 1-80 ตัวอักษร' })
  name?: string;

  @ApiPropertyOptional({ example: 'ติวก่อนสอบปลายภาค บทที่ 6-10' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 300, { message: 'บอกวัตถุประสงค์ของห้อง 1-300 ตัวอักษร' })
  description?: string;
}

/// ข้อความล่าสุดของห้อง — บรรทัดตัวอย่างใต้ชื่อในกล่องข้อความ ("คุณ: Nice · 2 ชั่วโมง")
export class LastMessageDto {
  @ApiProperty({
    description: 'ลำดับของข้อความ — เทียบกับ peerLastReadSeq เพื่อทำป้าย "เห็นแล้ว"',
  })
  seq!: number;

  @ApiProperty({
    nullable: true,
    description:
      'null เมื่อเป็นไฟล์แนบล้วน · บันทึกการโทรได้ข้อความไทยตามมุมของผู้เรียก เช่น "คุณเริ่มการโทรด้วยเสียง" "ไม่ได้รับสายโทรด้วยเสียง" "การโทรด้วยเสียงสิ้นสุดลงแล้ว"',
  })
  content!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'บันทึกการโทร (รูปเดียวกับ Message.callLog) — null ถ้าข้อความล่าสุดไม่ใช่การโทร',
  })
  callLog!: {
    media: 'AUDIO' | 'VIDEO';
    status: 'ANSWERED' | 'MISSED' | 'DECLINED' | 'CANCELLED';
    durationSec: number | null;
    callerCoreUserId: string;
    startedAt: string;
    endedAt: string | null;
  } | null;

  @ApiProperty() authorCoreUserId!: string;

  @ApiProperty({ description: 'จำนวนไฟล์แนบ — ให้หน้าบ้านเขียน "ส่งรูปภาพ" แทนข้อความว่าง' })
  attachmentCount!: number;

  @ApiProperty() createdAt!: string;
}

export class ChannelResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['DM', 'GROUP', 'COURSE', 'VOICE', 'GROUP_DM'] }) kind!: string;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true }) courseTag!: string | null;
  @ApiProperty() maxSeats!: number;
  @ApiProperty() memberCount!: number;

  @ApiProperty({
    nullable: true,
    description: 'สร้างห้องไว้เพื่ออะไร — null สำหรับ DM และห้องที่สร้างก่อนมีช่องนี้',
  })
  description!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'coreUserId ของผู้สร้างห้อง — null สำหรับ DM',
  })
  createdByCoreUserId!: string | null;

  @ApiProperty({
    description: 'ผู้เรียกแก้ไขหรือลบห้องนี้ได้ไหม — ให้หน้าบ้านซ่อนปุ่มได้ถูก',
  })
  canManage!: boolean;

  @ApiProperty({ enum: ['MEMBER', 'MODERATOR'] })
  myRole!: string;

  @ApiProperty({ description: 'จำนวนข้อความที่ยังไม่ได้อ่าน' })
  unreadCount!: number;

  /// คู่สนทนาของห้อง DM — null สำหรับห้องชนิดอื่น
  ///
  /// **ถ้าไม่มีค่านี้ ปุ่มโทรในหน้าแชทส่วนตัวจะกดไม่ได้เลย** เพราะหน้าบ้าน
  /// ไม่มีทางรู้ว่าจะโทรหา `coreUserId` ไหน ก่อนหน้านี้มันเดาจาก `name` ของ
  /// ห้อง ซึ่งห้อง DM ไม่เคยตั้งชื่อ ปุ่มจึงถูกปิดใช้งานถาวรทุกห้อง
  ///
  /// ส่งเฉพาะห้อง DM เพราะห้องกลุ่มไม่มี "คู่" และการส่งรายชื่อสมาชิกทั้งหมด
  /// มากับรายการห้องจะกลายเป็นคิวรีต่อหนึ่งห้อง (N+1) ตอนโหลดรายการ
  @ApiProperty({
    nullable: true,
    description: 'coreUserId ของคู่สนทนา (เฉพาะห้อง DM)',
  })
  peerCoreUserId!: string | null;

  @ApiProperty({
    type: LastMessageDto,
    nullable: true,
    description: 'ข้อความล่าสุดในไทม์ไลน์หลัก (ไม่นับคำตอบในเธรดและข้อความที่ถูกลบ) — null ถ้ายังไม่มีใครพิมพ์',
  })
  lastMessage!: LastMessageDto | null;

  /// แฟ้มในกล่องข้อความของผู้เรียก — **คำนวณสด** ไม่ใช่ค่าที่เก็บไว้เฉย ๆ
  ///
  ///   HIDDEN   ผู้เรียกซ่อนไว้เอง
  ///   PRIMARY / GENERAL  ผู้เรียกย้ายไปเอง (ย้าย REQUEST ไป PRIMARY = ยอมรับคำขอ)
  ///   REQUEST  แชทส่วนตัว/แชทกลุ่มที่ผู้เรียกไม่ได้ติดตามอีกฝ่าย (DM) หรือผู้สร้าง
  ///            (GROUP_DM) + ยังไม่เคยส่งข้อความในห้อง + มีข้อความแล้วอย่างน้อยหนึ่ง
  ///   PRIMARY  นอกนั้นทั้งหมด (รวมห้อง GROUP/COURSE/VOICE)
  @ApiProperty({ enum: ['PRIMARY', 'GENERAL', 'HIDDEN', 'REQUEST'] })
  inboxFolder!: 'PRIMARY' | 'GENERAL' | 'HIDDEN' | 'REQUEST';

  @ApiProperty({
    nullable: true,
    description: 'เวลาที่ผู้เรียกปักหมุดห้องนี้ไว้บนกล่องข้อความ — null = ไม่ได้ปัก',
  })
  pinnedAt!: string | null;

  @ApiProperty({ description: 'ผู้เรียกปิดแจ้งเตือนห้องนี้ไว้ไหม' })
  muted!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'ผู้เรียก "ลบแชท" ไว้เมื่อไหร่ — ข้อความก่อนเวลานี้ไม่ถูกส่งให้ผู้เรียกอีก',
  })
  clearedAt!: string | null;

  /// ทำป้าย "เห็นแล้ว" ใต้ข้อความล่าสุดแบบ Instagram — เทียบกับ seq ของข้อความ
  @ApiProperty({
    nullable: true,
    description: 'lastReadSeq ของคู่สนทนา (เฉพาะ DM) — seq ของข้อความ ≤ ค่านี้ = อีกฝ่ายเห็นแล้ว',
  })
  peerLastReadSeq!: number | null;

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      `สมาชิกทุกคนของแชทกลุ่มรวมผู้เรียก เรียงตามเวลาที่เข้า สูงสุด ${MAX_GROUP_DM_MEMBERS} คน (เฉพาะ GROUP_DM · ห้องอื่นเป็น null) — ใช้ซ้อนรูปโปรไฟล์และตั้งชื่อเริ่มต้น`,
  })
  memberCoreUserIds!: string[] | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { '6700001999-somchai': 'ชัย' },
    description: 'ชื่อเล่นในห้องนี้ { coreUserId: ชื่อเล่น } — เฉพาะ DM/แชทกลุ่ม · ห้องอื่นเป็น {} เสมอ',
  })
  nicknames!: Record<string, string>;

  @ApiProperty({
    description: 'ผู้เรียกกด "ทำเครื่องหมายว่ายังไม่ได้อ่าน" ไว้ — ล้างเองเมื่อบันทึกหมุดอ่านครั้งถัดไป',
  })
  markedUnread!: boolean;

  @ApiProperty({
    type: [VoiceOccupantDto],
    nullable: true,
    description:
      'คนที่อยู่ในห้องเสียงตอนนี้ (เฉพาะห้อง VOICE · ห้องอื่นเป็น null) — อัปเดตสดด้วย socket voice:occupants',
  })
  voiceOccupants!: VoiceOccupantDto[] | null;

  @ApiProperty() createdAt!: string;
}

/// ตั้งหรือลบชื่อเล่น — null = ลบ
export class SetNicknameDto {
  @ApiProperty({ nullable: true, example: 'ชัย', minLength: 1, maxLength: 40 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== null)
  @IsString({ message: 'nickname ต้องเป็นข้อความหรือ null' })
  @Length(1, 40, { message: 'ชื่อเล่นยาว 1-40 ตัวอักษร (ส่ง null เพื่อลบ)' })
  nickname!: string | null;
}

/// ส่วนของ response ที่ขึ้นกับ "แถวสมาชิกของผู้เรียก" — แยกออกมาเพื่อให้ทุก
/// endpoint ที่คืนห้องคำนวณแบบเดียวกัน (ดู ChannelsService.present)
export interface InboxView {
  folder: ChannelResponseDto['inboxFolder'];
  pinnedAt: Date | null;
  muted: boolean;
  clearedAt: Date | null;
  peerLastReadSeq: number | null;
  memberCoreUserIds: string[] | null;
  nicknames: Record<string, string>;
  markedUnread: boolean;
  voiceOccupants?: VoiceOccupantDto[] | null;
}

export function toChannelResponse(
  channel: ChannelModel,
  extra: {
    memberCount: number;
    myRole: string;
    unreadCount: number;
    /// ผู้เรียกที่รู้จักคู่สนทนาส่งมาให้ — ไม่ส่งมาก็ถือว่าไม่มี
    peerCoreUserId?: string | null;
    canManage?: boolean;
    lastMessage?: LastMessageDto | null;
    inbox?: InboxView;
  },
): ChannelResponseDto {
  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    courseTag: channel.courseTag,
    maxSeats: channel.maxSeats,
    memberCount: extra.memberCount,
    description: channel.description,
    createdByCoreUserId: channel.createdByCoreUserId,
    canManage: extra.canManage ?? false,
    myRole: extra.myRole,
    unreadCount: extra.unreadCount,
    peerCoreUserId: extra.peerCoreUserId ?? null,
    lastMessage: extra.lastMessage ?? null,
    inboxFolder: extra.inbox?.folder ?? 'PRIMARY',
    pinnedAt: extra.inbox?.pinnedAt?.toISOString() ?? null,
    muted: extra.inbox?.muted ?? false,
    clearedAt: extra.inbox?.clearedAt?.toISOString() ?? null,
    peerLastReadSeq: extra.inbox?.peerLastReadSeq ?? null,
    memberCoreUserIds: extra.inbox?.memberCoreUserIds ?? null,
    nicknames: extra.inbox?.nicknames ?? {},
    markedUnread: extra.inbox?.markedUnread ?? false,
    voiceOccupants: extra.inbox?.voiceOccupants ?? null,
    createdAt: channel.createdAt.toISOString(),
  };
}
