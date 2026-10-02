import { describe, expect, it } from 'vitest';
import { isCollision, isPolite, shouldIgnoreOffer } from './negotiation';

/// เทสต์กฎการเจรจาสาย WebRTC
///
/// **บั๊กที่เทสต์ชุดนี้กันไว้: ห้องเสียงค้างที่ "กำลังต่อสาย…" ถาวร**
///
/// ของเดิมแบ่งหน้าที่ตายตัวว่าใครเป็นฝ่ายยื่นข้อเสนอ โดยเทียบชื่อกันตอน
/// เปิดสาย — แต่ลูปที่เปิดสายวิ่งเฉพาะ "ตอนเราเข้าห้อง" และเห็นเฉพาะคนที่
/// อยู่ก่อนเราเท่านั้น ส่วนคนที่อยู่ก่อนไม่มี event บอกว่ามีใครเข้ามา
///
/// ผลคือถ้าชื่อคนใหม่เรียงทีหลังคนเก่า **จะไม่มีใครยื่นเลยสักฝ่าย**
/// คนเก่าขึ้นว่า "รอสัญญาณ" (ไม่มีสายด้วยซ้ำ) คนใหม่ขึ้นว่า "กำลังต่อสาย…"
/// (มีสายแต่ไม่ยื่น) — และเพราะมันขึ้นกับลำดับตัวอักษรของ id อาการจึงเป็น
/// "บางคู่โทรติด บางคู่ไม่ติด" ซึ่งดูเหมือนปัญหาเครือข่ายจนหาสาเหตุไม่เจอ
///
/// ตอนนี้ทั้งสองฝั่งยื่นเองได้ กฎที่เหลือคือ "ยื่นชนกันแล้วใครถอย"
/// ซึ่งต้องได้ผลตรงข้ามกันเสมอ ไม่งั้นค้างเหมือนเดิม

const PAIRS: [string, string][] = [
  ['user-002', 'user-003'],
  ['user-003', 'user-002'],
  ['user-002', 'user-002x'],
  ['a', 'b'],
  ['9f3c1e2a-0000-4000-8000-000000000001', '9f3c1e2a-0000-4000-8000-000000000002'],
];

describe('ใครยอมถอยเมื่อยื่นชนกัน', () => {
  it('**ต้องตรงข้ามกันเสมอ** — ไม่งั้นสายค้างถาวร', () => {
    for (const [left, right] of PAIRS) {
      expect(isPolite(left, right)).toBe(!isPolite(right, left));
    }
  });

  it('ตัดสินเหมือนเดิมทุกครั้ง ไม่ขึ้นกับว่าใครเข้าห้องก่อน', () => {
    expect(isPolite('user-003', 'user-002')).toBe(true);
    expect(isPolite('user-002', 'user-003')).toBe(false);
  });
});

describe('ข้อเสนอชนกันไหม', () => {
  it('สายว่างอยู่ ไม่ถือว่าชน', () => {
    expect(isCollision({ makingOffer: false, signalingState: 'stable' })).toBe(
      false,
    );
  });

  it('เรากำลังสร้างข้อเสนอของเราเอง ถือว่าชน', () => {
    // จังหวะนี้ยังไม่ทันส่งออกไป สถานะจึงยังเป็น stable อยู่ —
    // ถ้าดูแค่ signalingState จะพลาดกรณีนี้ทั้งกรณี
    expect(isCollision({ makingOffer: true, signalingState: 'stable' })).toBe(
      true,
    );
  });

  it('ส่งข้อเสนอไปแล้วกำลังรอคำตอบ ถือว่าชน', () => {
    expect(
      isCollision({ makingOffer: false, signalingState: 'have-local-offer' }),
    ).toBe(true);
  });
});

describe('เมินข้อเสนอที่เข้ามาไหม', () => {
  it('ไม่ชนกัน ต้องรับเสมอ แม้เราจะเป็นฝ่ายไม่ยอมถอย', () => {
    expect(
      shouldIgnoreOffer({
        polite: false,
        makingOffer: false,
        signalingState: 'stable',
      }),
    ).toBe(false);
  });

  it('ชนกันแล้วเราเป็นฝ่ายยอมถอย ต้องรับของเขา (ทิ้งของเราเอง)', () => {
    expect(
      shouldIgnoreOffer({
        polite: true,
        makingOffer: true,
        signalingState: 'have-local-offer',
      }),
    ).toBe(false);
  });

  it('ชนกันแล้วเราเป็นฝ่ายไม่ยอมถอย ต้องเมินของเขา', () => {
    expect(
      shouldIgnoreOffer({
        polite: false,
        makingOffer: true,
        signalingState: 'stable',
      }),
    ).toBe(true);
  });

  it('**คู่หนึ่งคู่ ต้องมีฝ่ายเดียวที่เมิน** — ไม่ใช่ทั้งคู่หรือไม่มีใครเลย', () => {
    // จำลองการยื่นชนกันจริง: ทั้งคู่ส่งข้อเสนอออกไปพร้อมกัน แล้วต่างฝ่าย
    // ต่างได้ของอีกฝ่ายมาในขณะที่ตัวเองยังรอคำตอบอยู่
    for (const [left, right] of PAIRS) {
      const decisions = [
        shouldIgnoreOffer({
          polite: isPolite(left, right),
          makingOffer: false,
          signalingState: 'have-local-offer',
        }),
        shouldIgnoreOffer({
          polite: isPolite(right, left),
          makingOffer: false,
          signalingState: 'have-local-offer',
        }),
      ];

      expect(decisions.filter(Boolean)).toHaveLength(1);
    }
  });
});
