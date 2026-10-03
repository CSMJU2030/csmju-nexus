import { describe, expect, it } from 'vitest';
import { igAgo, threadStamp } from './time';

/// เวลาแบบย่อของรายการแชท — ต้องสั้นพอจะต่อท้ายตัวอย่างข้อความได้
/// โดยไม่ดันข้อความหายไปครึ่งบรรทัด

const NOW = new Date('2026-09-29T12:00:00+07:00');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('igAgo', () => {
  it('ไม่ถึงนาที = เมื่อครู่', () => {
    expect(igAgo(ago(0), NOW)).toBe('เมื่อครู่');
    expect(igAgo(ago(59_000), NOW)).toBe('เมื่อครู่');
  });

  it('**นาฬิกาเครื่องช้ากว่าเซิร์ฟเวอร์** ข้อความจากอนาคตไม่ขึ้นเลขติดลบ', () => {
    expect(igAgo(ago(-30_000), NOW)).toBe('เมื่อครู่');
  });

  it('วันที่พังไม่ขึ้น NaN', () => {
    expect(igAgo('ไม่ใช่วันที่', NOW)).toBe('เมื่อครู่');
  });

  it('นาที · ชั่วโมง · วัน · สัปดาห์ ปัดลงเหมือน IG', () => {
    expect(igAgo(ago(5 * MIN), NOW)).toBe('5 นาที');
    expect(igAgo(ago(59 * MIN), NOW)).toBe('59 นาที');
    expect(igAgo(ago(HOUR), NOW)).toBe('1 ชั่วโมง');
    expect(igAgo(ago(23 * HOUR + 59 * MIN), NOW)).toBe('23 ชั่วโมง');
    expect(igAgo(ago(3 * DAY), NOW)).toBe('3 วัน');
    expect(igAgo(ago(6 * DAY + 23 * HOUR), NOW)).toBe('6 วัน');
    expect(igAgo(ago(7 * DAY), NOW)).toBe('1 สัปดาห์');
    expect(igAgo(ago(8 * 7 * DAY), NOW)).toBe('8 สัปดาห์');
  });

  it('เกินหนึ่งปี = วันที่สั้นแบบไทย ไม่ใช่ "60 สัปดาห์"', () => {
    const old = new Date('2025-01-12T10:00:00+07:00').toISOString();
    const label = igAgo(old, NOW);

    expect(label).not.toMatch(/สัปดาห์/);
    expect(label).toContain('ม.ค.');
    // ปีพุทธศักราช ตามที่ th-TH แสดง
    expect(label).toContain('2568');
  });
});

describe('threadStamp', () => {
  it('วันนี้ = แค่เวลา', () => {
    expect(threadStamp('2026-09-29T09:05:00+07:00', NOW)).toMatch(/^0?9[:.]05/);
  });

  it('**เมื่อวานนับตามปฏิทิน** ไม่ใช่ 24 ชั่วโมง', () => {
    const justAfterMidnight = new Date(2026, 8, 29, 0, 10);
    const lateYesterday = new Date(2026, 8, 28, 23, 50).toISOString();

    expect(threadStamp(lateYesterday, justAfterMidnight)).toMatch(/^เมื่อวาน /);
  });

  it('ในสัปดาห์นี้ = ชื่อวัน · เก่ากว่านั้น = วันที่เต็ม', () => {
    const now = new Date(2026, 8, 29, 12, 0); // อังคาร
    const sunday = new Date(2026, 8, 27, 18, 30).toISOString();
    const old = new Date(2026, 5, 1, 8, 0).toISOString();

    expect(threadStamp(sunday, now)).toMatch(/^วันอาทิตย์ /);
    expect(threadStamp(old, now)).toContain('มิ.ย.');
  });

  it('วันที่พังได้ช่องว่าง ไม่ใช่ Invalid Date', () => {
    expect(threadStamp('พัง', NOW)).toBe('');
  });
});
