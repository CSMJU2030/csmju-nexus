/// อ่านหัว `Range: bytes=…` ช่วงเดียว (RFC 9110 §14) — เบราว์เซอร์ใช้ตอนเล่นและเลื่อนวิดีโอ/เสียง
///
/// คืน `null` = ไม่มีหรือไม่ใช่ช่วงไบต์ที่เข้าใจ (ส่งทั้งไฟล์ 200) · `'unsatisfiable'` = ช่วงอยู่นอกไฟล์ (416)
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  // หลายช่วง (มีจุลภาค) หรือหน่วยอื่น — ส่งทั้งไฟล์ตามที่ RFC อนุญาต
  if (!match || (match[1] === '' && match[2] === '')) return null;

  if (match[1] === '') {
    // bytes=-N = N ไบต์สุดท้าย
    const suffix = Number(match[2]);

    if (suffix === 0 || size === 0) return 'unsatisfiable';

    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);

  if (start >= size || end < start) return 'unsatisfiable';

  return { start, end };
}
