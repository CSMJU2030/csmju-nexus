/// ทางลัดแป้นพิมพ์ระหว่างอยู่ในสาย — ชุดเดียวกับ Instagram
///
/// **จับด้วย `event.code` ไม่ใช่ `event.key`** เพราะผู้ใช้ส่วนใหญ่ของระบบนี้
/// พิมพ์ด้วยแป้นภาษาไทย กด alt+m ตอนเป็นแป้นไทย `key` จะเป็น "ท" ไม่ใช่ "m"
/// และบน macOS option+m ให้ "µ" — ทางลัดจะใช้ได้เฉพาะตอนสลับเป็นแป้น
/// อังกฤษ ซึ่งผู้ใช้จะไม่มีวันเข้าใจว่าทำไม `code` คือตำแหน่งปุ่มจริงบน
/// แป้นพิมพ์ จึงได้ผลเท่ากันทุกภาษา

export type CallShortcut = 'settings' | 'mute' | 'hangup' | 'share' | 'fullscreen';

export interface ShortcutInfo {
  action: CallShortcut;
  label: string;
  keys: string;
  code: string;
}

export const CALL_SHORTCUTS: readonly ShortcutInfo[] = [
  { action: 'settings', label: 'การตั้งค่า', keys: 'alt+p', code: 'KeyP' },
  { action: 'mute', label: 'เปิดหรือปิดเสียง', keys: 'alt+m', code: 'KeyM' },
  { action: 'hangup', label: 'วางสาย', keys: 'alt+e', code: 'KeyE' },
  { action: 'share', label: 'แชร์หน้าจอ', keys: 'alt+s', code: 'KeyS' },
  { action: 'fullscreen', label: 'เต็มหน้าจอ', keys: 'alt+f', code: 'KeyF' },
];

export type ShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key' | 'repeat'
>;

/// ปุ่มที่กดตรงกับทางลัดไหน — ไม่ตรงได้ null
///
/// alt อย่างเดียวเท่านั้น: ctrl+alt คือ AltGr บนแป้นยุโรป (ใช้พิมพ์อักขระ)
/// และการกดค้าง (`repeat`) ต้องไม่ทำให้ไมค์สลับเปิดปิดรัว ๆ
export function matchShortcut(event: ShortcutEvent): CallShortcut | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  if (event.repeat) return null;

  const byCode = CALL_SHORTCUTS.find((shortcut) => shortcut.code === event.code);

  if (byCode) return byCode.action;

  // เบราว์เซอร์เก่าหรือแป้นเสมือนบางตัวไม่ส่ง code มา — ใช้ key แทนได้เฉพาะ
  // กรณีนั้น (ถ้ามี code แต่ไม่ตรง แปลว่าเป็นปุ่มอื่นจริง ๆ)
  if (event.code) return null;

  const key = event.key.toLowerCase();

  return (
    CALL_SHORTCUTS.find((shortcut) => shortcut.keys === `alt+${key}`)?.action ??
    null
  );
}
