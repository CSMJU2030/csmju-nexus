import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryTray } from '@/lib/csmju/types';
import { StoryRow } from './story-row';

/// เทสต์แถวสตอรี่ — ลำดับวง และลิงก์ที่แชร์มา ?story=<id>

const apiGet = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock('next/navigation', () => ({ useSearchParams: () => params.current }));
vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, post: vi.fn().mockResolvedValue({}), list: vi.fn().mockResolvedValue({ items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }) },
  ApiError: class extends Error {},
  qs: () => '',
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

const story = (id: string, author: string, viewed = false) => ({
  id,
  authorCoreUserId: author,
  kind: 'IMAGE' as const,
  mediaUrl: `http://files.local/${id}.jpg`,
  assetId: `asset-${id}`,
  caption: null,
  viewedByMe: viewed,
  viewCount: 0,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

const trays: StoryTray[] = [
  { authorCoreUserId: 'user-009', isMe: false, hasUnseen: false, stories: [story('seen', 'user-009', true)] },
  { authorCoreUserId: 'user-003', isMe: false, hasUnseen: true, stories: [story('a', 'user-003'), story('b', 'user-003')] },
  { authorCoreUserId: 'user-002', isMe: true, hasUnseen: false, stories: [story('mine', 'user-002')] },
];

beforeEach(() => {
  params.current = new URLSearchParams();
  apiGet.mockReset();
  apiGet.mockResolvedValue(trays);
});

afterEach(() => {
  document.querySelectorAll('[role=status]').forEach((node) => node.remove());
});

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <StoryRow />
    </QueryClientProvider>,
  );
}

describe('แถวสตอรี่', () => {
  it('ของฉันก่อน → คนที่ยังมีชิ้นไม่ได้ดู → คนที่ดูครบแล้ว (แบบ IG)', async () => {
    renderRow();

    const circles = await screen.findAllByRole('button', { name: /^ดูสตอรี่ของ/ });

    expect(circles.map((node) => node.getAttribute('aria-label'))).toEqual([
      'ดูสตอรี่ของ คุณ',
      'ดูสตอรี่ของ ชื่อ user-003',
      'ดูสตอรี่ของ ชื่อ user-009',
    ]);
  });

  it('**ลิงก์ ?story=<id> เปิดตัวดูที่ชิ้นนั้นทันที**', async () => {
    params.current = new URLSearchParams('story=b');
    renderRow();

    expect(await screen.findByRole('dialog', { name: 'สตอรี่ของ ชื่อ user-003' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'สตอรี่' })).toHaveAttribute('src', 'http://files.local/b.jpg');
  });

  it('ลิงก์ชี้สตอรี่ที่หมดอายุ/ไม่มีสิทธิ์ดู → บอกตรง ๆ ไม่เปิดตัวดูเปล่า', async () => {
    params.current = new URLSearchParams('story=gone');
    renderRow();

    expect(await screen.findByText(/สตอรี่นี้ไม่มีให้ดูแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
