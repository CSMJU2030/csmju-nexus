import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/csmju/types';
import { MessagesDock } from './messages-dock';

/// เทสต์แผงข้อความลอยมุมขวาล่าง
///
/// กฎที่ต้องคงไว้:
///   - เลขค้างนับเฉพาะกล่องหลัก + ทั่วไป (คำขอ/ที่ซ่อนไว้ไม่นับ)
///   - ปุ่มดินสอกลมสลับแผงเป็น "ข้อความใหม่" ในที่ แล้วเปิดห้องที่สร้างในแผงเดียวกัน
///   - ซ่อนในหน้าที่เป็นหน้าคุยอยู่แล้ว

const api = vi.hoisted(() => ({ list: vi.fn() }));
const path = vi.hoisted(() => ({ current: '/feed' }));

vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/csmju/api', () => ({ api }));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 's@x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (id: string) => ({ coreUserId: id, displayName: id, avatarUrl: null, syncedAt: null, badge: null }),
}));
vi.mock('@/components/csmju/direct-thread', () => ({
  DirectThread: ({ channel }: { channel: Channel }) => <div data-testid="thread">{channel.id}</div>,
}));
vi.mock('@/components/csmju/messages-compose', () => ({
  ComposePanel: ({ onStarted }: { onStarted: (channel: Channel) => void }) => (
    <div data-testid="compose">
      <button type="button" onClick={() => onStarted(channel({ id: 'g-new', kind: 'GROUP_DM' }))}>
        สร้างแชทกลุ่ม
      </button>
    </div>
  ),
}));

function channel(over: Partial<Channel>): Channel {
  return {
    id: 'dm-1',
    kind: 'DM',
    name: null,
    courseTag: null,
    maxSeats: 2,
    memberCount: 2,
    myRole: 'MEMBER',
    unreadCount: 0,
    peerCoreUserId: 'user-003',
    description: null,
    createdByCoreUserId: null,
    canManage: false,
    lastMessage: null,
    inboxFolder: 'PRIMARY',
    pinnedAt: null,
    muted: false,
    clearedAt: null,
    peerLastReadSeq: null,
    memberCoreUserIds: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function renderDock() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MessagesDock />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  path.current = '/feed';
  api.list.mockReset();
  api.list.mockResolvedValue({
    items: [
      channel({ id: 'dm-1', unreadCount: 2, pinnedAt: '2026-09-29T00:00:00Z' }),
      channel({ id: 'dm-2', peerCoreUserId: 'user-004', inboxFolder: 'GENERAL', unreadCount: 1, muted: true }),
      channel({ id: 'dm-3', peerCoreUserId: 'user-005', inboxFolder: 'REQUEST', unreadCount: 5 }),
      channel({ id: 'dm-4', peerCoreUserId: 'user-006', inboxFolder: 'HIDDEN', unreadCount: 9 }),
    ],
    meta: {},
  });
});

describe('แผงข้อความลอย', () => {
  it('**เลขค้างไม่นับคำขอและที่ซ่อนไว้**', async () => {
    renderDock();

    expect(await screen.findByRole('button', { name: 'ข้อความ (3 ยังไม่อ่าน)' })).toBeInTheDocument();
  });

  it('ปุ่มยาว: รูปซ้อนของคนที่มีข้อความค้างเท่านั้น (ถ้ามี)', async () => {
    const { container } = renderDock();

    await screen.findByRole('button', { name: 'ข้อความ (3 ยังไม่อ่าน)' });

    // dm-1 (user-003) และ dm-2 (user-004) ค้างอยู่ · คำขอ/ที่ซ่อนไว้ไม่นับ
    await waitFor(() => expect(container.querySelectorAll('[aria-hidden] > span').length).toBe(2));
  });

  it('เปิดแผง: รายการหลัก+ทั่วไป · ไอคอนปักหมุด/ปิดเสียง · ลิงก์คำขอ', async () => {
    renderDock();

    await userEvent.click(await screen.findByRole('button', { name: /^ข้อความ \(/ }));

    expect(await screen.findByText('user-003')).toBeInTheDocument();
    expect(screen.getByText('user-004')).toBeInTheDocument();
    expect(screen.queryByText('user-005')).not.toBeInTheDocument();
    expect(screen.queryByText('user-006')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ปักหมุดไว้')).toBeInTheDocument();
    expect(screen.getByLabelText('ปิดเสียงไว้')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /คำขอข้อความ \(1\)/ })).toHaveAttribute(
      'href',
      '/messages?view=requests',
    );
  });

  it('**ปุ่มดินสอสลับแผงเป็น "ข้อความใหม่" ในที่** แล้วเปิดห้องที่สร้างในแผงเดียวกัน', async () => {
    renderDock();

    await userEvent.click(await screen.findByRole('button', { name: /^ข้อความ \(/ }));
    await userEvent.click(screen.getByRole('button', { name: 'ข้อความใหม่' }));

    expect(screen.getByTestId('compose')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'สร้างแชทกลุ่ม' }));

    await waitFor(() => expect(screen.getByTestId('thread')).toHaveTextContent('g-new'));
  });

  it('ซ่อนในหน้าที่เป็นหน้าคุยอยู่แล้ว', () => {
    path.current = '/messages';

    const { container } = renderDock();

    expect(container).toBeEmptyDOMElement();
  });
});
