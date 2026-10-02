import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactionSummary } from '@/lib/csmju/types';

/// ชิปรีแอ็กชันแบบ Discord — กดชิป = +1/−1 ของเราเอง · ชิปที่เรากดเรือง · ชี้แล้วเห็นคนกด

const apiGet = vi.fn();

vi.mock('@/lib/csmju/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

// แผงอิโมจิชุดเต็มหนักเกินสำหรับเทสต์นี้ — เหลือแค่ปุ่มเลือกตัวเดียว
vi.mock('@/components/csmju/emoji-picker', () => ({
  EMOJI_FONT: 'sans-serif',
  EmojiPopover: ({ open, onPick }: { open: boolean; onPick: (emoji: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick('🎉')}>
        เลือก 🎉
      </button>
    ) : null,
}));

vi.mock('@/components/csmju/user-name', () => ({
  useProfile: (id: string) => ({ coreUserId: id, displayName: `ชื่อ-${id}`, avatarUrl: null, badge: null }),
}));

const { ReactionChips, parseReactors } = await import('./reaction-chips');

function summary(totals: ReactionSummary['totals']): ReactionSummary {
  return {
    targetKind: 'MESSAGE',
    targetId: 'm1',
    totals,
    totalCount: totals.reduce((sum, row) => sum + row.count, 0),
  };
}

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReactionChips', () => {
  it('ไม่มีใครกด = ไม่วาดอะไร', () => {
    const { container } = render(
      <ReactionChips channelId="c1" messageId="m1" summary={summary([])} onToggle={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('**กดชิปที่เพื่อนกดไว้ = เพิ่มของเรา · กดชิปที่เรากดไว้ = ถอนของเรา**', async () => {
    const onToggle = vi.fn();

    render(
      <ReactionChips
        channelId="c1"
        messageId="m1"
        summary={summary([
          { emoji: '👍', count: 2, reactedByMe: false },
          { emoji: '🔥', count: 1, reactedByMe: true },
        ])}
        onToggle={onToggle}
      />,
    );

    const thumbs = screen.getByRole('button', { name: /👍 2 คน/ });
    const fire = screen.getByRole('button', { name: /🔥 1 คน/ });

    // ชิปที่เรากดไว้เรือง (aria-pressed) — ของเพื่อนไม่เรือง
    expect(thumbs).toHaveAttribute('aria-pressed', 'false');
    expect(fire).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(thumbs);
    await userEvent.click(fire);

    expect(onToggle).toHaveBeenNthCalledWith(1, '👍', false);
    expect(onToggle).toHaveBeenNthCalledWith(2, '🔥', true);
  });

  it('ปุ่ม + เลือกอิโมจิใหม่ได้', async () => {
    const onToggle = vi.fn();

    render(
      <ReactionChips
        channelId="c1"
        messageId="m1"
        summary={summary([{ emoji: '👍', count: 1, reactedByMe: false }])}
        onToggle={onToggle}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }));
    await userEvent.click(screen.getByRole('button', { name: 'เลือก 🎉' }));

    expect(onToggle).toHaveBeenCalledWith('🎉', false);
  });

  it('ชี้ค้างที่ชิป = ขึ้นชื่อคนที่กด จาก GET …/reactions?emoji=', async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue([
      { coreUserId: 'u1', createdAt: '2026-10-01T00:00:00.000Z' },
      { coreUserId: 'u2', createdAt: '2026-10-01T00:00:01.000Z' },
    ]);

    render(
      <ReactionChips
        channelId="c1"
        messageId="m1"
        summary={summary([{ emoji: '👍', count: 2, reactedByMe: false }])}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.pointerEnter(screen.getByRole('button', { name: /👍 2 คน/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(apiGet).toHaveBeenCalledWith(`/channels/c1/messages/m1/reactions?emoji=${encodeURIComponent('👍')}`);

    const tip = screen.getByRole('tooltip');

    expect(tip).toHaveTextContent('ชื่อ-u1 และ ชื่อ-u2 รีแอ็กด้วย 👍');
  });

  it('parseReactors รับได้ทั้งอาเรย์และแบบแบ่งหน้า', () => {
    expect(parseReactors([{ coreUserId: 'a' }])).toEqual(['a']);
    expect(parseReactors({ items: [{ coreUserId: 'b' }] })).toEqual(['b']);
    expect(parseReactors(null)).toEqual([]);
  });
});
