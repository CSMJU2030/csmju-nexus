/// สถานะของภาพตัวอย่างจอที่เรากำลังแชร์ (มุมขวาล่าง) — แบบ Instagram
///
///   hidden    = ไม่ได้แชร์อยู่
///   expanded  = เห็นภาพตัวอย่างพร้อมปุ่ม "หยุด"
///   collapsed = ย่อไปชิดขอบจอ เหลือแค่ที่จับ "‹" ให้ดึงกลับ
///
/// แยกเป็นตัวลดสถานะล้วน เพราะมีสามทางที่ทำให้เลิกแชร์ (ปุ่ม "หยุด" บนภาพ ·
/// ปุ่มแชร์บนแถบควบคุม · แถบ "หยุดแชร์" ของเบราว์เซอร์เอง) และทุกทางต้อง
/// จบที่ hidden เหมือนกัน — ทางที่สามคือทางที่ลืมกันบ่อยที่สุด

export type SharePreviewState = 'hidden' | 'expanded' | 'collapsed';

export type SharePreviewEvent =
  | 'started'
  | 'stopped'
  /// แทร็กจบเอง — ผู้ใช้กด "หยุดแชร์" ที่แถบของเบราว์เซอร์
  | 'ended'
  | 'collapse'
  | 'expand';

export function sharePreviewReducer(
  state: SharePreviewState,
  event: SharePreviewEvent,
): SharePreviewState {
  switch (event) {
    case 'started':
      return 'expanded';
    case 'stopped':
    case 'ended':
      return 'hidden';
    case 'collapse':
      return state === 'expanded' ? 'collapsed' : state;
    case 'expand':
      return state === 'collapsed' ? 'expanded' : state;
  }
}
