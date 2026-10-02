import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post, Reel } from '@/lib/csmju/types';
import { mergeTiles, ProfileGrid } from './profile-grid';

/// เทสต์ตารางผลงานบนหน้าโปรไฟล์
///
/// สิ่งที่ต้องไม่พัง: ลำดับเวลาของตารางรวม (สองแหล่งแบ่งหน้าแยกกัน), ลิงก์คลิป
/// ที่ส่ง ?reel= ให้หน้าคลิปเปิดตัวที่กด, และแท็บ "บันทึกไว้" ต้องไม่โผล่บน
/// โปรไฟล์คนอื่น — ที่คั่นหน้าเป็นข้อมูลส่วนตัว

const apiList = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, get: apiGet },
  ApiError: class extends Error {
    status = 0;
  },
  qs: (params: Record<string, string | number | undefined>) =>
    '?' +
    Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('&'),
}));

// ขอลิงก์ไฟล์จริงไม่ใช่สิ่งที่เทสต์นี้ตรวจ — มีเทสต์ของมันเองแยกไว้
vi.mock('@/lib/csmju/asset-url', () => ({
  useAssetUrl: (assetId: string | null) => ({
    url: assetId ? `https://files.test/${assetId}` : null,
    error: null,
  }),
}));

const post = (id: string, createdAt: string): Post => ({
  id,
  title: `กระทู้ ${id}`,
  content: 'เนื้อหา',
  courseTag: 'CS201',
  authorCoreUserId: 'user-003',
  commentCount: 2,
  reactions: null,
  createdAt,
});

const reel = (id: string, createdAt: string): Reel => ({
  id,
  title: `คลิป ${id}`,
  caption: null,
  assetId: `asset-${id}`,
  durationMs: 10_000,
  authorCoreUserId: 'user-003',
  likeCount: 4,
  viewCount: 9,
  likedByMe: false,
  commentCount: 0,
  createdAt,
});

const page = <T,>(items: T[], more = false) => ({
  items,
  meta: { page: 1, limit: 24, total: items.length, totalPages: more ? 2 : 1 },
});

function renderGrid(isMe: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ProfileGrid coreUserId="user-003" isMe={isMe} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiList.mockReset();
  apiGet.mockReset();
});

describe('mergeTiles', () => {
  it('เรียงกระทู้กับคลิปรวมกันจากใหม่ไปเก่า', () => {
    const tiles = mergeTiles(
      [post('p1', '2026-09-03'), post('p2', '2026-09-01')],
      [reel('r1', '2026-09-02')],
      { posts: false, reels: false },
    );

    expect(tiles.map((tile) => tile.createdAt)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
  });

  it('**ยังไม่แสดงของที่เก่ากว่าชิ้นสุดท้ายของแหล่งที่ยังมีหน้าถัดไป** — ไม่ให้ตารางกระโดด', () => {
    // คลิปยังมีหน้าถัดไป และชิ้นสุดท้ายที่โหลดมาคือ 09-05
    // กระทู้ 09-01 อาจมีคลิปที่ใหม่กว่ามันรออยู่ในหน้าถัดไป จึงต้องรอก่อน
    const tiles = mergeTiles(
      [post('p1', '2026-09-06'), post('p2', '2026-09-01')],
      [reel('r1', '2026-09-07'), reel('r2', '2026-09-05')],
      { posts: false, reels: true },
    );

    expect(tiles.map((tile) => tile.createdAt)).toEqual(['2026-09-07', '2026-09-06', '2026-09-05']);
  });
});

describe('ตารางผลงาน', () => {
  it('โปรไฟล์คนอื่นไม่มีแท็บ "บันทึกไว้"', async () => {
    apiList.mockResolvedValue(page([]));

    renderGrid(false);

    expect(screen.getByRole('tab', { name: 'โพสต์' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'คลิป' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'บันทึกไว้' })).not.toBeInTheDocument();
    expect(await screen.findByText('ยังไม่มีโพสต์')).toBeInTheDocument();
  });

  it('แท็บโพสต์ดึงของเจ้าของโปรไฟล์คนนี้ และลิงก์คลิปส่ง ?reel= ไปหน้าคลิป', async () => {
    apiList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/posts') ? page([post('p1', '2026-09-01')]) : page([reel('r1', '2026-09-02')]),
      ),
    );

    renderGrid(false);

    const clip = await screen.findByRole('link', { name: /คลิป คลิป r1/ });

    expect(clip).toHaveAttribute('href', '/reels?reel=r1');
    expect(screen.getByRole('link', { name: /กระทู้ กระทู้ p1/ })).toHaveAttribute('href', '/feed');
    expect(apiList).toHaveBeenCalledWith(expect.stringContaining('/posts?authorCoreUserId=user-003'));
    expect(apiList).toHaveBeenCalledWith(expect.stringContaining('/reels?authorCoreUserId=user-003'));

    // เฟรมแรกของคลิปเป็นรูปปก — โหลดแค่หัวไฟล์ ไม่ใช่ทั้งคลิป
    const video = clip.querySelector('video');

    expect(video).toHaveAttribute('src', 'https://files.test/asset-r1#t=0.1');
    expect(video).toHaveAttribute('preload', 'metadata');
  });

  it('แท็บรีโพสต์มีทุกโปรไฟล์ อ่าน /profiles/:id/reposts และมีสถานะว่างแบบ Instagram', async () => {
    apiList.mockImplementation((path: string) =>
      Promise.resolve(path.includes('/reposts') ? page([reel('r7', '2026-09-20')]) : page([])),
    );

    renderGrid(false);

    await userEvent.click(screen.getByRole('tab', { name: 'รีโพสต์' }));

    expect(await screen.findByRole('link', { name: /คลิป คลิป r7/ })).toHaveAttribute('href', '/reels?reel=r7');
    expect(apiList).toHaveBeenCalledWith(expect.stringMatching(/^\/profiles\/user-003\/reposts\?/));
  });

  it('แท็บบันทึกไว้ของตัวเองเป็นการ์ด "โพสต์ทั้งหมด" + คอลเลกชันจริงจากหลังบ้าน', async () => {
    apiList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/bookmark-collections')
          ? page([{ id: 'c1', name: 'ติวสอบ', itemCount: 3, cover: null, createdAt: '', updatedAt: '' }])
          : path.startsWith('/bookmarks')
            ? page([
                { targetKind: 'POST', targetId: 'p9', title: 'กระทู้ที่เก็บไว้', authorCoreUserId: 'x', createdAt: '' },
                { targetKind: 'REEL', targetId: 'r9', title: null, authorCoreUserId: null, createdAt: '' },
              ])
            : page([]),
      ),
    );

    renderGrid(true);

    await userEvent.click(screen.getByRole('tab', { name: 'บันทึกไว้' }));

    expect(await screen.findByRole('link', { name: 'โพสต์ทั้งหมด · 2 รายการ' })).toHaveAttribute('href', '/saved/all');
    expect(screen.getByRole('link', { name: 'ติวสอบ · 3 รายการ' })).toHaveAttribute('href', '/saved/c1');
    // ภาพปก 2×2 ใช้ของจริง — กระทู้แสดงหัวข้อ ส่วนคลิปที่ถูกลบไปแล้วไม่ต้องถามหาเฟรมปก
    expect(screen.getByText('กระทู้ที่เก็บไว้')).toBeInTheDocument();
    await waitFor(() => expect(apiGet).not.toHaveBeenCalledWith('/reels/r9'));
  });
});
