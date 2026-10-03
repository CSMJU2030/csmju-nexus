import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HighlightSummary } from '@/lib/csmju/types';
import { ActivityShell } from './activity-shell';
import { DEFAULT_FILTERS, filterParams } from './activity-toolbar';
import {
  AccountHistory,
  filterHighlights,
  InteractionsComments,
  InteractionsLikes,
  InteractionsReposts,
  InteractionsStoryReplies,
  mergeByTime,
} from './activity-views';

/// เทสต์หน้า "กิจกรรมของคุณ" แบบ Instagram
///
/// ทุกแถวมาจาก /activity/* จริง · ตัวกรองส่งเป็นพารามิเตอร์ให้หลังบ้าน ·
/// ลบถาวรต้องถามก่อน · ไม่มีแท็บหรือแถวประวัติที่ระบบนี้ไม่มีข้อมูลรองรับ

const apiList = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const apiDel = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: '/activity/interactions' }));

vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, get: apiGet, del: apiDel, post: vi.fn(), patch: vi.fn() },
  ApiError: class extends Error {},
  qs: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }

    const text = search.toString();

    return text ? `?${text}` : '';
  },
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/lib/csmju/asset-url', () => ({ useAssetUrl: () => ({ url: null, error: null }) }));
vi.mock('@/components/csmju/app-rail', () => ({ CORE_HOME: 'http://core.test' }));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: coreUserId }),
}));

const page = <T,>(items: T[], more = false) => ({
  items,
  meta: { page: 1, limit: 24, total: items.length, totalPages: more ? 2 : 1 },
});

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  apiList.mockReset();
  apiGet.mockReset();
  apiDel.mockReset();
  apiList.mockResolvedValue(page([]));
  pathname.current = '/activity/interactions';
});

