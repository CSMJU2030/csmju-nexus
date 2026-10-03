import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/csmju/types';

/// ปุ่ม "เชิญสมาชิก" ในหน้า /chat
///
/// กฎที่ต้องคงไว้:
///   - ค้นคนจาก `/search?kind=people` จริง · คำแนะนำมาจากคนที่ติดตาม/คำแนะนำของหลังบ้าน
///   - คนที่อยู่ในห้องแล้วเลือกไม่ได้ และไม่ขึ้นในคำแนะนำ
///   - เลือกหลายคนแล้วยิง `POST /channels/:id/members` ครั้งเดียว · ห้ามโชว์ UUID ของใคร

const api = vi.hoisted(() => ({ list: vi.fn(), post: vi.fn(), get: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', async (original) => ({
  ...(await original<typeof import('@/lib/csmju/api')>()),
  api,
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 's@x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn(async () => ({})),
  bindSocket: vi.fn(() => () => undefined),
}));
vi.mock('@/components/csmju/messages-toast', () => ({ showToast: toast }));
vi.mock('@/components/csmju/profile-follow-list', () => ({
  useMyFollowing: () => ({ data: new Set(['user-004', 'user-009']), isPending: false }),
}));
vi.mock('@/components/csmju/profile-suggestions', () => ({
  useSuggestions: () => ({ people: [{ coreUserId: 'user-005', mutualCount: 1 }], isPending: false }),
}));

const NAMES: Record<string, string> = {
  'user-004': 'มะลิ',
  'user-005': 'ต้นกล้า',
  'user-007': 'ผลค้นหา',
  'user-009': 'คนในห้อง',
};

vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (id: string) => ({
    coreUserId: id,
    displayName: NAMES[id] ?? id,
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

const { InviteMembersButton } = await import('./room-invite');

const channel = {
  id: 'room-1',
  kind: 'GROUP',
  name: 'ติวสอบ DS',
  myRole: 'MODERATOR',
} as Channel;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <InviteMembersButton channel={channel} />
    </QueryClientProvider>,
  );

  return client;
}

describe('InviteMembersButton', () => {
  beforeEach(() => {
    api.list.mockReset();
    api.post.mockReset();
    toast.mockReset();
    api.list.mockImplementation(async (path: string) => {
      if (path.startsWith('/channels/room-1/members')) {
        return {
          items: path.includes('status=online')
            ? [{ coreUserId: 'user-002', role: 'MODERATOR', nickname: null, online: true }]
            : [{ coreUserId: 'user-009', role: 'MEMBER', nickname: null, online: false }],
          meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
        };
      }

      if (path.startsWith('/search')) {
        return {
          items: [
            { id: 'user-007', kind: 'people' },
            { id: 'user-009', kind: 'people' },
            { id: 'user-002', kind: 'people' },
          ],
          meta: { page: 1, limit: 20, total: 3, totalPages: 1 },
        };
      }

      throw new Error(`unexpected ${path}`);
    });
  });

  it('แนะนำคนที่ติดตามที่ยังไม่อยู่ในห้อง · ค้นหาแล้วเลือกหลายคน → POST ครั้งเดียว', async () => {
    const user = userEvent.setup();

    setup();
    await user.click(screen.getByRole('button', { name: 'เชิญสมาชิก' }));

    const dialog = await screen.findByRole('dialog');
    const suggestions = await within(dialog).findByRole('list', { name: 'แนะนำ' });

    await waitFor(() => expect(within(suggestions).getByText('มะลิ')).toBeInTheDocument());
    // คนในห้องแล้วไม่ขึ้นในคำแนะนำ
    expect(within(suggestions).queryByText('คนในห้อง')).not.toBeInTheDocument();

    await user.click(within(suggestions).getByRole('button', { name: /มะลิ/ }));

    await user.type(within(dialog).getByRole('searchbox', { name: 'ค้นหาคน' }), 'ผล');

    const results = await within(dialog).findByRole('list', { name: 'ผลการค้นหา' });

    await waitFor(() => expect(within(results).getByText('ผลค้นหา')).toBeInTheDocument());
    expect(api.list).toHaveBeenCalledWith('/search?q=%E0%B8%9C%E0%B8%A5&kind=people&limit=20');

    // คนในห้องแล้วขึ้นได้แต่กดไม่ได้ · ตัวเองไม่ขึ้น · ไม่มี UUID ให้เห็น
    expect(within(results).getByRole('button', { name: /คนในห้อง/ })).toBeDisabled();
    expect(within(results).getByText('อยู่ในห้องแล้ว')).toBeInTheDocument();
    expect(within(results).queryByText('user-002')).not.toBeInTheDocument();
    expect(within(results).queryByText('user-007')).not.toBeInTheDocument();

    await user.click(within(results).getByRole('button', { name: /ผลค้นหา/ }));

    api.post.mockResolvedValue({ added: 2 });
    await user.click(within(dialog).getByRole('button', { name: 'เพิ่ม 2 คน' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/channels/room-1/members', {
        coreUserIds: ['user-004', 'user-007'],
      }),
    );
    expect(toast).toHaveBeenCalledWith('เพิ่ม 2 คนเข้าห้องแล้ว');
  });

  it('หลังบ้านปฏิเสธ → แสดงข้อความของหลังบ้านในกล่อง', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/csmju/api');

    setup();
    await user.click(screen.getByRole('button', { name: 'เชิญสมาชิก' }));

    const dialog = await screen.findByRole('dialog');

    await user.click(await within(dialog).findByRole('button', { name: /ต้นกล้า/ }));

    api.post.mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'เฉพาะผู้ดูแลห้อง อาจารย์ หรือผู้ดูแลระบบเท่านั้นที่เพิ่มสมาชิกได้'),
    );
    await user.click(within(dialog).getByRole('button', { name: 'เพิ่ม 1 คน' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('เฉพาะผู้ดูแลห้อง');
  });
});
