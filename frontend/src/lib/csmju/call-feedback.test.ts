import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn(async () => ({ id: 'fb-1' })));

vi.mock('@/lib/csmju/api', () => ({ api: { post } }));

import {
  feedbackBody,
  sendCallFeedback,
  shouldAskRating,
  talkSeconds,
} from './call-feedback';

beforeEach(() => post.mockClear());

describe('ถามคะแนนเมื่อไหร่', () => {
  it('ไม่เคยต่อติด = ไม่ถาม', () => {
    expect(shouldAskRating(null, 60_000)).toBe(false);
  });

  it('คุยไม่ถึง 5 วินาที = ไม่ถาม · ถึงแล้วถาม', () => {
    expect(shouldAskRating(10_000, 14_400)).toBe(false);
    expect(shouldAskRating(10_000, 15_000)).toBe(true);
  });

  it('นับจากตอนต่อติด ไม่ใช่ตอนกดโทร และไม่ติดลบ', () => {
    expect(talkSeconds(1_000, 62_400)).toBe(61);
    expect(talkSeconds(5_000, 4_000)).toBe(0);
    expect(talkSeconds(null, 4_000)).toBeNull();
  });
});

describe('ส่งคะแนน', () => {
  it('ส่งตามสัญญา POST /calls/feedback พร้อมเวลาคุยจริงและชนิดสาย', async () => {
    await sendCallFeedback(
      feedbackBody({
        channelId: 'dm-1',
        rating: 4,
        connectedAt: 1_000,
        endedAt: 93_000,
        kind: 'VIDEO',
      }),
    );

    expect(post).toHaveBeenCalledWith('/calls/feedback', {
      channelId: 'dm-1',
      rating: 4,
      durationSec: 92,
      kind: 'VIDEO',
    });
  });

  it('คะแนนอยู่ในช่วง 1–5 เสมอ', () => {
    const base = { channelId: 'dm-1', connectedAt: 0, endedAt: 10_000, kind: 'AUDIO' as const };

    expect(feedbackBody({ ...base, rating: 9 }).rating).toBe(5);
    expect(feedbackBody({ ...base, rating: 0 }).rating).toBe(1);
  });

  it('ไม่รู้เวลาคุย = ไม่ส่ง durationSec (เป็น optional ไม่ใช่ 0)', () => {
    expect(
      feedbackBody({ channelId: 'dm-1', rating: 3, connectedAt: null, endedAt: 1, kind: 'AUDIO' }),
    ).not.toHaveProperty('durationSec');
  });
});