describe('ตัวช่วย', () => {
  it('mergeByTime เรียงได้ทั้งสองทิศ และรอของที่อาจแทรกจากหน้าถัดไป', () => {
    const at = (x: { t: string }) => x.t;
    const a = { items: [{ t: '09' }, { t: '05' }], more: true };
    const b = { items: [{ t: '08' }, { t: '01' }], more: false };

    expect(mergeByTime([a, b], at, 'newest').map(at)).toEqual(['09', '08', '05']);

    const c = { items: [{ t: '01' }, { t: '05' }], more: true };
    const d = { items: [{ t: '02' }, { t: '09' }], more: false };

    expect(mergeByTime([c, d], at, 'oldest').map(at)).toEqual(['01', '02', '05']);
  });

  it('filterParams แมปเป็นพารามิเตอร์ของหลังบ้าน (newest/oldest · วันที่แบบ YYYY-MM-DD)', () => {
    // หลังบ้านตีความวันที่เป็น "ทั้งวันตามเวลากรุงเทพฯ" เอง — ต้องส่งวันที่ดิบ ไม่แปลงเป็น UTC
    expect(filterParams({ ...DEFAULT_FILTERS, order: 'oldest', from: '2026-09-01', to: '2026-09-30' })).toEqual({
      order: 'oldest',
      authorCoreUserId: undefined,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(filterParams({ ...DEFAULT_FILTERS, author: 'user-003' })).toMatchObject({
      order: 'newest',
      authorCoreUserId: 'user-003',
    });
  });

  it('ไฮไลต์เรียงและกรองวันที่ที่หน้าบ้าน (หลังบ้านคืนมาทั้งชุด) ตามวันของเวลาท้องถิ่น', () => {
    const row = (id: string, createdAt: string) => ({ id, createdAt }) as HighlightSummary;
    const rows = [row('a', '2026-09-01T05:00:00Z'), row('b', '2026-09-20T05:00:00Z'), row('c', '2026-08-01T05:00:00Z')];

    expect(filterHighlights(rows, { ...DEFAULT_FILTERS, from: '2026-09-01' }).map((r) => r.id)).toEqual(['b', 'a']);
    expect(
      filterHighlights(rows, { ...DEFAULT_FILTERS, order: 'oldest', to: '2026-09-01' }).map((r) => r.id),
    ).toEqual(['c', 'a']);
  });
});

describe('เปลือกหน้า', () => {
  it('มีสามหมวดพร้อมคำอธิบาย และส่วนท้ายลิงก์เฉพาะหน้าที่มีจริง', () => {
    renderWith(<ActivityShell>เนื้อหา</ActivityShell>);

    expect(screen.getByRole('heading', { name: 'กิจกรรมของคุณ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^การโต้ตอบ/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^รูปภาพและวิดีโอ/ })).toHaveAttribute('href', '/activity/media');
    expect(screen.getByRole('link', { name: /^ประวัติบัญชี/ })).toHaveAttribute('href', '/activity/account-history');

    const footer = screen.getByRole('contentinfo');

    for (const link of within(footer).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^(\/[a-z]+|http:\/\/core\.test)$/);
    }
    expect(footer).toHaveTextContent('© 2026 CS Nexus');
  });
});

describe('การโต้ตอบ', () => {
  it('การกดถูกใจรวมคลิปกับกระทู้ในตารางเดียว ตามเวลาที่กด', async () => {
    apiList.mockImplementation((path: string) => {
      if (path.includes('target=REEL')) {
        return Promise.resolve(
          page([
            {
              targetKind: 'REEL',
              id: 'r1',
              title: 'คลิปแมว',
              assetId: 'a1',
              authorCoreUserId: 'user-003',
              likedAt: '2026-09-29',
              thumbnailUrl: 'https://files.test/r1.mp4',
            },
          ]),
        );
      }

      if (path.includes('target=POST')) {
        return Promise.resolve(
          page([
            {
              targetKind: 'POST',
              id: 'p1',
              title: 'สรุป DS',
              preview: 'บทที่ 1',
              authorCoreUserId: 'user-003',
              emoji: '❤️',
              thumbnailUrl: null,
              reactedAt: '2026-09-30',
            },
          ]),
        );
      }

      return Promise.resolve(page([]));
    });

    renderWith(<InteractionsLikes />);

    const tiles = await screen.findAllByRole('link', { name: /^(คลิป|กระทู้) / });

    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual(['กระทู้ สรุป DS', 'คลิป คลิปแมว']);
    expect(apiList).toHaveBeenCalledWith(expect.stringMatching(/^\/activity\/likes\?order=newest.*target=REEL/));
    // ภาพย่อคลิปใช้ลิงก์วิดีโอที่มากับแถว ไม่ขอลิงก์แยกทีละช่อง
    expect(tiles[1].querySelector('video')).toHaveAttribute('src', 'https://files.test/r1.mp4#t=0.1');
    expect(screen.getByText('ใหม่สุดไปเก่าสุด')).toBeInTheDocument();
  });

  it('เลือกหลายชิ้นแล้ว "เลิกถูกใจ" คลิป → DELETE /reels/:id/likes', async () => {
    apiList.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('target=REEL')
          ? page([
              { targetKind: 'REEL', id: 'r1', title: 'คลิปแมว', assetId: 'a1', authorCoreUserId: 'x', likedAt: '2026-09-29', thumbnailUrl: null },
            ])
          : page([]),
      ),
    );
    apiDel.mockResolvedValue({});

    renderWith(<InteractionsLikes />);

    await userEvent.click(await screen.findByRole('button', { name: 'เลือก' }));
    await userEvent.click(screen.getByRole('button', { name: 'เลือก คลิป คลิปแมว' }));

    expect(screen.getByText('เลือกแล้ว 1 รายการ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'เลิกถูกใจ' }));

    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/reels/r1/likes'));
  });

  it('ความคิดเห็น: "คุณแสดงความคิดเห็นใน …" · ลบต้องยืนยันก่อน แล้วลบที่ path ของเป้าหมาย', async () => {
    apiList.mockResolvedValue(
      page([
        {
          id: 'c1',
          targetKind: 'POST',
          targetId: 'p1',
          targetTitle: 'ทดสอบระบบ',
          content: 'เยี่ยมมาก',
          createdAt: new Date().toISOString(),
        },
      ]),
    );
    apiDel.mockResolvedValue(undefined);

    renderWith(<InteractionsComments />);

    expect(await screen.findByText(/คุณแสดงความคิดเห็นใน/)).toHaveTextContent('คุณแสดงความคิดเห็นใน ทดสอบระบบ');
    expect(screen.getByText('เมื่อครู่')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'เลือก' }));
    await userEvent.click(screen.getByRole('button', { name: 'เลือกความคิดเห็น "เยี่ยมมาก"' }));
    await userEvent.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(apiDel).not.toHaveBeenCalled();
    const question = await screen.findByText('ลบความคิดเห็น 1 รายการใช่ไหม');
    const dialog = question.closest('dialog')!;

    await userEvent.click(within(dialog).getByRole('button', { name: 'ลบ' }));
    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/posts/p1/comments/c1'));
  });

  it('การตอบกลับสตอรี่: บอกว่าตอบสตอรี่ของใคร แสดงข้อความ/อิโมจิ และพาไปแชทนั้น', async () => {
    apiList.mockResolvedValue(
      page([
        {
          id: 'm1',
          channelId: 'dm-1',
          storyId: 's1',
          storyAuthorCoreUserId: 'user-003',
          kind: 'REACTION',
          emoji: '🔥',
          content: null,
          story: { kind: 'STORY', refId: 's1', available: false },
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    renderWith(<InteractionsStoryReplies />);

    const row = await screen.findByRole('link', { name: /คุณแสดงความรู้สึกต่อสตอรี่ของ user-003/ });

    expect(row).toHaveAttribute('href', '/messages?channel=dm-1');
    expect(row).toHaveTextContent('🔥');
    expect(apiList).toHaveBeenCalledWith(expect.stringMatching(/^\/activity\/story-replies\?order=newest/));
    // คำตอบสตอรี่เป็นข้อความในแชท — ลบจากที่นี่ไม่ได้
    expect(screen.queryByRole('button', { name: 'เลือก' })).not.toBeInTheDocument();
  });

  it('รีโพสต์: ตารางคลิปที่ฉันรีโพสต์ · เลือกแล้ว "เลิกรีโพสต์" → DELETE /reels/:id/reposts', async () => {
    apiList.mockResolvedValue(
      page([
        {
          targetKind: 'REEL',
          id: 'r5',
          title: 'คลิปเพื่อน',
          assetId: 'a5',
          authorCoreUserId: 'user-003',
          repostedAt: '2026-10-01',
          thumbnailUrl: 'https://files.test/r5.mp4',
        },
      ]),
    );
    apiDel.mockResolvedValue({ repostCount: 0, repostedByMe: false });

    renderWith(<InteractionsReposts />);

    expect(await screen.findByRole('link', { name: 'คลิป คลิปเพื่อน' })).toHaveAttribute('href', '/reels?reel=r5');
    expect(apiList).toHaveBeenCalledWith(expect.stringMatching(/^\/activity\/reposts\?order=newest/));

    await userEvent.click(screen.getByRole('button', { name: 'เลือก' }));
    await userEvent.click(screen.getByRole('button', { name: 'เลือก คลิป คลิปเพื่อน' }));
    await userEvent.click(screen.getByRole('button', { name: 'เลิกรีโพสต์' }));

    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/reels/r5/reposts'));
  });

  it('รายการว่างแสดงข้อความแบบ Instagram', async () => {
    renderWith(<InteractionsComments />);

    expect(await screen.findByText('ยังไม่มีความคิดเห็น')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เลือก' })).not.toBeInTheDocument();
  });
});

describe('ประวัติบัญชี', () => {
  it('แปลงแต่ละเหตุการณ์เป็นข้อความ และมีแถวบัญชีกลางต่อท้าย (ไม่มีแถวปลอม)', async () => {
    apiList.mockResolvedValue(
      page([
        { id: 'h1', kind: 'BIO_CHANGED', detail: 'ปี 3 สนใจ backend', createdAt: '2026-09-29T00:00:00Z' },
        { id: 'h2', kind: 'BIO_REMOVED', detail: null, createdAt: '2026-09-28T00:00:00Z' },
        { id: 'h4', kind: 'WEBSITE_CHANGED', detail: 'https://csmju.ac.th/', createdAt: '2026-09-29T00:00:00Z' },
        { id: 'h5', kind: 'WEBSITE_CHANGED', detail: null, createdAt: '2026-09-29T00:00:00Z' },
        { id: 'h3', kind: 'JOINED', detail: null, createdAt: '2026-09-30T00:00:00Z' },
      ]),
    );

    renderWith(<AccountHistory />);

    expect(await screen.findByText('ปี 3 สนใจ backend')).toBeInTheDocument();
    expect(screen.getByText(/คุณลบคำอธิบายตัวเองออกจากโปรไฟล์ของคุณ/)).toBeInTheDocument();
    expect(screen.getByText('30 กันยายน 2569')).toBeInTheDocument();
    expect(screen.getByText('https://csmju.ac.th/')).toBeInTheDocument();
    expect(screen.getByText(/คุณลบเว็บไซต์ออกจากโปรไฟล์ของคุณ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /รหัสผ่าน อีเมล และชื่อผู้ใช้/ })).toHaveAttribute('href', 'http://core.test');
    expect(apiList).toHaveBeenCalledWith('/activity/account-history?order=newest&page=1&limit=24');
    // ประวัติบัญชีเรียงได้อย่างเดียว ไม่มีโหมดเลือก
    expect(screen.queryByRole('button', { name: 'เลือก' })).not.toBeInTheDocument();
  });
});
