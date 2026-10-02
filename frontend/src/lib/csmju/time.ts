/// เวลาแบบสั้นของ Instagram ภาษาไทย
///
/// รายการแชทมีที่ให้เวลาแค่สี่ห้าตัวอักษรต่อท้ายตัวอย่างข้อความ — "เมื่อ 3 วันที่แล้ว"
/// ยาวจนดันข้อความตัวอย่างหายไปครึ่งบรรทัด จึงใช้แบบย่อเหมือน IG ("3d" → "3 วัน")
///
/// รับ `now` เป็นพารามิเตอร์เพื่อให้เทสต์ตรึงเวลาได้โดยไม่ต้องปลอมนาฬิกาทั้งระบบ

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/// เกินหนึ่งปีแล้ว "60 สัปดาห์" อ่านยากกว่าวันที่จริง — IG เองก็เลิกนับสัปดาห์ราว ๆ นี้
const WEEKS_BEFORE_DATE = 52;

export function igAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();

  // นาฬิกาเครื่องผู้ใช้ช้ากว่าเซิร์ฟเวอร์ได้ ข้อความที่ "มาจากอนาคต" ไม่กี่วินาที
  // ต้องขึ้นว่าเพิ่งส่ง ไม่ใช่ "-1 นาที" · วันที่พังก็ตกเคสนี้แทนการขึ้น NaN
  if (!Number.isFinite(diff) || diff < MINUTE) return 'เมื่อครู่';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} นาที`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ชั่วโมง`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)} วัน`;

  const weeks = Math.floor(diff / WEEK);

  if (weeks <= WEEKS_BEFORE_DATE) return `${weeks} สัปดาห์`;

  return then.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/// ป้ายเวลาตรงกลางระหว่างกลุ่มข้อความในบทสนทนา
///
/// ต่างจาก `igAgo` ตรงที่คนอ่านย้อนบทสนทนาอยากรู้ "คุยกันตอนไหน" ไม่ใช่
/// "ผ่านมานานเท่าไร" — จึงบอกเวลานาฬิกาเสมอ แล้วเติมวันเท่าที่จำเป็น
/// (วันนี้ → แค่เวลา · เมื่อวาน · ในสัปดาห์นี้ → ชื่อวัน · เก่ากว่านั้น → วันที่เต็ม)
export function threadStamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);

  if (Number.isNaN(then.getTime())) return '';

  const time = then.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // เทียบเป็น "วันตามปฏิทิน" ไม่ใช่ 24 ชั่วโมง — ข้อความ 23:50 เมื่อวาน
  // ห่างจาก 00:10 วันนี้แค่ 20 นาที แต่คนเรียกมันว่า "เมื่อวาน"
  const startOf = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / DAY);

  if (days <= 0) return time;
  if (days === 1) return `เมื่อวาน ${time}`;

  if (days < 7) {
    return `${then.toLocaleDateString('th-TH', { weekday: 'long' })} ${time}`;
  }

  return `${then.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} ${time}`;
}
