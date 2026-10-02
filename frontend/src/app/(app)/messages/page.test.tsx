import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/csmju/types';
import MessagesPage from './page';

/// เทสต์หน้าข้อความส่วนตัว (IG Direct)
///
/// ห้องที่เปิดอยู่ กล่อง "ข้อความใหม่" และหน้าคำขออยู่ใน URL — เทสต์นี้จึงตรวจว่า
/// หน้าวาดตาม `?channel=` / `?compose=1` / `?view=` และการกดต่าง ๆ เขียน URL ถูก
/// (บทสนทนา กล่องข้อความใหม่ และแถวโน้ต มีเทสต์ของตัวเองแยกไว้)

const search = vi.hoisted(() => ({ current: new URLSearchParams() }));
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => search.current,
  usePathname: () => '/messages',
}));
vi.mock('@/lib/csmju/api', async (original) => ({
  ...(await original<typeof import('@/lib/csmju/api')>()),
  api,
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/messages-notes', () => ({
  NotesRow: ({ onEditMine }: { onEditMine: () => void }) => (
    <button type="button" onClick={onEditMine}>
      โน้ตของคุณ
    </button>
  ),
  NoteComposer: () => <div data-testid="note-composer" />,
}));
vi.mock('@/components/csmju/account-dialogs', () => ({
  SwitchAccountDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="สลับบัญชี" /> : null,
}));
vi.mock('@/components/csmju/messages-compose', () => ({
  ComposeDialog: ({
    open,
    onStarted,
  }: {
    open: boolean;
    onStarted: (channel: Channel) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="ข้อความใหม่">
        <button type="button" onClick={() => onStarted(channel({ id: 'g-new', kind: 'GROUP_DM' }))}>
          สร้างแชทกลุ่ม
        </button>
      </div>
    ) : null,
}));
vi.mock('@/components/csmju/direct-thread', () => ({
  DirectThread: ({ channel }: { channel: Channel }) => (
    <div data-testid="thread">{channel.id}</div>
  ),
}));

const NAMES: Record<string, string> = {
  'user-002': 'นักศึกษาทดสอบ',
  'user-003': 'อาจารย์สมชาย',
  'user-004': 'เพื่อนร่วมห้อง',
  'user-005': 'คนแปลกหน้า',
  'user-006': 'คนที่ซ่อนไว้',
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

const CHANNELS = [
  channel({ id: 'dm-1', peerCoreUserId: 'user-003', unreadCount: 2 }),
  channel({ id: 'room-1', kind: 'GROUP', name: 'ห้องติว', peerCoreUserId: null }),
  channel({ id: 'dm-2', peerCoreUserId: 'user-004', inboxFolder: 'GENERAL' }),
  channel({
    id: 'g-1',
    kind: 'GROUP_DM',
    name: 'ติวสอบ DS',
    peerCoreUserId: null,
    memberCoreUserIds: ['user-002', 'user-003', 'user-004'],
  }),
  channel({ id: 'dm-3', peerCoreUserId: 'user-005', inboxFolder: 'REQUEST', unreadCount: 1 }),
  channel({ id: 'dm-4', peerCoreUserId: 'user-006', inboxFolder: 'HIDDEN' }),
];

let pushState: ReturnType<typeof vi.spyOn>;
let replaceState: ReturnType<typeof vi.spyOn>;

function renderPage(query = '') {
  search.current = new URLSearchParams(query);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MessagesPage />
    </QueryClientProvider>,
  );
}

/// แถวบทสนทนา (ไม่นับปุ่ม ⋯ ที่อยู่ในแถว)
const rows = (name = 'บทสนทนา') =>
  within(screen.getByRole('list', { name }))
    .queryAllByRole('button')
    .filter((button) => button.getAttribute('aria-label') !== 'ตัวเลือกของแชท');

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue({ items: CHANNELS, meta: {} });
  api.get.mockImplementation((path: string) =>
    path.startsWith('/profiles')
      ? Promise.resolve(
          Object.entries(NAMES).map(([coreUserId, displayName]) => ({
            coreUserId,
            displayName,
            avatarUrl: null,
            syncedAt: null,
            badge: null,
          })),
        )
      : Promise.reject(new Error(`ไม่ได้คาดว่าจะเรียก ${path}`)),
  );
  pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

afterEach(() => {
  pushState.mockRestore();
  replaceState.mockRestore();
});

describe('หน้าข้อความ', () => {
  it('แท็บ "หลัก" = แชทส่วนตัว + แชทกลุ่มในแฟ้ม PRIMARY เท่านั้น', async () => {
    renderPage();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.list).toHaveBeenCalledWith('/channels?limit=50');
    expect(rows()[0]).toHaveTextContent('อาจารย์สมชาย');
    expect(rows()[1]).toHaveTextContent('ติวสอบ DS');
    // คำขอ ที่ซ่อนไว้ ทั่วไป และห้องแชทแบบ Discord ไม่ปนในกล่องหลัก
    for (const text of ['คนแปลกหน้า', 'คนที่ซ่อนไว้', 'เพื่อนร่วมห้อง', 'ห้องติว']) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it('แท็บ "ทั่วไป" = แฟ้ม GENERAL', async () => {
    renderPage();

    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(screen.getByRole('tab', { name: 'ทั่วไป' }));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('เพื่อนร่วมห้อง');
  });

  it('"คำขอ (n)" นับคำขอจริง แล้วเปิดหน้าคำขอผ่าน URL', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'คำขอ (1)' }));

    expect(pushState).toHaveBeenCalledWith(null, '', '/?view=requests');
  });

  it('หน้าคำขอ: อธิบายว่ามาจากคนที่ไม่ได้ติดตาม · ลบ/ซ่อน/ยอมรับ · ลิงก์คำขอที่ซ่อนไว้', async () => {
    renderPage('view=requests');

    expect(await screen.findByRole('heading', { name: 'คำขอข้อความ' })).toBeInTheDocument();
    expect(screen.getByText(/มาจากคนที่คุณไม่ได้ติดตาม/)).toBeInTheDocument();

    const list = await screen.findByRole('list', { name: 'คำขอข้อความ' });

    await waitFor(() => expect(list).toHaveTextContent('คนแปลกหน้า'));
    for (const name of ['ลบ', 'ซ่อน', 'ยอมรับ']) {
      expect(within(list).getByRole('button', { name })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole('button', { name: 'คำขอที่ซ่อนไว้ (1)' }));
    expect(pushState).toHaveBeenCalledWith(null, '', '/?view=hidden');

    await userEvent.click(screen.getByRole('button', { name: 'กลับไปกล่องข้อความ' }));
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('หน้าคำขอที่ซ่อนไว้ = แฟ้ม HIDDEN', async () => {
    renderPage('view=hidden');

    const list = await screen.findByRole('list', { name: 'คำขอที่ซ่อนไว้' });

    await waitFor(() => expect(list).toHaveTextContent('คนที่ซ่อนไว้'));
    expect(list).not.toHaveTextContent('คนแปลกหน้า');
  });

  it('**ค้นด้วยชื่อที่แสดงได้** รวมชื่อกลุ่ม', async () => {
    renderPage();

    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.type(screen.getByPlaceholderText('ค้นหา'), 'สมชาย');

    // อาจารย์สมชายอยู่ทั้งแชทส่วนตัวและในกลุ่ม
    await waitFor(() => expect(rows()).toHaveLength(2));

    await userEvent.clear(screen.getByPlaceholderText('ค้นหา'));
    await userEvent.type(screen.getByPlaceholderText('ค้นหา'), 'ติวสอบ');
    await waitFor(() => expect(rows()).toHaveLength(1));

    await userEvent.clear(screen.getByPlaceholderText('ค้นหา'));
    await userEvent.type(screen.getByPlaceholderText('ค้นหา'), 'ไม่มีใครชื่อนี้');
    expect(await screen.findByText(/ไม่พบบทสนทนาที่ตรงกับ/)).toBeInTheDocument();
  });

  it('ชื่อบัญชี + ⌄ เปิดกล่องสลับบัญชี (ชื่อมาจากส่วนหน้าอีเมลเมื่อไม่มีชื่อที่แสดง)', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /สลับบัญชี/ }));

    expect(screen.getByRole('dialog', { name: 'สลับบัญชี' })).toBeInTheDocument();
  });

  it('กดแถว = เปิดห้องนั้นผ่าน URL', async () => {
    renderPage();

    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(rows()[1]);

    expect(pushState).toHaveBeenCalledWith(null, '', '/?channel=g-1');
  });

  it('`?channel=` เปิดบทสนทนานั้นเลย · ไม่มีห้องเปิด = สถานะว่างพร้อมปุ่มส่งข้อความ', async () => {
    const { unmount } = renderPage('channel=dm-2');

    expect(await screen.findByTestId('thread')).toHaveTextContent('dm-2');
    unmount();

    renderPage();

    expect(await screen.findByText('ข้อความของคุณ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ส่งข้อความ' }));
    expect(pushState).toHaveBeenCalledWith(null, '', '/?compose=1');
  });

  it('ลิงก์ตรงไปห้องที่ไม่อยู่ในรายการ → ดึงห้องนั้นมาเปิดเอง', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/channels/dm-99'
        ? Promise.resolve(channel({ id: 'dm-99', peerCoreUserId: 'user-004' }))
        : Promise.resolve([]),
    );

    renderPage('channel=dm-99');

    expect(await screen.findByTestId('thread')).toHaveTextContent('dm-99');
  });

  it('`?compose=1` เปิดกล่อง "ข้อความใหม่" · สร้างเสร็จแล้วเปิดห้องใหม่ทันที', async () => {
    renderPage('compose=1');

    const dialog = await screen.findByRole('dialog', { name: 'ข้อความใหม่' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'สร้างแชทกลุ่ม' }));

    expect(pushState).toHaveBeenCalledWith(null, '', '/?channel=g-new');
  });

  it('กดโน้ตของเรา = หน้า "โน้ตใหม่" แทนคอลัมน์ขวา (?note=1)', async () => {
    const { unmount } = renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'โน้ตของคุณ' }));
    expect(pushState).toHaveBeenCalledWith(null, '', '/?note=1');
    unmount();

    renderPage('note=1');

    expect(await screen.findByTestId('note-composer')).toBeInTheDocument();
    expect(screen.queryByText('ข้อความของคุณ')).not.toBeInTheDocument();
  });
});
