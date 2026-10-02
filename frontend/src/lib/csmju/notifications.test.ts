import { describe, expect, it } from 'vitest';
import {
  describeNotification,
  notificationLink,
  timeAgo,
} from './notifications';
import type { Notification } from './types';

/// เทสต์ตรรกะร่วมของการแจ้งเตือน
///
/// ใช้ทั้งกระดิ่งบนแถบบนและหน้า /notifications — ถ้าเพี้ยน สองที่นั้นจะพูด
/// คนละอย่างเรื่องการแจ้งเตือนรายการเดียวกัน
///
/// ข้อที่สำคัญที่สุดคือ `notificationLink` ต้องคืน null เมื่อพาไปตรงจุดไม่ได้
/// ลิงก์ที่พาไปผิดที่ทำให้คนเลิกเชื่อการแจ้งเตือนทั้งระบบ ซึ่งแย่กว่าไม่มีลิงก์

function make(overrides: Partial<Notification>): Notification {
  return {
    id: 'n1',
    kind: 'FOLLOW',
    refId: 'r1',
    actorCoreUserId: '6700001999-somchai',
    payload: null,
    readAt: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('describeNotification', () => {
  it('อ่านออกโดยไม่ต้องยิงถามหลังบ้านเพิ่ม', () => {
    expect(describeNotification(make({ kind: 'FOLLOW' }))).toBe(
      '6700001999-somchai เริ่มติดตามคุณ',
    );
  });

  it('เอาตัวอย่างข้อความมาแสดงด้วยถ้ามี', () => {
    const text = describeNotification(
      make({ kind: 'POST_COMMENT', payload: { preview: 'เห็นด้วยครับ' } }),
    );

    expect(text).toContain('เห็นด้วยครับ');
  });

  it('ประกาศถึงทุกคนต่างจากการเรียกถึงเราคนเดียว', () => {
    const broadcast = describeNotification(
      make({ kind: 'MENTION', payload: { broadcast: true } }),
    );
    const direct = describeNotification(make({ kind: 'MENTION', payload: {} }));

    expect(broadcast).toContain('ประกาศถึงทุกคน');
    expect(direct).toContain('เรียกถึงคุณ');
  });

  it('ไม่รู้จักชนิดนี้ก็ยังอ่านออกเป็นภาษาไทย ไม่ใช่ช่องว่างหรือชื่อ enum', () => {
    // หลังบ้านเพิ่มชนิดใหม่แล้วหน้าบ้านยังไม่รู้จัก ต้องไม่กลายเป็นแถวเปล่า
    // และต้องไม่โชว์ชื่อ enum ภาษาอังกฤษ (เคยหลุด "REEL_REPOST" ให้ผู้ใช้เห็น)
    const text = describeNotification(
      make({ kind: 'SOMETHING_NEW' as Notification['kind'] }),
    );

    expect(text).not.toContain('SOMETHING_NEW');
    expect(text).toContain('มีความเคลื่อนไหวใหม่');
  });

  it('ชนิดรอบใหม่ทุกชนิดมีข้อความภาษาไทยของตัวเอง', () => {
    const cases: [Partial<Notification>, string][] = [
      [{ kind: 'REEL_REPOST', payload: { preview: 'คลิป' } }, 'รีโพสต์คลิปของคุณ · คลิป'],
      [{ kind: 'COMMENT_LIKE', payload: { preview: 'ดีมาก' } }, 'ถูกใจความคิดเห็นของคุณ: ดีมาก'],
      [{ kind: 'STORY_REPLY', payload: { emoji: '😍', preview: null } }, 'แสดงความรู้สึก 😍 ต่อสตอรี่ของคุณ'],
      [{ kind: 'STORY_REPLY', payload: { preview: 'สวยมาก' } }, 'ตอบกลับสตอรี่ของคุณ: สวยมาก'],
      [{ kind: 'MISSED_CALL', payload: { media: 'AUDIO' } }, 'โทรหาคุณ · ไม่ได้รับสาย'],
      [{ kind: 'MISSED_CALL', payload: { media: 'VIDEO' } }, 'วิดีโอคอลหาคุณ · ไม่ได้รับสาย'],
      [{ kind: 'MENTION', payload: { story: true } }, 'กล่าวถึงคุณในสตอรี่'],
      [{ kind: 'REACTION', payload: { targetKind: 'POST', emoji: '❤️' } }, 'กด ❤️ ให้โพสต์ของคุณ'],
    ];

    for (const [overrides, expected] of cases) {
      expect(describeNotification(make(overrides))).toBe(`6700001999-somchai ${expected}`);
    }
  });

  it('ไม่รู้ว่าใครทำก็ยังอ่านออก', () => {
    expect(describeNotification(make({ actorCoreUserId: null }))).toContain(
      'มีคน',
    );
  });
});

describe('notificationLink', () => {
  it('ติดตาม → ไปโปรไฟล์คนนั้น', () => {
    expect(notificationLink(make({ kind: 'FOLLOW' }))).toBe(
      '/profile/6700001999-somchai',
    );
  });

  it('เรียกถึงในห้องแชท → เปิดห้องนั้นเลย ไม่ใช่หน้ารวม', () => {
    // นี่คือเหตุผลที่หน้าแชทรับ ?channel= — ถ้าพาไปหน้ารวมเฉย ๆ
    // ผู้ใช้ต้องไปไล่หาเองว่าใครเรียกในห้องไหน
    expect(
      notificationLink(
        make({ kind: 'MENTION', payload: { channelId: 'ch-9' } }),
      ),
    ).toBe('/chat?channel=ch-9');
  });

  it('ไม่รู้ว่าห้องไหน → ไม่ให้ลิงก์ ดีกว่าพาไปผิดที่', () => {
    expect(notificationLink(make({ kind: 'MENTION', payload: {} }))).toBeNull();
  });

  it('ชนิดที่ยังไม่มีหน้าปลายทาง → ไม่ให้ลิงก์', () => {
    expect(
      notificationLink(make({ kind: 'UNKNOWN' as Notification['kind'] })),
    ).toBeNull();
  });

  it('เข้ารหัส id ที่มีอักขระพิเศษ', () => {
    // ชื่อผู้ใช้หรือ id ที่มี / หรือ ? จะทำให้ URL เพี้ยนถ้าไม่เข้ารหัส
    const link = notificationLink(
      make({ kind: 'FOLLOW', actorCoreUserId: 'a/b?c' }),
    );

    expect(link).toBe('/profile/a%2Fb%3Fc');
  });

  it('นัดประชุมมีหน้าของตัวเอง · ชวนเข้าห้องเสียงเปิดช่องเสียงนั้นใน /chat', () => {
    expect(notificationLink(make({ kind: 'MEETING_INVITE' }))).toBe('/meetings');
    expect(notificationLink(make({ kind: 'VOICE_INVITE', payload: { channelId: 'v1' } }))).toBe('/chat?channel=v1');
  });

  it('พาไปที่ตัวโพสต์ คลิป สตอรี่ หรือแชทนั้นตรง ๆ ไม่ใช่หน้ารวม', () => {
    expect(notificationLink(make({ kind: 'POST_COMMENT', refId: 'p1' }))).toBe('/p/p1');
    expect(notificationLink(make({ kind: 'REEL_LIKE', refId: 'r9' }))).toBe('/reels?reel=r9');
    expect(notificationLink(make({ kind: 'REEL_REPOST', refId: 'r9' }))).toBe('/reels?reel=r9');
    expect(notificationLink(make({ kind: 'COMMENT_LIKE', refId: 'r9' }))).toBe('/reels?reel=r9');
    expect(notificationLink(make({ kind: 'REACTION', refId: 'p1', payload: { targetKind: 'POST' } }))).toBe('/p/p1');
    expect(notificationLink(make({ kind: 'MENTION', refId: 's1', payload: { story: true } }))).toBe('/feed?story=s1');
    expect(notificationLink(make({ kind: 'MISSED_CALL', payload: { channelId: 'dm1' } }))).toBe('/messages?channel=dm1');
    expect(notificationLink(make({ kind: 'STORY_REPLY', payload: { channelId: 'dm1' } }))).toBe('/messages?channel=dm1');
  });
});

describe('timeAgo', () => {
  it('บอกเป็นภาษาคน ไม่ใช่วันที่ดิบ', () => {
    const now = Date.now();

    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe('เมื่อครู่');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe(
      '5 นาทีที่แล้ว',
    );
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString())).toBe(
      '3 ชั่วโมงที่แล้ว',
    );
    expect(timeAgo(new Date(now - 2 * 86400_000).toISOString())).toBe(
      '2 วันที่แล้ว',
    );
  });
});
