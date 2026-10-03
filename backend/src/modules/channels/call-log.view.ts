import type { CallLogDto } from './dto/message.dto.js';

/// แถวบันทึกการโทรที่ตัวแปลงต้องใช้ — มาจาก Prisma (CallLog) หรือคิวรีดิบของกล่องข้อความ
export interface CallLogRow {
  media: 'AUDIO' | 'VIDEO';
  status: string;
  durationSec: number | null;
  callerCoreUserId: string;
  startedAt: Date;
  endedAt: Date | null;
}

/// สถานะในฐานข้อมูล → สถานะในสัญญา
///
/// แยกไฟล์จาก messages.service เพราะ channels.service ก็ใช้ ถ้า import ข้ามสอง
/// service กันเองจะเกิดวงจร import แล้ว metadata ของ Nest DI ได้ undefined
///
/// RINGING/ONGOING คือ "ยังไม่จบ" (endedAt = null) — แสดงเป็นค่าที่จะเป็นถ้าจบตอนนี้
/// (กำลังเรียก = MISSED · กำลังคุย = ANSWERED) ตามสัญญาที่หน้าบ้านใช้ (ดู CallLogDto)
export function callLogView(row: CallLogRow | null): CallLogDto | null {
  if (!row) {
    return null;
  }

  const status =
    row.status === 'RINGING'
      ? 'MISSED'
      : row.status === 'ONGOING'
        ? 'ANSWERED'
        : (row.status as CallLogDto['status']);

  return {
    media: row.media,
    status,
    durationSec: row.durationSec,
    callerCoreUserId: row.callerCoreUserId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

/// บรรทัดตัวอย่างของบันทึกการโทรในกล่องข้อความ — ข้อความไทยแบบ Instagram ตามมุมผู้อ่าน
///
/// ผู้โทรเห็นสิ่งที่ตัวเองทำ ("คุณเริ่ม…" "คุณยกเลิก…") ส่วนผู้ถูกโทรเห็นผลที่เกิดกับเขา
/// ("ไม่ได้รับสาย…") · สายที่ยังไม่จบ (endedAt = null) คือกำลังเรียกหรือกำลังคุย
export function callPreview(call: CallLogDto, viewer: string): string {
  const voice = call.media === 'AUDIO';
  const name = voice ? 'การโทรด้วยเสียง' : 'วิดีโอคอล';
  const mine = call.callerCoreUserId === viewer;
  const missed = voice ? 'ไม่ได้รับสายโทรด้วยเสียง' : 'ไม่ได้รับสายวิดีโอคอล';

  if (!call.endedAt) {
    if (mine) return voice ? 'คุณเริ่มการโทรด้วยเสียง' : 'คุณเริ่มวิดีโอคอล';

    return voice ? 'เริ่มการโทรด้วยเสียง' : 'เริ่มวิดีโอคอล';
  }

  switch (call.status) {
    case 'ANSWERED':
      return `${name}สิ้นสุดลงแล้ว`;
    case 'DECLINED':
      return mine ? `${name}ถูกปฏิเสธ` : `คุณปฏิเสธ${name}`;
    case 'CANCELLED':
      return mine ? `คุณยกเลิก${name}` : missed;
    default:
      if (mine) return voice ? 'ไม่มีผู้รับสายโทรด้วยเสียง' : 'ไม่มีผู้รับสายวิดีโอคอล';

      return missed;
  }
}
