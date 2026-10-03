import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/csmju/types';

/// แผงสมาชิกแบบ Discord — ออนไลน์ก่อน ออฟไลน์จางลง ตัวเลขมาจาก meta.total ของหลังบ้าน
///
/// ปุ่มนำออก/ออกจากห้องขึ้นเฉพาะเมื่อส่ง `channel` มา และตามสิทธิ์ใน room-permissions.ts

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
const apiDel = vi.hoisted(() => vi.fn(async () => undefined));
const me = vi.hoisted(() => ({
  current: { id: 'u1', email: 'u1@core.local', coreRole: 'student', subsystemRole: 'GUEST' },
}));

vi.mock('@/lib/csmju/api', () => ({
  ApiError: class extends Error {},
  api: { list: (path: string) => apiList(path), del: apiDel },
}));

vi.mock('@/lib/csmju/session', () => ({
  useMe: () => me.current,
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

function room(over: Partial<Channel> = {}): Channel {
  return {
    id: 'c1',
    kind: 'GROUP',
    name: 'ติวสอบ DS',
    courseTag: null,
    maxSeats: 8,
    memberCount: 3,
    myRole: 'MODERATOR',
    unreadCount: 0,
    peerCoreUserId: null,
    description: 'ติวก่อนสอบกลางภาค',
    createdByCoreUserId: 'u1',
    canManage: true,
    lastMessage: null,
    inboxFolder: 'PRIMARY',
    pinnedAt: null,
    muted: false,
    clearedAt: null,
    peerLastReadSeq: null,
    memberCoreUserIds: null,
    createdAt: '2026-09-29T01:00:00.000Z',
    ...over,
  };
}

function renderList(props: Partial<Parameters<typeof MemberList>[0]> = {}) {
  const client = new QueryClient();

  return render(
    <QueryClientProvider client={client}>
      <MemberList channelId="c1" onOpenUser={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('MemberList', () => {
  beforeEach(() => {
    apiDel.mockClear();
    me.current = { id: 'u1', email: 'u1@core.local', coreRole: 'student', subsystemRole: 'GUEST' };
  });

  it('แยก "ออนไลน์ — n" กับ "ออฟไลน์ — n" ใช้ชื่อเล่นถ้ามี และคลิกแล้วเปิดโปรไฟล์', async () => {
    const onOpenUser = vi.fn();

    renderList({ onOpenUser });

    const online = (await screen.findByRole('heading', { name: 'ออนไลน์ — 1' })).closest('section')!;
    const offline = screen.getByRole('heading', { name: 'ออฟไลน์ — 2' }).closest('section')!;

    expect(within(online).getByText('ชื่อ-u1')).toBeInTheDocument();
    expect(within(online).getByLabelText('ผู้ดูแลห้อง')).toBeInTheDocument();
    expect(within(offline).getByText('ชัย')).toBeInTheDocument();

    // ออฟไลน์จางลง
    expect(within(offline).getByRole('button', { name: /ชัย/ }).parentElement!.className).toContain('opacity-45');

    await userEvent.click(within(offline).getByRole('button', { name: /ชัย/ }));
    expect(onOpenUser).toHaveBeenCalledWith('u2', expect.objectContaining({ width: 0 }), 'ชัย');
    expect(apiList).toHaveBeenCalledWith('/channels/c1/members?status=online&limit=100');

    // ไม่ส่ง channel มา = ไม่มีปุ่มจัดการสมาชิก
    expect(screen.queryByRole('button', { name: /ออกจากห้อง/ })).not.toBeInTheDocument();
  });

  it('ผู้ดูแลห้องเห็นปุ่มนำคนอื่นออก และปุ่มออกจากห้องที่แถวของตัวเอง → ยืนยันแล้วยิง DELETE', async () => {
    renderList({ channel: room(), header: <p>หัวแผง</p> });

    await screen.findByRole('heading', { name: 'ออนไลน์ — 1' });

    expect(screen.getByText('หัวแผง')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ออกจากห้อง' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'นำ ชัย ออกจากห้อง' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'นำ ชัย ออกจากห้อง' }));
    expect(await screen.findByText('นำ ชัย ออกจากห้อง?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'นำออก' }));
    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/channels/c1/members/u2'));
  });

  it('สมาชิกธรรมดาที่เป็นนักศึกษาไม่เห็นปุ่มนำออก มีแค่ออกจากห้อง → ออกแล้วบอกผู้เรียก', async () => {
    me.current = { id: 'u3', email: 'u3@core.local', coreRole: 'student', subsystemRole: 'GUEST' };
    const onLeft = vi.fn();

    renderList({ channel: room({ myRole: 'MEMBER' }), onLeft });

    await screen.findByRole('heading', { name: 'ออนไลน์ — 1' });

    expect(screen.queryByRole('button', { name: /^นำ .* ออกจากห้อง$/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ออกจากห้อง' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ออกจากห้อง' }));

    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/channels/c1/members/me'));
    expect(onLeft).toHaveBeenCalled();
  });
});
