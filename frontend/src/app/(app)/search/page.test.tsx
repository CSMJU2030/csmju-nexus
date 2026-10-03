import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_KEY } from '@/components/csmju/explore-recents';
import SearchPage from './page';

/// เทสต์หน้าค้นหาระดับหน้า — "ล่าสุด" โผล่ตอนแตะช่องว่าง และผลที่กดจริงถูกจำไว้

const apiGet = vi.hoisted(() => vi.fn());
const apiList = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, list: apiList, post: vi.fn() },
  ApiError: class extends Error {},
  qs: (values: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) search.set(key, String(value));
    }

    return search.size ? `?${search}` : '';
  },
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: coreUserId }),
}));

beforeEach(() => {
  window.localStorage.clear();
  apiList.mockReset();
  apiGet.mockReset();
  apiList.mockResolvedValue({ items: [], meta: { total: 0, page: 1, limit: 24, totalPages: 0 } });
  apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/search')) {
      return {
        query: 'staff',
        counts: { reels: 0, posts: 0, people: 1, messages: 0 },
        hits: [
          {
            kind: 'PERSON',
            id: 'user-003',
            title: 'staff',
            snippet: 'user-003',
            authorCoreUserId: 'user-003',
            channelId: null,
            createdAt: null,
          },
        ],
      };
    }

    // ปุ่มติดตามถามความสัมพันธ์ — ติดตามอยู่แล้ว ไม่ต้องมีปุ่ม
    return { relation: { following: true, followedBy: false, mutual: false } };
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

describe('หน้าค้นหา', () => {
  it('แตะช่องค้นหาที่ว่าง → "ล่าสุด" แทนกริด · แตะข้างนอก → กลับกริด', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('heading', { name: 'ล่าสุด' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('textbox', { name: 'ค้นหา' }));

    expect(screen.getByRole('heading', { name: 'ล่าสุด' })).toBeInTheDocument();
    expect(screen.getByText('ไม่มีการค้นหาล่าสุด')).toBeInTheDocument();

    await user.click(screen.getByText('© 2026 CS Nexus · CSMJU2030 มหาวิทยาลัยแม่โจ้'));

    expect(screen.queryByRole('heading', { name: 'ล่าสุด' })).not.toBeInTheDocument();
  });

  it('**กดผลลัพธ์คนจริง → จำไว้ใน "ล่าสุด" ของบัญชีนี้**', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole('textbox', { name: 'ค้นหา' }), 'staff');

    const link = await screen.findByRole('link', { name: /staff/ }, { timeout: 2000 });

    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '{}')['user-002']).toEqual([
        { kind: 'person', id: 'user-003', title: 'staff', subtitle: 'user-003' },
      ]),
    );
  });

  it('Enter = จำคำค้นไว้ด้วย', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole('textbox', { name: 'ค้นหา' }), '#CSMJU{Enter}');

    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '{}')['user-002']).toEqual([
      { kind: 'hashtag', id: '#CSMJU' },
    ]);
  });

  it('มีท้ายหน้าแบบ Instagram', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'API' })).toBeInTheDocument();
  });
});
