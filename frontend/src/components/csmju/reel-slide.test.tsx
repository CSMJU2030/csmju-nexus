import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reel } from '@/lib/csmju/types';
import { ReelSlide, type ReelSlideProps } from './reel-slide';

/// เทสต์คลิปหนึ่งจอแบบ Instagram Reels
///
/// สิ่งที่ต้องไม่พัง: เล่นเฉพาะคลิปที่เห็น, ขอลิงก์วิดีโอเฉพาะตอนสั่ง (ลิงก์มีอายุ
/// สองนาที), ไม่มีปุ่มรีโพสต์ปลอม, ปุ่มลบมีเฉพาะคนที่หลังบ้านยอมให้ลบ
/// และปุ่มติดตามไม่โผล่ให้ตัวเองหรือคนที่ติดตามอยู่แล้ว

const apiGet = vi.hoisted(() => vi.fn());
const apiList = vi.hoisted(() => vi.fn());
const assetUrl = vi.hoisted(() => vi.fn());
const me = vi.hoisted(() => ({
  current: { id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' },
}));

vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, list: apiList, post: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/csmju/asset-url', () => ({ assetUrl }));
vi.mock('@/lib/csmju/session', () => ({ useMe: () => me.current }));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
  UserName: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
  useProfile: (coreUserId: string) => ({
    coreUserId,
    displayName: `ชื่อ ${coreUserId}`,
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

beforeEach(() => {
  apiGet.mockReset();
  apiList.mockReset();
  assetUrl.mockReset();
  play.mockClear();
  pause.mockClear();
  me.current = { ...me.current, id: 'user-002', coreRole: 'student' };
  assetUrl.mockResolvedValue('http://files.local/clip.mp4?sig=1');
  apiList.mockResolvedValue({ items: [], meta: { total: 7, page: 1, limit: 1, totalPages: 7 } });
  apiGet.mockResolvedValue({ relation: { following: false, followedBy: false, mutual: false } });
  // jsdom ไม่มีเครื่องเล่นวิดีโอจริง
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
});

const reel: Reel = {
  id: 'reel-1',
  title: 'สรุป Data Structures',
  caption: 'Stack กับ Queue',
  assetId: 'asset-1',
  durationMs: 10_000,
  authorCoreUserId: 'user-003',
  likeCount: 1234,
  viewCount: 50,
  likedByMe: false,
  commentCount: 7,
  createdAt: '2026-09-29T01:00:00+07:00',
};

function renderSlide(overrides: Partial<ReelSlideProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: ReelSlideProps = {
    reel,
    active: true,
    load: true,
    mount: true,
    muted: true,
    onToggleMute: vi.fn(),
    saved: false,
    onLike: vi.fn(),
    onSave: vi.fn(),
    commentsOpen: false,
    onToggleComments: vi.fn(),
    onCommentCountChange: vi.fn(),
    onRepost: vi.fn(),
    canDelete: false,
    onDelete: vi.fn().mockResolvedValue(undefined),
    onViewed: vi.fn(),
    ...overrides,
  };

  const view = render(
    <QueryClientProvider client={client}>
      <ReelSlide {...props} />
    </QueryClientProvider>,
  );

  return { ...view, props, client };
}

function video(container: HTMLElement) {
  return container.querySelector('video') as HTMLVideoElement;
}

describe('แถบปุ่มข้างวิดีโอ', () => {
  it('มีถูกใจ ความคิดเห็น แชร์ บันทึก ตัวเลือก · ตัวเลขแบบไทยของ IG', async () => {
    renderSlide();

    for (const name of ['ถูกใจ', 'แชร์', 'บันทึก', 'ตัวเลือกเพิ่มเติม']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('1.2 พัน')).toBeInTheDocument();
  });

  it('**ปุ่มรีโพสต์โผล่เฉพาะเมื่อหลังบ้านส่ง repostCount** — ไม่มีปุ่มหลอก', async () => {
    const user = userEvent.setup();
    const first = renderSlide();

    expect(screen.queryByRole('button', { name: /รีโพสต์/ })).not.toBeInTheDocument();
    first.unmount();

    const { props } = renderSlide({ reel: { ...reel, repostCount: 11_000, repostedByMe: true } });
    const button = screen.getByRole('button', { name: 'เลิกรีโพสต์' });

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1.1 หมื่น')).toBeInTheDocument();
    await user.click(button);
    expect(props.onRepost).toHaveBeenCalledOnce();
  });

  it('แชร์ = เปิดแผ่นแชร์ (ไม่ใช่แค่คัดลอกลิงก์)', async () => {
    const user = userEvent.setup();
    renderSlide();

    await user.click(screen.getByRole('button', { name: 'แชร์' }));

    expect(await screen.findByRole('dialog', { name: 'แชร์' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'คัดลอกลิงก์' })).toBeInTheDocument();
  });

  it('**ยอดคอมเมนต์ใต้ไอคอนมาจาก commentCount ของคลิป** — ไม่ยิง /comments มานับเอง', () => {
    renderSlide();

    expect(screen.getByRole('button', { name: 'ความคิดเห็น (7 รายการ)' })).toBeInTheDocument();
    expect(apiList).not.toHaveBeenCalled();
  });

  it('ถูกใจแล้ว = หัวใจแดงทึบ และบอกสถานะด้วย aria-pressed', () => {
    const { container } = renderSlide({ reel: { ...reel, likedByMe: true } });

    const button = screen.getByRole('button', { name: 'เลิกถูกใจ' });

    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.text-badge.fill-current')).not.toBeNull();
  });

  it('กดปุ่มแล้วเรียกฟังก์ชันของหน้าแม่', async () => {
    const user = userEvent.setup();
    const { props } = renderSlide();

    await user.click(screen.getByRole('button', { name: 'ถูกใจ' }));
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await user.click(screen.getByRole('button', { name: 'เปิดเสียง' }));

    expect(props.onLike).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onToggleMute).toHaveBeenCalledOnce();
  });
});

describe('การเล่นวิดีโอ', () => {
  it('**ไม่ขอลิงก์วิดีโอจนกว่าจะสั่ง load** — ลิงก์อายุสองนาที ขอล่วงหน้าทั้งฟีดจะหมดอายุ', async () => {
    const { container } = renderSlide({ active: false, load: false });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(assetUrl).not.toHaveBeenCalled();
    expect(video(container)).not.toHaveAttribute('src');
  });

  it('คลิปที่เห็นอยู่ได้ src และสั่งเล่นเอง แบบเงียบ + preload=metadata', async () => {
    const { container } = renderSlide();

    await waitFor(() =>
      expect(video(container)).toHaveAttribute('src', 'http://files.local/clip.mp4?sig=1'),
    );
    expect(video(container)).toHaveAttribute('preload', 'metadata');
    expect(video(container).muted).toBe(true);
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('คลิปที่ไม่ได้เห็น (แต่โหลดรอไว้) ถูกสั่งหยุด ไม่เล่นซ้อนกัน', async () => {
    const { container } = renderSlide({ active: false });

    await waitFor(() => expect(video(container)).toHaveAttribute('src'));
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it('แตะวิดีโอ = หยุด และขึ้นไอคอนเล่นกลางจอ', async () => {
    const user = userEvent.setup();
    const { container } = renderSlide();

    await waitFor(() => expect(video(container)).toHaveAttribute('src'));
    Object.defineProperty(video(container), 'paused', { configurable: true, value: false });
    pause.mockClear();

    await user.click(video(container));

    expect(pause).toHaveBeenCalled();
    expect(container.querySelector('.lucide-play')).not.toBeNull();
  });

  it('เล่นขึ้นจริงแล้วแจ้งหน้าแม่ให้นับยอดดู', async () => {
    const { container, props } = renderSlide();

    await waitFor(() => expect(video(container)).toHaveAttribute('src'));
    act(() => {
      video(container).dispatchEvent(new Event('playing'));
    });

    expect(props.onViewed).toHaveBeenCalledOnce();
  });
});

describe('เจ้าของคลิปและการติดตาม', () => {
  it('ยังไม่ได้ติดตามเจ้าของคลิป → มีปุ่มติดตามบนวิดีโอ', async () => {
    renderSlide();

    expect(await screen.findByRole('button', { name: 'ติดตาม' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/profiles/user-003');
  });

  it('**ติดตามอยู่แล้ว → ไม่มีปุ่ม**', async () => {
    apiGet.mockResolvedValue({ relation: { following: true, followedBy: false, mutual: false } });
    renderSlide();

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/profiles/user-003'));
    expect(screen.queryByRole('button', { name: 'ติดตาม' })).not.toBeInTheDocument();
  });

  it('**คลิปของตัวเอง → ไม่มีปุ่ม และไม่ถามหลังบ้านเลย**', async () => {
    renderSlide({ reel: { ...reel, authorCoreUserId: 'user-002' } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.queryByRole('button', { name: 'ติดตาม' })).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith('/profiles/user-002');
  });
});

describe('เมนู …', () => {
  it('ลบไม่ได้ → ไม่มีปุ่มลบในเมนู', async () => {
    const user = userEvent.setup();
    renderSlide({ canDelete: false });

    await user.click(screen.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }));

    expect(screen.getByRole('button', { name: 'คัดลอกลิงก์' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ลบ' })).not.toBeInTheDocument();
  });

  it('**ลบต้องกดสองครั้ง** — ครั้งแรกขอยืนยัน ครั้งที่สองถึงลบจริง', async () => {
    const user = userEvent.setup();
    const { props } = renderSlide({ canDelete: true });

    await user.click(screen.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }));
    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(props.onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /ยืนยันลบคลิป/ }));

    expect(props.onDelete).toHaveBeenCalledOnce();
  });
});
