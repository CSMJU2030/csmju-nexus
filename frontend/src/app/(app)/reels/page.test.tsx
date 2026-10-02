import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reel } from '@/lib/csmju/types';
import ReelsPage from './page';

/// เทสต์หน้าคลิปสั้นระดับหน้า — สิ่งที่คลิปแต่ละช่องทำเองไม่ได้
///
///   - ยอดดูยิงครั้งเดียวต่อคลิปต่อรอบการโหลด (หลังบ้านนับคน ไม่ใช่ครั้ง)
///   - ลิงก์ ?reel=<id> ที่ชี้คลิปนอกฟีดล่าสุดยังเปิดได้
///   - ปุ่มลงคลิปมีตัวเดียว (มาด้วย ?create=1 ต้องไม่เปิดกล่องซ้อนสองใบ)

const apiList = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock('next/navigation', () => ({ useSearchParams: () => params.current }));
vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, get: apiGet, post: apiPost, del: vi.fn() },
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
vi.mock('@/components/csmju/reel-uploader', () => ({
  ReelUploader: ({ defaultOpen }: { defaultOpen?: boolean }) => (
    <button type="button" data-default-open={String(Boolean(defaultOpen))}>
      ลงคลิป
    </button>
  ),
}));
// ช่องคลิปมีเทสต์ของตัวเอง — ที่นี่แทนด้วยปุ่มที่เรียก callback ของหน้าแม่ตรง ๆ
vi.mock('@/components/csmju/reel-slide', () => ({
  ReelSlide: (props: {
    reel: Reel;
    active: boolean;
    load: boolean;
    onViewed: () => void;
  }) => (
    <div data-testid={`slide-${props.reel.id}`} data-active={props.active} data-load={props.load}>
      <button type="button" onClick={props.onViewed}>
        เล่น {props.reel.id}
      </button>
    </div>
  ),
}));

const reel = (id: string): Reel => ({
  id,
  title: `คลิป ${id}`,
  caption: null,
  assetId: `asset-${id}`,
  durationMs: 10_000,
  authorCoreUserId: 'user-003',
  likeCount: 0,
  viewCount: 0,
  likedByMe: false,
  commentCount: 0,
  createdAt: '2026-09-29T01:00:00+07:00',
});

function page(items: Reel[]) {
  return { items, meta: { total: items.length, page: 1, limit: 20, totalPages: items.length ? 1 : 0 } };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ReelsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // jsdom ไม่มี Element.scrollTo — หน้าใช้เลื่อนไปคลิปจากลิงก์และตอนสลับแท็บ
  Element.prototype.scrollTo = vi.fn();
  params.current = new URLSearchParams();
  apiList.mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  apiList.mockImplementation(async (path: string) =>
    path.startsWith('/bookmarks') ? page([]) : page([reel('a'), reel('b'), reel('c')]),
  );
  apiPost.mockResolvedValue({ viewCount: 1 });
});

describe('หน้าคลิปสั้น', () => {
  it('**ยอดดูยิงครั้งเดียวต่อคลิปต่อรอบการโหลด** แม้คลิปเล่นวนหลายรอบ', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'เล่น a' }));
    await user.click(screen.getByRole('button', { name: 'เล่น a' }));
    await user.click(screen.getByRole('button', { name: 'เล่น b' }));

    const views = apiPost.mock.calls.filter(([path]) => String(path).endsWith('/views'));

    expect(views.map(([path]) => path)).toEqual(['/reels/a/views', '/reels/b/views']);
  });

  it('คลิปแรกเล่น · ขอลิงก์เฉพาะคลิปที่เห็นกับคลิปถัดไป', async () => {
    renderPage();

    const first = await screen.findByTestId('slide-a');

    expect(first).toHaveAttribute('data-active', 'true');
    expect(first).toHaveAttribute('data-load', 'true');
    expect(screen.getByTestId('slide-b')).toHaveAttribute('data-load', 'true');
    expect(screen.getByTestId('slide-c')).toHaveAttribute('data-load', 'false');
  });

  it('**?reel=<id> ที่ไม่อยู่ในฟีดล่าสุด → ถามตัวคลิปแล้ววางไว้บนสุด** และเป็นคลิปที่เล่น', async () => {
    params.current = new URLSearchParams('reel=zzz');
    apiGet.mockResolvedValue(reel('zzz'));
    renderPage();

    const slide = await screen.findByTestId('slide-zzz');

    expect(apiGet).toHaveBeenCalledWith('/reels/zzz');
    expect(slide).toHaveAttribute('data-active', 'true');
    expect(screen.getAllByTestId(/^slide-/)[0]).toBe(slide);
  });

  it('ลูกศรลงเลื่อนไปคลิปถัดไป — **แต่ไม่ขโมยปุ่มตอนพิมพ์**', async () => {
    const { container } = renderPage();

    await screen.findByTestId('slide-a');

    const scroller = container.querySelector('.snap-y') as HTMLDivElement;
    const scrollTo = vi.fn();

    scroller.scrollTo = scrollTo;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 900 });

    fireEvent.keyDown(document.body, { key: 'ArrowDown' });

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'smooth' });

    scrollTo.mockClear();

    const input = document.createElement('input');

    document.body.append(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    input.remove();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('ยังไม่มีคลิป → ไอคอน + "ยังไม่มีคลิป" + ปุ่มลงคลิป **ตัวเดียว** ที่รับ ?create=1', async () => {
    params.current = new URLSearchParams('create=1');
    apiList.mockResolvedValue(page([]));
    renderPage();

    expect(await screen.findByText('ยังไม่มีคลิป')).toBeInTheDocument();

    const uploaders = screen.getAllByRole('button', { name: 'ลงคลิป' });

    expect(uploaders).toHaveLength(1);
    expect(uploaders[0]).toHaveAttribute('data-default-open', 'true');
  });

  it('สลับไปแท็บ "คนที่ติดตาม" ขอฟีด feed=following', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('slide-a');
    await user.click(screen.getByRole('button', { name: 'คนที่ติดตาม' }));

    await waitFor(() =>
      expect(apiList).toHaveBeenCalledWith(expect.stringContaining('feed=following')),
    );
    await act(async () => {});
  });
});
