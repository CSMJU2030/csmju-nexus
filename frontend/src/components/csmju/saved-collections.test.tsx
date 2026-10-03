import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '@/lib/csmju/types';
import { AddToCollectionDialog, CollectionsGrid } from './saved-collections';

/// เทสต์คอลเลกชันของที่บันทึกไว้
///
/// ของที่ใส่คอลเลกชันได้ต้องบันทึกไว้ก่อน (หลังบ้านตอบ 400) — ตัวเลือกจึงมา
/// จาก /bookmarks เท่านั้น และไม่เสนอของที่ถูกลบไปแล้ว

const apiList = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, get: apiGet, post: apiPost, patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/csmju/asset-url', () => ({ useAssetUrl: () => ({ url: null, error: null }) }));

const saved: Bookmark[] = [
  { targetKind: 'POST', targetId: 'p1', title: 'สรุปบทที่ 1', authorCoreUserId: 'u', createdAt: '' },
  { targetKind: 'POST', targetId: 'p2', title: 'สรุปบทที่ 2', authorCoreUserId: 'u', createdAt: '' },
  { targetKind: 'POST', targetId: 'gone', title: null, authorCoreUserId: null, createdAt: '' },
];

const page = <T,>(items: T[]) => ({ items, meta: { page: 1, limit: 100, total: items.length, totalPages: 1 } });

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  apiList.mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  apiList.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/bookmark-collections') ? page([]) : page(saved)),
  );
});

describe('คอลเลกชัน', () => {
  it('การ์ดแรกคือ "โพสต์ทั้งหมด" ที่นับจากของที่บันทึกไว้จริง', async () => {
    renderWith(<CollectionsGrid />);

    expect(await screen.findByRole('link', { name: 'โพสต์ทั้งหมด · 3 รายการ' })).toHaveAttribute('href', '/saved/all');
  });

  it('คอลเลกชันใหม่: ตั้งชื่อ → ถัดไป → เลือก → เสร็จ ส่งชื่อพร้อมของที่เลือก', async () => {
    apiPost.mockResolvedValue({ id: 'c1' });

    renderWith(<CollectionsGrid />);

    await userEvent.click(await screen.findByRole('button', { name: '+ คอลเลกชั่นใหม่' }));
    await userEvent.type(screen.getByPlaceholderText('ชื่อคอลเลกชั่น'), 'อ่านก่อนสอบ');
    await userEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));

    // ของที่ถูกลบไปแล้วไม่อยู่ในตัวเลือก
    expect(await screen.findByRole('button', { name: 'กระทู้ สรุปบทที่ 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /กระทู้ null/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'กระทู้ สรุปบทที่ 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'เสร็จ' }));

    expect(apiPost).toHaveBeenCalledWith('/bookmark-collections', {
      name: 'อ่านก่อนสอบ',
      items: [{ targetKind: 'POST', targetId: 'p2' }],
    });
  });

  it('เพิ่มจากที่บันทึกไว้: ไม่เสนอของที่อยู่ในคอลเลกชันแล้ว และยิงทีละชิ้น', async () => {
    apiPost.mockResolvedValue({});
    const onClose = vi.fn();

    renderWith(<AddToCollectionDialog collectionId="c1" existing={new Set(['POST:p1'])} onClose={onClose} />);

    expect(await screen.findByRole('button', { name: 'กระทู้ สรุปบทที่ 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'กระทู้ สรุปบทที่ 1' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'กระทู้ สรุปบทที่ 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'เพิ่ม' }));

    expect(apiPost).toHaveBeenCalledWith('/bookmark-collections/c1/items', { targetKind: 'POST', targetId: 'p2' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
