import { describe, expect, it } from 'vitest';
import { sharePreviewReducer } from './call-share';
import { classifyVideo, decodeMediaState, encodeMediaState } from './call-media';

describe('ภาพตัวอย่างจอที่แชร์', () => {
  it('เริ่มแชร์ → เห็นภาพ · ย่อ → ชิดขอบ · ขยาย → กลับมา', () => {
    let state = sharePreviewReducer('hidden', 'started');

    expect(state).toBe('expanded');

    state = sharePreviewReducer(state, 'collapse');
    expect(state).toBe('collapsed');

    state = sharePreviewReducer(state, 'expand');
    expect(state).toBe('expanded');
  });

  it('**หยุดจากแถบของเบราว์เซอร์ก็ต้องหาย** แม้ตอนย่ออยู่', () => {
    expect(sharePreviewReducer('collapsed', 'ended')).toBe('hidden');
    expect(sharePreviewReducer('expanded', 'ended')).toBe('hidden');
    expect(sharePreviewReducer('expanded', 'stopped')).toBe('hidden');
  });

  it('ไม่ได้แชร์อยู่ กดย่อ/ขยายไม่ทำให้ภาพโผล่', () => {
    expect(sharePreviewReducer('hidden', 'collapse')).toBe('hidden');
    expect(sharePreviewReducer('hidden', 'expand')).toBe('hidden');
  });
});

describe('แยกภาพกล้องกับภาพจอของอีกฝ่าย', () => {
  const camera = { id: 'cam-stream' };
  const screen = { id: 'screen-stream' };

  it('เชื่อสิ่งที่อีกฝ่ายประกาศมา — เปิดกล้องพร้อมแชร์จอได้', () => {
    expect(
      classifyVideo([screen, camera], { muted: false, camera: 'cam-stream', screen: 'screen-stream' }, false),
    ).toEqual({ camera, screen });
  });

  it('ยังไม่ประกาศ: ถือสิทธิ์แชร์จออยู่ = จอ · ไม่ถือ = กล้อง', () => {
    expect(classifyVideo([screen], null, true)).toEqual({ camera: null, screen });
    expect(classifyVideo([camera], null, false)).toEqual({ camera, screen: null });
  });

  it('สถานะที่ส่งผ่าน data channel อ่านกลับได้ตรง และข้อความแปลก ๆ ไม่ทำให้พัง', () => {
    const state = { muted: true, camera: 'cam-stream', screen: null };

    expect(decodeMediaState(encodeMediaState(state))).toEqual(state);
    expect(decodeMediaState('ไม่ใช่ json')).toBeNull();
    expect(decodeMediaState(JSON.stringify({ t: 'อื่น' }))).toBeNull();
    expect(decodeMediaState(42)).toBeNull();
  });
});
