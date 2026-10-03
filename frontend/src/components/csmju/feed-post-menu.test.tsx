import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostMenu } from './feed-post-menu';

/// เทสต์เมนู ⋯ ของโพสต์ — รายการตาม Instagram และสิทธิ์ตามที่หลังบ้านยอม

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, post: apiPost, list: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue({
    coreUserId: 'user-003',
    joinedAt: '2026-09-01T00:00:00+07:00',
    stats: { followerCount: 1234, followingCount: 5, postCount: 1, reelCount: 0 },
  });
  apiPost.mockResolvedValue({});
});

function renderMenu(props: Partial<Parameters<typeof PostMenu>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    open: true,
    onClose: vi.fn(),
    postId: 'post-1',
    authorCoreUserId: 'user-003',
    canDelete: false,
    isOwner: false,
    onDelete: vi.fn().mockResolvedValue(undefined),
    onShareTo: vi.fn(),
    ...props,
  };

  render(
    <QueryClientProvider client={client}>
      <PostMenu {...all} />
    </QueryClientProvider>,
  );

  return all;
}

describe('เมนู ⋯ ของโพสต์', () => {
  it('โพสต์ของคนอื่น: รายงาน · ไปยังโพสต์ · แชร์ไปยัง… · คัดลอกลิงก์ · เกี่ยวกับบัญชีนี้ · ยกเลิก — **ไม่มีลบ ไม่มีโค้ดฝัง**', () => {
    renderMenu();

    const dialog = screen.getByRole('dialog', { name: 'ตัวเลือกของโพสต์' });
    const labels = [...dialog.querySelectorAll('button, a')].map((node) => node.textContent);

    expect(labels).toEqual(['รายงาน', 'ไปยังโพสต์', 'แชร์ไปยัง…', 'คัดลอกลิงก์', 'เกี่ยวกับบัญชีนี้', 'ยกเลิก']);
    expect(screen.getByRole('link', { name: 'ไปยังโพสต์' })).toHaveAttribute('href', '/p/post-1');
  });

  it('**เจ้าของ: ลบ (ยืนยันก่อน) แทนรายงาน**', async () => {
    const user = userEvent.setup();
    const props = renderMenu({ isOwner: true, canDelete: true, authorCoreUserId: 'user-002' });

    expect(screen.queryByRole('button', { name: 'รายงาน' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('ลบโพสต์ใช่ไหม')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it('"แชร์ไปยัง…" ปิดเมนูก่อนแล้วเปิดแผ่นแชร์ (เปิดทีละชั้น)', async () => {
    const user = userEvent.setup();
    const props = renderMenu();

    await user.click(screen.getByRole('button', { name: 'แชร์ไปยัง…' }));

    expect(props.onClose).toHaveBeenCalled();
    expect(props.onShareTo).toHaveBeenCalled();
  });

  it('เกี่ยวกับบัญชีนี้: วันที่เข้าร่วม (ภาษาไทย) และผู้ติดตามจริง', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'เกี่ยวกับบัญชีนี้' }));

    expect(await screen.findByText(/เข้าร่วมเมื่อ กันยายน 2569/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้ติดตาม 1,234 คน/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/profiles/user-003');
  });

  it('รายงาน: ต้องเล่าอย่างน้อย 10 ตัวอักษร แล้วส่งเข้าคิว /reports', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'รายงาน' }));

    const send = screen.getByRole('button', { name: 'ส่งรายงาน' });

    await user.type(screen.getByRole('textbox'), 'สั้นไป');
    expect(send).toBeDisabled();

    await user.type(screen.getByRole('textbox'), ' ข้อความคุกคามรุ่นน้อง');
    await user.click(send);

    expect(apiPost).toHaveBeenCalledWith('/reports', {
      targetKind: 'POST',
      targetId: 'post-1',
      reason: 'สั้นไป ข้อความคุกคามรุ่นน้อง',
    });
  });
});
