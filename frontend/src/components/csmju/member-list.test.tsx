import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/// แผงสมาชิกแบบ Discord — ออนไลน์ก่อน ออฟไลน์จางลง ตัวเลขมาจาก meta.total ของหลังบ้าน

const apiList = vi.fn(async (path: string) =>
  path.includes('status=online')
    ? {
        items: [{ coreUserId: 'u1', role: 'MODERATOR', nickname: null, online: true }],
        meta: { page: 1, limit: 100, totalPages: 1, total: 1 },
      }
    : {
        items: [
          { coreUserId: 'u2', role: 'MEMBER', nickname: 'ชัย', online: false },
          { coreUserId: 'u3', role: 'MEMBER', nickname: null, online: false },
        ],
        meta: { page: 1, limit: 100, totalPages: 1, total: 2 },
      },
);

vi.mock('@/lib/csmju/api', () => ({
  ApiError: class extends Error {},
  api: { list: (path: string) => apiList(path) },
}));

vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn(async () => ({})),
  bindSocket: vi.fn(() => () => undefined),
}));

vi.mock('@/components/csmju/user-badge', () => ({
  UserAvatar: () => <span />,
  VerifiedBadge: () => null,
}));

vi.mock('@/components/csmju/user-name', () => ({
  useProfile: (id: string) => ({ coreUserId: id, displayName: `ชื่อ-${id}`, avatarUrl: null, badge: null }),
}));

const { MemberList } = await import('./member-list');

describe('MemberList', () => {
  it('แยก "ออนไลน์ — n" กับ "ออฟไลน์ — n" ใช้ชื่อเล่นถ้ามี และคลิกแล้วเปิดโปรไฟล์', async () => {
    const onOpenUser = vi.fn();
    const client = new QueryClient();

    render(
      <QueryClientProvider client={client}>
        <MemberList channelId="c1" onOpenUser={onOpenUser} />
      </QueryClientProvider>,
    );

    const online = (await screen.findByRole('heading', { name: 'ออนไลน์ — 1' })).closest('section')!;
    const offline = screen.getByRole('heading', { name: 'ออฟไลน์ — 2' }).closest('section')!;

    expect(within(online).getByText('ชื่อ-u1')).toBeInTheDocument();
    expect(within(online).getByLabelText('ผู้ดูแลห้อง')).toBeInTheDocument();
    expect(within(offline).getByText('ชัย')).toBeInTheDocument();

    // ออฟไลน์จางลง
    expect(within(offline).getByRole('button', { name: /ชัย/ }).className).toContain('opacity-45');

    await userEvent.click(within(offline).getByRole('button', { name: /ชัย/ }));
    expect(onOpenUser).toHaveBeenCalledWith('u2', expect.objectContaining({ width: 0 }), 'ชัย');
    expect(apiList).toHaveBeenCalledWith('/channels/c1/members?status=online&limit=100');
  });
});
