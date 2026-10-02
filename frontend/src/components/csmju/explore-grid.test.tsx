import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reel } from '@/lib/csmju/types';
import { ExploreGrid, ExploreTile } from './explore-grid';

/// เทสต์ช่องในกริดสำรวจ
///
/// กริดมีหลายสิบช่อง ลิงก์วิดีโออายุสองนาที — **ขอลิงก์เฉพาะช่องที่ใกล้จอ**
/// และกดแล้วต้องพาไปดูคลิปนั้นในหน้าคลิปสั้น (?reel=<id>) ไม่ใช่หน้ารวม

const assetUrl = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { get: vi.fn(), list: vi.fn().mockResolvedValue({ items: [], meta: { total: 3 } }) },
}));
vi.mock('@/lib/csmju/asset-url', () => ({ assetUrl }));

/// IntersectionObserver ปลอม — เทสต์เลือกเองว่าช่องไหน "เข้าใกล้จอ" เมื่อไร
const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = [];

class FakeObserver {
  targets: Element[] = [];

  constructor(public callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function enterViewport() {
  for (const observer of observers) {
    observer.callback(
      observer.targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
      observer as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  observers.length = 0;
  assetUrl.mockReset();
  assetUrl.mockResolvedValue('http://files.local/a.mp4?sig=1');
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reel: Reel = {
  id: 'reel-9',
  title: 'บรรยากาศแล็บ',
  caption: null,
  assetId: 'asset-9',
  durationMs: 8000,
  authorCoreUserId: 'user-003',
  likeCount: 12,
  viewCount: 1500,
  likedByMe: false,
  commentCount: 0,
  createdAt: '2026-09-29T01:00:00+07:00',
};

function renderTile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ExploreGrid>
        <ExploreTile reel={reel} />
      </ExploreGrid>
    </QueryClientProvider>,
  );
}

describe('ช่องคลิปในกริดสำรวจ', () => {
  it('กดแล้วไปดูคลิปนั้นในหน้าคลิปสั้น', () => {
    renderTile();

    expect(screen.getByRole('link', { name: 'คลิป บรรยากาศแล็บ' })).toHaveAttribute(
      'href',
      '/reels?reel=reel-9',
    );
  });

  it('**ยังไม่ใกล้จอ = ยังไม่ขอลิงก์วิดีโอ**', async () => {
    const { container } = renderTile();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(assetUrl).not.toHaveBeenCalled();
    expect(container.querySelector('video')).toBeNull();
  });

  it('ใกล้จอแล้ว → วิดีโอเฟรมแรก (#t=0.1) แบบเงียบ โหลดแค่ metadata', async () => {
    const { container } = renderTile();

    act(() => enterViewport());

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull());

    const video = container.querySelector('video') as HTMLVideoElement;

    expect(assetUrl).toHaveBeenCalledWith('asset-9');
    expect(video.getAttribute('src')).toBe('http://files.local/a.mp4?sig=1#t=0.1');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video.muted).toBe(true);
  });

  it('ชี้เมาส์แล้วเห็นยอดถูกใจและยอดดูจริง (แบบย่อ)', () => {
    renderTile();

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1.5 พัน')).toBeInTheDocument();
  });
});
