import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ReactionTarget } from '../../../generated/prisma/enums.js';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';

/// อิโมจิมาตรฐาน **หนึ่งตัว** ตามชุด RGI ของ Unicode (ชุดที่ทุกแพลตฟอร์มวาดได้)
///
/// เดิมเป็นรายการปิด 12 ตัว เพราะกลัวแถบรีแอ็กชันจะมีร้อยตัวไม่ซ้ำกัน แต่หน้าบ้าน
/// เปลี่ยนเป็นแผงเลือกอิโมจิเต็มชุดแบบ Instagram แล้ว — ผู้ใช้เลือกตัวที่ไม่อยู่ใน
/// 12 ตัวนั้นได้บนหน้าจอ แล้วโดน 400 ซึ่งแย่กว่าแถบที่ยาว (แถบยาวแก้ที่ UI ได้
/// ด้วยการยุบ "+N" แต่ปุ่มที่กดแล้วพังแก้ที่ UI ไม่ได้)
///
/// ที่ยังต้องกันคือ "ข้อความ" ที่แอบมาในช่องอิโมจิ (`ab`, `PIZZA`) และอิโมจิหลายตัว
/// ติดกัน (`😀😀`) ซึ่งจะทำให้การนับแยกตามอิโมจิไม่มีความหมาย — `\p{RGI_Emoji}`
/// ครอบทั้งสีผิว ธงชาติ และลำดับ ZWJ (👩‍💻) ในหนึ่ง grapheme พอดี
///
/// ใช้ `new RegExp` เพราะแฟล็ก `v` ต้อง target ES2024 ส่วนโปรเจกต์ตั้งไว้ ES2023
/// (Node 22 รองรับอยู่แล้ว แค่ตัวตรวจชนิดของ TypeScript ไม่ยอมรับ literal)
export const SINGLE_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');

/// เพดานความยาวเป็นหน่วย UTF-16 — ลำดับ ZWJ ที่ยาวที่สุดใน RGI ราว 15 หน่วย
/// เผื่อไว้สองเท่าและตรงกับคอลัมน์ VARCHAR(32)
export const MAX_EMOJI_LENGTH = 32;

export class ReactionTargetQuery {
  @ApiProperty({ enum: ReactionTarget, example: 'POST' })
  @IsEnum(ReactionTarget, { message: 'targetKind ต้องเป็น MESSAGE, POST หรือ REEL' })
  targetKind!: ReactionTarget;

  @ApiProperty({ example: '9f1c2b3a-0000-4000-8000-000000000000' })
  @IsUUID('4', { message: 'targetId ต้องเป็น UUID' })
  targetId!: string;
}

export class ReactDto extends ReactionTargetQuery {
  @ApiProperty({
    example: '👍🏽',
    maxLength: MAX_EMOJI_LENGTH,
    description:
      'อิโมจิมาตรฐาน (RGI) หนึ่งตัว — รวมสีผิว ธงชาติ และลำดับ ZWJ เช่น 👩‍💻 · ห้ามเป็นข้อความหรืออิโมจิหลายตัวติดกัน',
  })
  @IsString()
  @MaxLength(MAX_EMOJI_LENGTH, {
    message: `อิโมจิยาวได้ไม่เกิน ${MAX_EMOJI_LENGTH} หน่วย — ส่งทีละหนึ่งตัว`,
  })
  @Matches(SINGLE_EMOJI, {
    message:
      'emoji ต้องเป็นอิโมจิมาตรฐานหนึ่งตัว (เช่น 👍 ❤️ 🇹🇭 👩‍💻) — ไม่ใช่ข้อความหรืออิโมจิหลายตัวติดกัน',
  })
  emoji!: string;
}

export class UnreactQuery extends ReactDto {}

/// ใครกดอิโมจินี้บนข้อความ — tooltip ตอนชี้ที่ชิปรีแอ็กชันแบบ Discord
export class ReactorsQuery extends PaginationQuery {
  @ApiProperty({ example: '👍' })
  @IsString()
  @MaxLength(MAX_EMOJI_LENGTH)
  @Matches(SINGLE_EMOJI, { message: 'emoji ต้องเป็นอิโมจิมาตรฐานหนึ่งตัว' })
  emoji!: string;
}

export class ReactorDto {
  @ApiProperty() coreUserId!: string;
  @ApiProperty({ description: 'เวลาที่กด — รายการเรียงเก่าไปใหม่ (คนกดก่อนอยู่ก่อน)' }) createdAt!: string;
}

export class EmojiCountDto {
  @ApiProperty({ example: '👍' }) emoji!: string;
  @ApiProperty({ example: 12 }) count!: number;

  @ApiProperty({ description: 'ฉันกดอิโมจินี้อยู่ไหม' })
  reactedByMe!: boolean;
}

export class ReactionSummaryDto {
  @ApiProperty({ enum: ReactionTarget }) targetKind!: ReactionTarget;
  @ApiProperty() targetId!: string;

  @ApiProperty({
    type: [EmojiCountDto],
    description:
      'เฉพาะอิโมจิที่มีคนกดจริง · ข้อความแชท (MESSAGE) เรียงตามอิโมจิที่ถูกกดก่อน (แบบ Discord — ชิปไม่สลับที่เมื่อยอดเปลี่ยน) · โพสต์/คลิปเรียงจากยอดมากไปน้อย',
  })
  totals!: EmojiCountDto[];

  @ApiProperty({ example: 15, description: 'ผลรวมทุกอิโมจิ' })
  totalCount!: number;
}

/// เพดานจำนวน id ต่อหนึ่งคำขอ — หนึ่งหน้าจอไม่เคยแสดงเกินนี้
///
/// มีเพดานเพราะ targetIds มาจาก query string ซึ่งยาวได้จำกัด และเพื่อไม่ให้
/// ใครยิง id หมื่นตัวมาให้ groupBy ทำงานหนักในคำขอเดียว
export const MAX_SUMMARY_TARGETS = 100;

/// ขอยอดรีแอ็กชันของหลายชิ้นในคำขอเดียว
///
/// แก้ N+1 ที่หน้าจอแชท: เดิมหน้าบ้านยิงหนึ่งคำขอต่อหนึ่งข้อความ
/// สามสิบข้อความในหน้าจอ = สามสิบ round trip ซึ่งบนเน็ตจริง (80 ms ต่อรอบ)
/// คือการรอที่ผู้ใช้รู้สึกได้ ทั้งที่หลังบ้านมี summariesFor ที่ทำได้ในสองคิวรี
/// อยู่แล้วตั้งแต่แรก — ขาดแค่ทางเข้า
export class ReactionSummariesQuery {
  @ApiProperty({ enum: ReactionTarget, example: 'MESSAGE' })
  @IsEnum(ReactionTarget, {
    message: 'targetKind ต้องเป็น MESSAGE, POST หรือ REEL',
  })
  targetKind!: ReactionTarget;

  @ApiProperty({
    description: `id คั่นด้วยลูกน้ำ สูงสุด ${MAX_SUMMARY_TARGETS} ตัว`,
    example: '9f1c2b3a-0000-4000-8000-000000000000,...',
  })
  @IsString()
  @Length(1, 4000)
  targetIds!: string;
}
