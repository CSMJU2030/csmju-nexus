import { describe, expect, it } from 'vitest';
import type { Channel, Message, ReactionSummary } from '@/lib/csmju/types';
import {
  PENDING_SEQ,
  buildTimelineRows,
  elapsedLabel,
  firstUnreadId,
  groupChannels,
  keepChipOrder,
  mergeReactionBroadcast,
  reactorsLabel,
  stampLabel,
  thaiDateLabel,
  toggleReactionLocally,
} from './chat-logic';

function room(overrides: Partial<Channel>): Channel {
  return {
    id: 'r',
    kind: 'GROUP',
    name: 'ห้อง',
    courseTag: null,
    maxSeats: 8,
    memberCount: 3,
    myRole: 'MEMBER',
    unreadCount: 0,
    peerCoreUserId: null,
    description: null,
    createdByCoreUserId: 'admin',
    canManage: false,
    lastMessage: null,
    inboxFolder: 'PRIMARY',
    pinnedAt: null,
    muted: false,
    clearedAt: null,
    peerLastReadSeq: null,
    memberCoreUserIds: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function msg(overrides: Partial<Message>): Message {
  return {
    id: 'm',
    seq: 1,
    channelId: 'r',
    authorCoreUserId: 'a',
    content: 'สวัสดี',
    attachments: [],
    embed: null,
    parentId: null,
    replyCount: 0,
    pinnedAt: null,
    pinnedByCoreUserId: null,
    clientNonce: 'n',
    editedAt: null,
    createdAt: '2026-08-18T03:00:00.000Z',
    ...overrides,
  };
}

const target = { targetKind: 'MESSAGE' as const, targetId: 'm1' };

function summary(totals: ReactionSummary['totals']): ReactionSummary {
  return { ...target, totals, totalCount: totals.reduce((sum, row) => sum + row.count, 0) };
}

describe('groupChannels — แถบซ้ายแบบ Discord', () => {
  it('แยกช่องข้อความกับช่องสำหรับพูด และไม่เอาแชทส่วนตัว/แชทกลุ่มแบบ Instagram', () => {
    const groups = groupChannels([
      room({ id: 'dm', kind: 'DM', name: null }),
      room({ id: 'gdm', kind: 'GROUP_DM', name: 'แชทกลุ่ม' }),
      room({ id: 'g', kind: 'GROUP', name: 'ทั่วไป' }),
      room({ id: 'v', kind: 'VOICE', name: 'ทั่วไป' }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['ช่องข้อความ', 'ช่องสำหรับพูด']);
    expect(groups[0].channels.map((c) => c.id)).toEqual(['g']);
    expect(groups[1].channels.map((c) => c.id)).toEqual(['v']);
  });

  it('ห้องประจำวิชาที่ติดรหัสวิชาได้หมวดของตัวเอง เรียงตามรหัส', () => {
    const groups = groupChannels([
      room({ id: 'c2', kind: 'COURSE', courseTag: 'CS301' }),
      room({ id: 'c1', kind: 'COURSE', courseTag: 'cs201' }),
      room({ id: 'c0', kind: 'COURSE', courseTag: null }),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      'ช่องข้อความ',
      'วิชา CS201',
      'วิชา CS301',
      'ช่องสำหรับพูด',
    ]);
    expect(groups[0].channels.map((c) => c.id)).toEqual(['c0']);
  });

  it('เรียงตามเวลาที่สร้าง ไม่ใช่ตามข้อความล่าสุด — ช่องไม่สลับที่ทุกครั้งที่มีคนพิมพ์', () => {
    const groups = groupChannels([
      room({ id: 'new', createdAt: '2026-09-03T00:00:00.000Z' }),
      room({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
    ]);

    expect(groups[0].channels.map((c) => c.id)).toEqual(['old', 'new']);
  });
});

describe('mergeReactionBroadcast — ยอดที่มาทาง socket', () => {
  it('**เพื่อนกด 👍 แล้วชิปของเราต้องไม่เรืองว่าเรากดแล้ว** (บั๊กที่ PL เจอ)', () => {
    // หลังบ้านคำนวณ reactedByMe จากมุมของคนกด แล้วกระจายชุดเดียวกันทั้งห้อง
    const merged = mergeReactionBroadcast(
      null,
      { ...target, totals: [{ emoji: '👍', count: 1, reactedByMe: true }], totalCount: 1 },
      'me',
    );

    expect(merged.totals).toEqual([{ emoji: '👍', count: 1, reactedByMe: false }]);
  });

  it('เรากดไว้แล้ว เพื่อนกดเพิ่ม → ยอดขึ้น และยังเรืองอยู่', () => {
    const merged = mergeReactionBroadcast(
      summary([{ emoji: '👍', count: 1, reactedByMe: true }]),
      { ...target, totals: [{ emoji: '👍', count: 2, reactedByMe: false }], totalCount: 2 },
      'me',
    );

    expect(merged.totals).toEqual([{ emoji: '👍', count: 2, reactedByMe: true }]);
  });

  it('เชื่อ reactedByMe ของ payload เมื่อเป็นการกดของเราเอง (actorCoreUserId)', () => {
    const merged = mergeReactionBroadcast(
      summary([{ emoji: '👍', count: 1, reactedByMe: true }]),
      {
        ...target,
        totals: [{ emoji: '👍', count: 1, reactedByMe: false }],
        totalCount: 1,
        actorCoreUserId: 'me',
      },
      'me',
    );

    expect(merged.totals[0].reactedByMe).toBe(false);
  });

  it('ถ้าหลังบ้านส่งรายชื่อคนกดมา ใช้รายชื่อนั้นตัดสิน', () => {
    const merged = mergeReactionBroadcast(
      null,
      {
        ...target,
        totals: [{ emoji: '🔥', count: 2, reactedByMe: false, reactorCoreUserIds: ['x', 'me'] }],
        totalCount: 2,
      },
      'me',
    );

    expect(merged.totals[0].reactedByMe).toBe(true);
  });
});

describe('toggleReactionLocally — กดชิปแล้วเปลี่ยนทันที', () => {
  it('กดชิปที่เพื่อนกดไว้ = +1 ของเรา และเรือง', () => {
    const next = toggleReactionLocally(
      summary([{ emoji: '👍', count: 2, reactedByMe: false }]),
      target,
      '👍',
      false,
    );

    expect(next.totals).toEqual([{ emoji: '👍', count: 3, reactedByMe: true }]);
    expect(next.totalCount).toBe(3);
  });

  it('กดชิปที่เรากดไว้ = −1 และเลิกเรือง', () => {
    const next = toggleReactionLocally(
      summary([{ emoji: '👍', count: 3, reactedByMe: true }]),
      target,
      '👍',
      true,
    );

    expect(next.totals).toEqual([{ emoji: '👍', count: 2, reactedByMe: false }]);
  });

  it('ยอดเหลือ 0 → ชิปหายไป', () => {
    const next = toggleReactionLocally(
      summary([{ emoji: '😂', count: 1, reactedByMe: true }]),
      target,
      '😂',
      true,
    );

    expect(next.totals).toEqual([]);
  });

  it('อิโมจิใหม่ต่อท้าย', () => {
    const next = toggleReactionLocally(
      summary([{ emoji: '👍', count: 1, reactedByMe: false }]),
      target,
      '🎉',
      false,
    );

    expect(next.totals.map((row) => row.emoji)).toEqual(['👍', '🎉']);
  });

  it('กดซ้ำตัวที่เรากดแล้วในฐานะ "เพิ่ม" ไม่นับซ้ำ', () => {
    const next = toggleReactionLocally(
      summary([{ emoji: '👍', count: 1, reactedByMe: true }]),
      target,
      '👍',
      false,
    );

    expect(next.totals[0].count).toBe(1);
  });
});

describe('keepChipOrder', () => {
  it('ชิปไม่สลับที่ใต้นิ้วเมื่อยอดแซงกัน', () => {
    const before = summary([
      { emoji: '👍', count: 2, reactedByMe: false },
      { emoji: '🔥', count: 1, reactedByMe: false },
    ]);
    const after = summary([
      { emoji: '🔥', count: 3, reactedByMe: true },
      { emoji: '👍', count: 2, reactedByMe: false },
    ]);

    expect(keepChipOrder(before, after).totals.map((row) => row.emoji)).toEqual(['👍', '🔥']);
  });
});

describe('reactorsLabel', () => {
  it('ชื่อไม่เกินสามคน ที่เหลือเป็นตัวเลข', () => {
    expect(reactorsLabel(['ก', 'ข', 'ค', 'ง'], 5, '👍')).toBe('ก, ข, ค และอีก 2 คน รีแอ็กด้วย 👍');
    expect(reactorsLabel(['ก', 'ข'], 2, '👍')).toBe('ก และ ข รีแอ็กด้วย 👍');
    expect(reactorsLabel(['ก'], 1, '👍')).toBe('ก รีแอ็กด้วย 👍');
    expect(reactorsLabel([], 3, '👍')).toBe('3 คนรีแอ็กด้วย 👍');
  });
});

describe('ไทม์ไลน์', () => {
  it('วันที่แบบ Discord ภาษาไทย ปีพุทธศักราช', () => {
    expect(thaiDateLabel('2026-08-18T03:00:00.000Z')).toBe('18 สิงหาคม 2569');
  });

  it('หัวข้อความบอก "วันนี้" / "เมื่อวาน"', () => {
    const now = new Date('2026-08-18T10:00:00.000Z');

    expect(stampLabel('2026-08-18T03:05:00.000Z', now)).toBe('วันนี้ เวลา 10:05');
    expect(stampLabel('2026-08-17T03:05:00.000Z', now)).toBe('เมื่อวาน เวลา 10:05');
  });

  it('เส้น "ใหม่" อยู่ก่อนข้อความแรกที่ยังไม่อ่าน (นับถอยจากท้าย ไม่นับตัวชั่วคราว)', () => {
    const timeline = [
      msg({ id: 'a', seq: 1 }),
      msg({ id: 'b', seq: 2 }),
      msg({ id: 'c', seq: 3 }),
      msg({ id: 'p', seq: PENDING_SEQ }),
    ];

    expect(firstUnreadId(timeline, 2)).toBe('b');
    expect(firstUnreadId(timeline, 0)).toBeNull();
    expect(firstUnreadId(timeline, 99)).toBe('a');
  });

  it('มีเส้นคั่นวัน · เส้น "ใหม่" · ยุบหัวข้อความต่อเนื่องจากคนเดิม', () => {
    const rows = buildTimelineRows(
      [
        msg({ id: 'a', authorCoreUserId: 'x', createdAt: '2026-08-17T03:00:00.000Z' }),
        msg({ id: 'b', authorCoreUserId: 'x', createdAt: '2026-08-18T03:00:00.000Z' }),
        msg({ id: 'c', authorCoreUserId: 'x', createdAt: '2026-08-18T03:01:00.000Z' }),
        msg({ id: 'd', authorCoreUserId: 'x', createdAt: '2026-08-18T03:02:00.000Z' }),
        msg({ id: 'e', authorCoreUserId: 'y', createdAt: '2026-08-18T03:03:00.000Z' }),
      ],
      'd',
    );

    expect(rows.map((row) => (row.type === 'message' ? `${row.key}${row.grouped ? '+' : ''}` : row.type))).toEqual([
      'date',
      'a',
      'date',
      'b',
      'c+',
      'unread',
      'd',
      'e',
    ]);
  });

  it('elapsedLabel', () => {
    const now = new Date('2026-08-18T10:00:00.000Z');

    expect(elapsedLabel('2026-08-18T09:55:28.000Z', now)).toBe('04:32');
    expect(elapsedLabel('2026-08-18T08:54:51.000Z', now)).toBe('1:05:09');
  });
});
