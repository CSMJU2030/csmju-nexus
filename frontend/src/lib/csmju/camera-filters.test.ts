import { describe, expect, it } from 'vitest';
import { applyFilter, CAMERA_FILTERS, coverCrop, filterCss, type CameraFilter } from './camera-filters';

const byId = (id: string): CameraFilter => {
  const found = CAMERA_FILTERS.find((filter) => filter.id === id);

  if (!found) throw new Error(id);

  return found;
};

describe('camera-filters', () => {
  it('ทุกฟิลเตอร์มี id ไม่ซ้ำและชื่อภาษาไทย · ตัวแรกคือ "ปกติ"', () => {
    const ids = CAMERA_FILTERS.map((filter) => filter.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(CAMERA_FILTERS[0]?.id).toBe('normal');
    expect(filterCss(byId('normal'))).toBe('none');
  });

  it('CSS ของพรีวิวเรียงขั้นเดียวกับที่ใช้ตอนถ่าย', () => {
    expect(filterCss(byId('cool'))).toBe('hue-rotate(-12deg) contrast(1.05) saturate(0.9) brightness(1.05)');
  });

  it('ขาวดำ: R G B เท่ากันทุกพิกเซล · ไม่แตะ alpha', () => {
    const pixels = new Uint8ClampedArray([200, 40, 90, 128, 10, 220, 30, 255]);

    applyFilter(pixels, byId('mono'));

    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[4]).toBe(pixels[5]);
    expect(pixels[3]).toBe(128);
    expect(pixels[7]).toBe(255);
  });

  it('ปกติไม่เปลี่ยนพิกเซล · hue-rotate 0 องศาคืนสีเดิม', () => {
    const pixels = new Uint8ClampedArray([12, 34, 56, 255]);

    applyFilter(pixels, byId('normal'));
    expect([...pixels]).toEqual([12, 34, 56, 255]);

    applyFilter(pixels, { id: 't', label: 't', steps: [{ op: 'hue-rotate', degrees: 0 }] });
    expect([...pixels].map((value) => Math.round(value))).toEqual([12, 34, 56, 255]);
  });

  it('contrast รอบจุดกลาง 127.5 แบบ CSS', () => {
    const pixels = new Uint8ClampedArray([0, 255, 128, 255]);

    applyFilter(pixels, { id: 't', label: 't', steps: [{ op: 'contrast', amount: 0.5 }] });

    expect([...pixels]).toEqual([64, 191, 128, 255]);
  });

  it('coverCrop: ภาพแนวนอนตัดซ้ายขวาให้เป็น 9:16 กลางภาพ', () => {
    const crop = coverCrop(1920, 1080, 9 / 16);

    expect(crop.sh).toBe(1080);
    expect(crop.sw).toBeCloseTo(607.5);
    expect(crop.sx).toBeCloseTo((1920 - 607.5) / 2);
    expect(coverCrop(1080, 1920, 9 / 16)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
  });
});
