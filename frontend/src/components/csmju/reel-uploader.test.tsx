import { describe, expect, it } from 'vitest';
import {
  REEL_ACCEPT,
  REEL_MAX_BYTES,
  REEL_MAX_MS,
  reelFileProblem,
} from './reel-uploader';

/// เทสต์กติกาการลงคลิปสั้น
///
/// บั๊กที่พบจริง 29 ก.ย. 2569:
///   1. ช่องเลือกไฟล์รับแค่ mp4/webm — คลิป .mov จากมือถือถูกซ่อนตั้งแต่หน้าต่าง
///      เลือกไฟล์ ผู้ใช้เห็นว่า "ลงคลิปไม่ได้" โดยไม่มีข้อความอะไรเลย
///   2. คลิป 90 วินาทีถูกปัดเป็น 60 เงียบ ๆ แล้วลงได้ พร้อมป้ายความยาวที่ผิด

const MB = 1024 * 1024;

describe('ชนิดไฟล์ที่เลือกได้', () => {
  it('**รับ .mov จากมือถือ**', () => {
    expect(REEL_ACCEPT).toContain('video/quicktime');
    expect(REEL_ACCEPT).toContain('.mov');
  });

  it('ยังรับ mp4 webm m4v', () => {
    for (const type of ['video/mp4', 'video/webm', '.m4v']) {
      expect(REEL_ACCEPT).toContain(type);
    }
  });
});

describe('ตรวจไฟล์ก่อนอัปโหลด', () => {
  it('คลิป 10 วินาที 2 MB ผ่าน', () => {
    expect(reelFileProblem({ size: 2 * MB }, 10_000)).toBeNull();
  });

  it('ยาวพอดี 60 วินาทีผ่าน', () => {
    expect(reelFileProblem({ size: MB }, REEL_MAX_MS)).toBeNull();
  });

  it('**คลิป 90 วินาทีไม่ผ่าน และบอกความยาวจริง** ไม่ใช่ปัดเป็น 60', () => {
    const problem = reelFileProblem({ size: 3 * MB }, 90_000);

    expect(problem).toContain('1:30');
    expect(problem).toContain('ตัดให้เหลือไม่เกิน 60 วินาที');
  });

  it('ไฟล์ใหญ่เกินเพดานไม่ผ่าน และบอกขนาดจริง', () => {
    const problem = reelFileProblem({ size: REEL_MAX_BYTES + MB }, 20_000);

    expect(problem).toContain('51');
    expect(problem).toContain('เกินเพดาน');
  });

  it('**เบราว์เซอร์อ่านไฟล์ไม่ออก → บอกวิธีแก้** ไม่ใช่เดาว่ายาว 1 วินาที', () => {
    const problem = reelFileProblem({ size: 5 * MB }, null);

    expect(problem).toContain('HEVC');
    expect(problem).toContain('MP4');
  });
});
