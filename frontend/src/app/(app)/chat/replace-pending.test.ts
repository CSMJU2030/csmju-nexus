import { describe, expect, it } from 'vitest';
import { replacePending } from './chat-logic';
import type { Message } from '@/lib/csmju/types';

/// เทสต์การแทนที่ข้อความชั่วคราวด้วยของจริง
///
/// ตรรกะนี้เล็กแต่พลาดแล้วเห็นชัดมาก: ถ้าจับคู่ไม่เจอ ข้อความที่ผู้ใช้เพิ่งพิมพ์
/// จะขึ้นสองอัน — ตัวที่เราวาดเองกับตัวที่เซิร์ฟเวอร์ส่งกลับมา
///
/// และมันเป็นจุดที่คนส่งเองได้ข้อความกลับ **สองทาง** เสมอ (ack ของ REST
/// และ broadcast ของ socket) จึงต้องกันซ้ำสองชั้น

function make(overrides: Partial<Message>): Message {
  return {
    id: 'm-real',
    seq: 10,
    clientNonce: 'nonce-1',
    content: 'สวัสดี',
    channelId: 'ch-1',
    authorCoreUserId: 'aaa',
    parentId: null,
    replyCount: 0,
    pinnedAt: null,
    pinnedByCoreUserId: null,
    editedAt: null,
    attachments: [],
    embed: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('replacePending', () => {
  it('แทนที่ตัวชั่วคราวที่ nonce ตรงกัน ไม่ใช่ต่อท้าย', () => {
    const pending = make({ id: 'pending-nonce-1', seq: Number.MAX_SAFE_INTEGER });
    const real = make({ id: 'm-real', seq: 42 });

    const next = replacePending([pending], real);

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('m-real');
    expect(next[0].seq).toBe(42);
  });

  it('รักษาตำแหน่งเดิมไว้ ไม่กระโดดไปท้ายรายการ', () => {
    // ถ้าแทนที่แล้วย้ายตำแหน่ง ข้อความจะเด้งไปมาต่อหน้าผู้ใช้
    const before = make({ id: 'm-0', clientNonce: 'nonce-0', seq: 1 });
    const pending = make({ id: 'pending-nonce-1', seq: Number.MAX_SAFE_INTEGER });
    const after = make({ id: 'm-2', clientNonce: 'nonce-2', seq: 3 });

    const next = replacePending(
      [before, pending, after],
      make({ id: 'm-real', seq: 2 }),
    );

    expect(next.map((row) => row.id)).toEqual(['m-0', 'm-real', 'm-2']);
  });

  it('ข้อความของคนอื่นต่อท้ายตามปกติ', () => {
    const mine = make({ id: 'm-1', clientNonce: 'nonce-1' });
    const theirs = make({
      id: 'm-2',
      clientNonce: 'nonce-ของเขา',
      authorCoreUserId: 'bbb',
    });

    const next = replacePending([mine], theirs);

    expect(next).toHaveLength(2);
    expect(next[1].id).toBe('m-2');
  });

  it('ได้ของเดิมซ้ำทาง id = ไม่เพิ่มอีกอัน', () => {
    // คนส่งเองได้ทั้ง ack ของ REST และ broadcast ของ socket
    const real = make({ id: 'm-real' });

    const next = replacePending([real], real);

    expect(next).toHaveLength(1);
  });

  it('ไทม์ไลน์ว่าง = เพิ่มเข้าไปได้', () => {
    const next = replacePending([], make({}));

    expect(next).toHaveLength(1);
  });

  it('nonce ตรงกันชนะ id ที่ไม่ตรง — ไม่ปล่อยให้ขึ้นสองอัน', () => {
    // นี่คือเคสจริงของ optimistic send: id คนละตัวแน่นอน (ตัวชั่วคราวเป็น
    // pending-xxx) แต่ nonce เดียวกัน ถ้าดูแต่ id จะได้ข้อความซ้ำทันที
    const pending = make({ id: 'pending-nonce-9', clientNonce: 'nonce-9' });
    const real = make({ id: 'm-จากเซิร์ฟเวอร์', clientNonce: 'nonce-9' });

    const next = replacePending([pending], real);

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('m-จากเซิร์ฟเวอร์');
  });
});
