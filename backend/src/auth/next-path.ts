/// ตรวจค่า `next` ก่อนพาเบราว์เซอร์ไป (auth-contract.md ข้อ 5.2)
///
/// คืน path ภายในระบบนี้ หรือ null เมื่อห้ามตาม — ผู้เรียกใช้หน้า default แทน
/// ผ่านได้เมื่อครบทุกข้อ:
///
///  1. string ยาว 1–512 ตัวอักษร
///  2. ขึ้นต้นด้วย `/` แต่ไม่ใช่ `//` และไม่มี `\` (เบราว์เซอร์อ่าน `/\host`
///     เหมือน `//host` ซึ่งออกนอกเว็บ)
///  3. ไม่มีอักขระควบคุม (0–31 และ 127)
///  4. `new URL(next, origin ของตัวเอง)` แล้ว origin ต้องยังเป็นของตัวเอง
///  5. ไม่ใช่ `/auth` หรือ path ใต้ `/auth/` — กันวนกลับเข้า flow ที่กำลังจบ
///
/// ตรวจ **สองครั้ง**: ตอน `/auth/login` เก็บค่า และตอน callback ก่อน redirect
/// เพราะค่าที่เก็บไว้กลับมาจากคุกกี้
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) {
    return null;
  }

  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return null;
  }

  // วนลูปแทน regex ช่วงอักขระควบคุม (lint ห้าม no-control-regex)
  for (const char of raw) {
    const code = char.charCodeAt(0);

    if (code < 0x20 || code === 0x7f) return null;
  }

  // origin ใดก็ได้ที่เป็นของเรา — สิ่งที่ตรวจคือ "ยังเป็น origin เดิมไหม"
  const base = new URL('http://self.invalid');
  const url = new URL(raw, base);

  if (url.origin !== base.origin) return null;

  // เทียบแบบถอดรหัสแล้วและตัวพิมพ์เล็ก: `/%61uth/login` หรือ `/AUTH/login`
  // อาจถูก route ไปที่ /auth/login แล้วกลายเป็นวงวนผ่าน Core Hub
  let pathname: string;

  try {
    pathname = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return null;
  }

  if (pathname === '/auth' || pathname.startsWith('/auth/')) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}
