import { parseByteRange } from './byte-range.js';

describe('parseByteRange', () => {
  it('ไม่มีหัว Range หรืออ่านไม่ออก = ส่งทั้งไฟล์', () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange('items=0-5', 100)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseByteRange('bytes=-', 100)).toBeNull();
  });

  it('ช่วงปกติ ช่วงเปิดท้าย และช่วงท้ายไฟล์', () => {
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('ช่วงนอกไฟล์ = 416', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=9-3', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});
