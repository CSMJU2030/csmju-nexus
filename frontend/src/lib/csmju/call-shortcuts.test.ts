import { describe, expect, it } from 'vitest';
import { CALL_SHORTCUTS, matchShortcut, type ShortcutEvent } from './call-shortcuts';

function key(code: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    code,
    key: code.replace('Key', '').toLowerCase(),
    ...overrides,
  };
}

describe('matchShortcut', () => {
  it('ครบห้าปุ่มแบบ Instagram', () => {
    expect(matchShortcut(key('KeyP'))).toBe('settings');
    expect(matchShortcut(key('KeyM'))).toBe('mute');
    expect(matchShortcut(key('KeyE'))).toBe('hangup');
    expect(matchShortcut(key('KeyS'))).toBe('share');
    expect(matchShortcut(key('KeyF'))).toBe('fullscreen');
  });

  it('**แป้นภาษาไทยก็ใช้ได้** — ดูตำแหน่งปุ่ม ไม่ใช่ตัวอักษร', () => {
    // alt+m ตอนเป็นแป้นไทย key = "ท" แต่ code ยังเป็น KeyM
    expect(matchShortcut(key('KeyM', { key: 'ท' }))).toBe('mute');
    // option+m บน macOS ได้ "µ"
    expect(matchShortcut(key('KeyM', { key: 'µ' }))).toBe('mute');
  });

  it('ไม่กด alt หรือกดปุ่มเสริมอื่นพ่วง = ไม่ใช่ทางลัด', () => {
    expect(matchShortcut(key('KeyM', { altKey: false }))).toBeNull();
    // ctrl+alt = AltGr บนแป้นยุโรป ใช้พิมพ์อักขระ
    expect(matchShortcut(key('KeyM', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key('KeyM', { metaKey: true }))).toBeNull();
    expect(matchShortcut(key('KeyM', { shiftKey: true }))).toBeNull();
  });

  it('กดค้างไม่สลับไมค์รัว ๆ', () => {
    expect(matchShortcut(key('KeyM', { repeat: true }))).toBeNull();
  });

  it('ปุ่มอื่นไม่ตรงอะไร · ไม่มี code ค่อยดูจาก key', () => {
    expect(matchShortcut(key('KeyX'))).toBeNull();
    expect(matchShortcut(key('', { key: 'E' }))).toBe('hangup');
  });

  it('รายการในกล่องตั้งค่าตรงกับที่จับได้จริง', () => {
    for (const shortcut of CALL_SHORTCUTS) {
      expect(matchShortcut(key(shortcut.code))).toBe(shortcut.action);
      expect(shortcut.keys).toMatch(/^alt\+[a-z]$/);
    }
  });
});
