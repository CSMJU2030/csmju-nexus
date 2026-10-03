import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@/lib/csmju/types';
import { ExploreResults, type SearchResult } from './explore-results';

/// เทสต์ผลค้นหาแบบ Instagram — ลำดับหมวด และลิงก์ที่พาไปถูกที่

vi.mock('@/lib/csmju/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), list: vi.fn(), post: vi.fn() },
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

const hit = (kind: string, id: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  kind,
  id,
  title: `${kind} ${id}`,
  snippet: null,
  authorCoreUserId: null,
  channelId: null,
  createdAt: null,
  ...extra,
});

function renderResults(result: SearchResult, kind: 'all' | 'people' = 'all') {
  const onKind = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ExploreResults result={result} kind={kind} onKind={onKind} />
    </QueryClientProvider>,
  );

  return { onKind };
}

describe('ผลค้นหา', () => {
  it('**คนขึ้นก่อน** แล้วตามด้วยกระทู้ คลิป ข้อความ — ไม่ว่าหลังบ้านส่งมาลำดับไหน', () => {
    renderResults({
      counts: { reels: 1, posts: 1, people: 1, messages: 1 },
      total: 4,
      hits: [
        hit('REEL', 'r1'),
        hit('MESSAGE', 'm1', { channelId: 'ch-1' }),
        hit('POST', 'p1'),
        hit('PERSON', 'user-009', { title: 'สมชาย', snippet: 'user-009' }),
      ],
    });

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);

    expect(headings).toEqual(['คน1', 'กระทู้1', 'คลิป1', 'ข้อความแชท1']);
  });

  it('แถวคนพาไปโปรไฟล์ · ข้อความพาไปห้องที่ถูกต้อง', () => {
    renderResults({
      counts: { reels: 0, posts: 0, people: 1, messages: 1 },
      total: 2,
      hits: [
        hit('PERSON', 'user-009', { title: 'สมชาย', snippet: 'user-009' }),
        hit('MESSAGE', 'm1', { channelId: 'ch-1', snippet: 'ส่งการบ้าน pointer' }),
      ],
    });

    expect(screen.getByRole('link', { name: /สมชาย/ })).toHaveAttribute('href', '/profile/user-009');
    expect(screen.getByRole('link', { name: /ส่งการบ้าน pointer/ })).toHaveAttribute(
      'href',
      '/chat?channel=ch-1',
    );
  });

  it('โหมดทั้งหมดมีตัวอย่างไม่ครบ → "ดูทั้งหมด" สลับไปหมวดนั้น', async () => {
    const user = userEvent.setup();
    const { onKind } = renderResults({
      counts: { reels: 0, posts: 12, people: 0, messages: 0 },
      total: 1,
      hits: [hit('POST', 'p1')],
    });

    const section = screen.getByRole('region', { name: /กระทู้/ });

    await user.click(within(section).getByRole('button', { name: 'ดูทั้งหมด' }));

    expect(onKind).toHaveBeenCalledWith('posts');
  });

  it('ไม่มีผลเลย → บอกตรง ๆ', () => {
    renderResults({ counts: { reels: 0, posts: 0, people: 0, messages: 0 }, total: 0, hits: [] });

    expect(screen.getByText('ไม่พบผลลัพธ์')).toBeInTheDocument();
  });
});
