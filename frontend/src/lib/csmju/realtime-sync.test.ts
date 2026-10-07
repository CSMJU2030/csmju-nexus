import { describe, expect, it } from 'vitest';
import { clampDock } from '@/components/csmju/call-dock';
import { isSyncTopic, keyMatches } from './realtime-sync';

/// ซิงก์สด: หัวข้อ → คีย์แคชที่ต้องดึงใหม่ · กล่องสายลอยไม่หลุดจอ

describe('keyMatches', () => {
  it('โพสต์เปลี่ยน → ดึงฟีด/โพสต์/กริดโปรไฟล์ใหม่ แต่ไม่แตะแชท', () => {
    const posts = new Set(['posts'] as const);

    expect(keyMatches(['feed', 'all', ''], posts)).toBe(true);
    expect(keyMatches(['post', 'id-1'], posts)).toBe(true);
    expect(keyMatches(['activity-likes'], posts)).toBe(true);
    expect(keyMatches(['channels', 'mine'], posts)).toBe(false);
  });

  it('ข้อความใหม่ (inbox) → รายการแชท · ติดตาม → โปรไฟล์และคำแนะนำ', () => {
    expect(keyMatches(['channels', 'mine'], new Set(['inbox'] as const))).toBe(true);
    expect(keyMatches(['relation', 'u-1'], new Set(['follows'] as const))).toBe(true);
    expect(keyMatches([42], new Set(['follows'] as const))).toBe(false);
  });

  it('รับเฉพาะหัวข้อที่รู้จัก', () => {
    expect(isSyncTopic('stories')).toBe(true);
    expect(isSyncTopic('admin')).toBe(false);
    expect(isSyncTopic(undefined)).toBe(false);
  });
});

describe('clampDock', () => {
  const viewport = { width: 390, height: 844 };

  it('ลากออกนอกจอ → ดึงกลับให้เห็นทั้งกล่อง', () => {
    expect(clampDock({ x: 500, y: 900, width: 280 }, 200, viewport)).toEqual({ x: 102, y: 636, width: 280 });
    expect(clampDock({ x: -50, y: -50, width: 280 }, 200, viewport)).toEqual({ x: 8, y: 8, width: 280 });
  });

  it('ขนาดอยู่ในช่วงที่ใช้ได้และไม่กว้างเกินจอ', () => {
    expect(clampDock({ x: 0, y: 0, width: 50 }, 100, viewport).width).toBe(180);
    expect(clampDock({ x: 0, y: 0, width: 900 }, 100, viewport).width).toBe(374);
  });
});
