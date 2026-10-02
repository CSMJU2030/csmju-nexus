import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compactCount } from './reel-media';
import { FollowToggle, SuggestionCaption } from './explore-suggestions';

/// เทสต์คำแนะนำ "ติดตามโดย…" ปุ่มติดตาม และตัวเลขแบบไทยของ IG

const apiPost = vi.hoisted(() => vi.fn());
const apiDel = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({ api: { post: apiPost, del: apiDel } }));
vi.mock('@/components/csmju/user-name', () => ({
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

beforeEach(() => {
  apiPost.mockReset();
  apiDel.mockReset();
  apiPost.mockResolvedValue({ following: true, followedBy: false, mutual: false });
  apiDel.mockResolvedValue({ following: false, followedBy: false, mutual: false });
});

describe('ตัวเลขแบบย่อภาษาไทย', () => {
  it.each([
    [999, '999'],
    [1_000, '1 พัน'],
    [2_345, '2.3 พัน'],
    [9_999, '9.9 พัน'],
    [11_000, '1.1 หมื่น'],
    [150_000, '1.5 แสน'],
    [2_100_000, '2.1 ล้าน'],
  ])('%i → %s', (value, text) => {
    expect(compactCount(value)).toBe(text);
  });
});

describe('ข้อความใต้ชื่อ', () => {
  it('**"ติดตามโดย ก และอีก n คน"** จาก followedBy จริง', () => {
    render(
      <SuggestionCaption row={{ coreUserId: 'x', followedBy: ['user-003', 'user-004'], followedByCount: 5 }} />,
    );

    expect(screen.getByText('ติดตามโดย ชื่อ user-003 และอีก 4 คน')).toBeInTheDocument();
  });

  it('มีคนเดียว = ไม่ต่อท้าย "และอีก"', () => {
    render(<SuggestionCaption row={{ coreUserId: 'x', followedBy: ['user-003'], followedByCount: 1 }} />);

    expect(screen.getByText('ติดตามโดย ชื่อ user-003')).toBeInTheDocument();
  });

  it('ไม่มี followedBy = "แนะนำสำหรับคุณ" (ไม่เดาชื่อเอง)', () => {
    render(<SuggestionCaption row={{ coreUserId: 'x', followedBy: [], followedByCount: 0 }} />);

    expect(screen.getByText('แนะนำสำหรับคุณ')).toBeInTheDocument();
  });
});

describe('ปุ่มติดตาม', () => {
  it('ติดตาม ⇄ กำลังติดตาม ตามผลจริงของ API', async () => {
    const user = userEvent.setup();
    const client = new QueryClient();

    render(
      <QueryClientProvider client={client}>
        <FollowToggle coreUserId="user-009" />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'ติดตาม' }));
    expect(apiPost).toHaveBeenCalledWith('/follows', { coreUserId: 'user-009' });
    expect(await screen.findByRole('button', { name: 'กำลังติดตาม' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'กำลังติดตาม' }));
    expect(apiDel).toHaveBeenCalledWith('/follows/user-009');
    expect(await screen.findByRole('button', { name: 'ติดตาม' })).toBeInTheDocument();
  });
});
