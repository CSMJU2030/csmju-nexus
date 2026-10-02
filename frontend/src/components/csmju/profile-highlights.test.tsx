import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryArchiveItem } from '@/lib/csmju/types';
import { HighlightsRow } from './profile-highlights';

/// เทสต์แถวไฮไลต์และขั้นตอนสร้างไฮไลต์ (ตั้งชื่อ → เลือกสตอรี่ → เลือกหน้าปก)

const apiGet = vi.hoisted(() => vi.fn());
const apiList = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, list: apiList, post: apiPost, patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: coreUserId }),
}));

const story = (id: string, createdAt: string): StoryArchiveItem => ({
  id,
  assetId: `a-${id}`,
  mediaKind: 'IMAGE',
  mediaUrl: `https://files.test/${id}.png`,
  caption: null,
  viewCount: 0,
  isExpired: true,
  createdAt,
  expiresAt: createdAt,
});

function renderRow(isMe: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <HighlightsRow coreUserId="user-002" isMe={isMe} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiList.mockReset();
  apiPost.mockReset();
});

describe('แถวไฮไลต์', () => {
  it('โปรไฟล์คนอื่นที่ไม่มีไฮไลต์ ไม่แสดงแถวเลย', async () => {
    apiGet.mockResolvedValue([]);

    const { container } = renderRow(false);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/profiles/user-002/highlights'));
    expect(container).toBeEmptyDOMElement();
  });

  it('แสดงปกและชื่อไฮไลต์จริง · ของคนอื่นไม่มีวง "ใหม่"', async () => {
    apiGet.mockResolvedValue([
      {
        id: 'h1',
        ownerCoreUserId: 'user-002',
        title: 'เที่ยวทะเล',
        coverStoryId: null,
        coverMediaUrl: 'https://files.test/c.png',
        coverMediaKind: 'IMAGE',
        itemCount: 3,
        createdAt: '',
        updatedAt: '',
      },
    ]);

    renderRow(false);

    expect(await screen.findByRole('button', { name: 'ดูไฮไลต์ เที่ยวทะเล (3 สตอรี่)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'สร้างไฮไลต์ใหม่' })).not.toBeInTheDocument();
  });

  it('สร้างไฮไลต์: ชื่อ → เลือกสตอรี่ → หน้าปก → เสร็จ · ส่งเรียงจากเก่าไปใหม่', async () => {
    apiGet.mockResolvedValue([]);
    apiList.mockResolvedValue({
      items: [story('new', '2026-09-30T10:00:00Z'), story('mid', '2026-09-29T10:00:00Z'), story('old', '2026-09-28T10:00:00Z')],
      meta: { page: 1, limit: 30, total: 3, totalPages: 1 },
    });
    apiPost.mockResolvedValue({ id: 'h9', items: [] });

    renderRow(true);

    await userEvent.click(await screen.findByRole('button', { name: 'สร้างไฮไลต์ใหม่' }));

    const next = screen.getByRole('button', { name: 'ถัดไป' });

    expect(next).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('ชื่อไฮไลท์'), 'ติวสอบ');
    await userEvent.click(next);

    // คลังสตอรี่จริงจาก /stories/archive
    expect(apiList).toHaveBeenCalledWith('/stories/archive?page=1&limit=30');

    const tiles = await screen.findAllByRole('button', { name: /^เลือกสตอรี่วันที่/ });

    await userEvent.click(tiles[0]); // new
    await userEvent.click(tiles[2]); // old
    expect(tiles[0]).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));

    // หน้าปกเริ่มที่ชิ้นแรกตามลำดับเล่น (เก่าสุด) · เลือกชิ้นใหม่แทน
    const covers = screen.getAllByRole('button', { name: /เป็นหน้าปก$/ });

    expect(covers[0]).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(covers[1]);
    await userEvent.click(screen.getByRole('button', { name: 'เสร็จ' }));

    expect(apiPost).toHaveBeenCalledWith('/highlights', {
      title: 'ติวสอบ',
      storyIds: ['old', 'new'],
      coverStoryId: 'new',
    });
  });
});
