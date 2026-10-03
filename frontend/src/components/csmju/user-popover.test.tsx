import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/// ป๊อปอัพโปรไฟล์ — ช่อง "ส่งข้อความถึง @x" ต้องส่งจริง (เปิด DM แล้วส่งข้อความ)

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/csmju/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    ApiError,
    api: {
      get: (...args: unknown[]) => apiGet(...args),
      post: (...args: unknown[]) => apiPost(...args),
    },
  };
});

vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'me', email: 'me@core.local', coreRole: 'student', subsystemRole: 'GUEST' }),
}));

vi.mock('@/components/csmju/user-badge', () => ({
  UserAvatar: () => <span data-testid="avatar" />,
  VerifiedBadge: () => null,
  useOnline: () => true,
}));

vi.mock('@/components/csmju/user-name', async (original) => ({
  ...(await original<typeof import('@/components/csmju/user-name')>()),
  useProfile: (id: string) => ({ coreUserId: id, displayName: 'สมชาย', avatarUrl: null, badge: null }),
}));

const { UserPopover } = await import('./user-popover');

function renderPopover(coreUserId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const anchor = { rect: new DOMRect(10, 10, 40, 40) };

  return render(
    <QueryClientProvider client={client}>
      <UserPopover coreUserId={coreUserId} anchor={anchor} open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue({
    coreUserId: 'user-003',
    displayName: 'สมชาย',
    avatarUrl: null,
    syncedAt: null,
    badge: null,
    bio: 'ชอบเขียนโค้ด',
    coverUrl: null,
    stats: { reelCount: 0, postCount: 0, followerCount: 0, followingCount: 0 },
    relation: { following: false, followedBy: false, mutual: false },
    layer2Role: 'GUEST',
    joinedAt: null,
  });
});

describe('UserPopover', () => {
  it('แสดงชื่อ คำแนะนำตัว สถานะ และลิงก์ดูประวัติแบบเต็ม', async () => {
    renderPopover('user-003');

    expect(await screen.findByText('ชอบเขียนโค้ด')).toBeInTheDocument();
    expect(screen.getByText('ออนไลน์')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ดูประวัติแบบเต็ม' })).toHaveAttribute('href', '/profile/user-003');
  });

  it('**พิมพ์แล้วกด Enter = เปิด DM แล้วส่งข้อความจริง**', async () => {
    apiPost.mockImplementation(async (path: string) =>
      path === '/direct-channels' ? { id: 'dm-1' } : { id: 'msg-1' },
    );

    renderPopover('user-003');

    const input = screen.getByRole('textbox', { name: 'ส่งข้อความถึง @สมชาย' });

    await userEvent.type(input, 'สวัสดีครับ{Enter}');

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost).toHaveBeenNthCalledWith(1, '/direct-channels', { peerCoreUserId: 'user-003' });
    expect(apiPost.mock.calls[1][0]).toBe('/channels/dm-1/messages');
    expect(apiPost.mock.calls[1][1]).toMatchObject({ content: 'สวัสดีครับ' });
    expect(await screen.findByRole('link', { name: 'เปิดแชท' })).toHaveAttribute('href', '/messages?channel=dm-1');
    expect(input).toHaveValue('');
  });

  it('ส่งไม่ได้ (เช่นถูกบล็อก) = บอกข้อความจากหลังบ้าน และไม่ล้างที่พิมพ์', async () => {
    const { ApiError } = await import('@/lib/csmju/api');

    apiPost.mockRejectedValue(new ApiError(403, 'forbidden', 'ส่งข้อความหาคนนี้ไม่ได้'));

    renderPopover('user-003');

    const input = screen.getByRole('textbox', { name: 'ส่งข้อความถึง @สมชาย' });

    await userEvent.type(input, 'hi{Enter}');

    expect(await screen.findByText('ส่งข้อความหาคนนี้ไม่ได้')).toBeInTheDocument();
    expect(input).toHaveValue('hi');
  });

  it('โปรไฟล์ของตัวเองไม่มีช่องส่งข้อความ', () => {
    renderPopover('me');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
