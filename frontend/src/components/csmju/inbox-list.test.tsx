import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/csmju/types';
import {
  CHANNELS_KEY,
  InboxList,
  InboxRow,
  inFolder,
  othersOf,
  peerOf,
  previewOf,
  RequestActions,
  sortInbox,
} from './inbox-list';

/// เทสต์รายการบทสนทนาแบบ IG Direct
///
/// กฎที่ต้องคงไว้:
///   - บรรทัดที่สองมาจากข้อมูลจริงของห้อง (`lastMessage` · `unreadCount`)
///   - แท็บมาจาก `inboxFolder` ของหลังบ้าน · HIDDEN/REQUEST ไม่ปนกล่องหลัก
///   - ปักหมุดอยู่บนสุดเสมอ แม้ห้องอื่นจะมีข้อความใหม่กว่า
///   - เมนู ⋯ / ปุ่มคำขอ ยิง endpoint จริงแล้วแก้แคช ['channels','mine'] ทันที

const api = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/csmju/api', () => ({ api }));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 's@x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));

const NAMES: Record<string, string> = {
  'user-003': 'อาจารย์สมชาย',
  'user-004': 'มะลิ',
  'user-005': 'ต้นกล้า',
};

vi.mock('@/components/csmju/user-name', () => ({
  Avatar: ({ coreUserId }: { coreUserId: string }) => (
    <span data-testid="avatar">{coreUserId}</span>
  ),
  useProfile: (id: string) => ({
    coreUserId: id,
    displayName: NAMES[id] ?? id,
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function dm(over: Partial<Channel> = {}): Channel {
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
    lastMessage: {
      seq: 4,
      content: 'เจอกันพรุ่งนี้',
      authorCoreUserId: 'user-003',
      attachmentCount: 0,
      createdAt: minutesAgo(5),
    },
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

const group = (over: Partial<Channel> = {}) =>
  dm({
    id: 'g-1',
    kind: 'GROUP_DM',
    peerCoreUserId: null,
    memberCoreUserIds: ['user-002', 'user-004', 'user-005'],
    memberCount: 3,
    ...over,
  });

let client: QueryClient;

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('previewOf', () => {
  it('ข้อความของอีกฝ่าย = ตัวข้อความ + เวลาแบบย่อ', () => {
    expect(previewOf(dm(), 'user-002')).toEqual({
      text: 'เจอกันพรุ่งนี้',
      ago: '5 นาที',
      unread: false,
    });
  });

  it('ข้อความที่เราส่งเองขึ้นต้นด้วย "คุณ:"', () => {
    const channel = dm({
      lastMessage: {
        content: 'รับทราบครับ',
        authorCoreUserId: 'user-002',
        attachmentCount: 0,
        createdAt: minutesAgo(0),
      },
    });

    expect(previewOf(channel, 'user-002').text).toBe('คุณ: รับทราบครับ');
  });

  it('**ไฟล์แนบล้วนมีคำแทน** ไม่เหลือแค่ "คุณ: "', () => {
    const channel = dm({
      lastMessage: {
        content: null,
        authorCoreUserId: 'user-002',
        attachmentCount: 2,
        createdAt: minutesAgo(1),
      },
    });

    expect(previewOf(channel, 'user-002').text).toBe('คุณ: ส่งไฟล์แนบ');
  });

  it('ข้อความการโทรใช้ข้อความไทยของหลังบ้านตามนั้น ไม่เติม "คุณ:"', () => {
    const channel = dm({
      lastMessage: {
        content: 'คุณเริ่มการโทรด้วยเสียง',
        authorCoreUserId: 'user-002',
        attachmentCount: 0,
        createdAt: minutesAgo(1),
        callLog: {
          media: 'AUDIO',
          status: 'ANSWERED',
          durationSec: 30,
          callerCoreUserId: 'user-002',
          startedAt: minutesAgo(2),
          endedAt: minutesAgo(1),
        },
      },
    });

    expect(previewOf(channel, 'user-002').text).toBe('คุณเริ่มการโทรด้วยเสียง');
  });

  it('แชทกลุ่มบอกว่าใครส่ง (ผู้เรียกเติมชื่อเอง)', () => {
    const channel = group({
      lastMessage: {
        content: 'ใครว่างบ้าง',
        authorCoreUserId: 'user-004',
        attachmentCount: 0,
        createdAt: minutesAgo(1),
      },
    });

    expect(previewOf(channel, 'user-002')).toMatchObject({ text: 'ใครว่างบ้าง', author: 'user-004' });
  });

  it('**มีข้อความค้าง = บอกจำนวนแทนตัวอย่าง** และเกินเก้าเป็น 9+', () => {
    expect(previewOf(dm({ unreadCount: 3 }), 'user-002')).toMatchObject({
      text: '3 ข้อความใหม่',
      unread: true,
    });
    expect(previewOf(dm({ unreadCount: 42 }), 'user-002').text).toBe('9+ ข้อความใหม่');
  });

  it('ห้องที่ยังไม่มีใครพิมพ์บอกตรง ๆ ไม่ขึ้นเวลา', () => {
    expect(previewOf(dm({ lastMessage: null }), 'user-002')).toEqual({
      text: 'ยังไม่มีข้อความ',
      ago: null,
      unread: false,
    });
  });
});

describe('แฟ้ม · เรียง · สมาชิก', () => {
  it('แท็บมาจาก inboxFolder · ห้องแชทแบบ Discord ไม่นับ', () => {
    expect(inFolder(dm(), 'PRIMARY')).toBe(true);
    expect(inFolder(dm({ inboxFolder: 'HIDDEN' }), 'PRIMARY')).toBe(false);
    expect(inFolder(dm({ inboxFolder: 'REQUEST' }), 'REQUEST')).toBe(true);
    expect(inFolder(group({ inboxFolder: 'GENERAL' }), 'GENERAL')).toBe(true);
    expect(inFolder(dm({ kind: 'GROUP' }), 'PRIMARY')).toBe(false);
  });

  it('**ปักหมุดอยู่บนสุด** แม้ห้องอื่นมีข้อความใหม่กว่า', () => {
    const fresh = dm({ id: 'fresh', lastMessage: { content: 'x', authorCoreUserId: 'user-003', attachmentCount: 0, createdAt: minutesAgo(0) } });
    const pinned = dm({ id: 'pinned', pinnedAt: '2026-09-20T00:00:00Z', lastMessage: null });
    const old = dm({ id: 'old', lastMessage: { content: 'y', authorCoreUserId: 'user-003', attachmentCount: 0, createdAt: minutesAgo(600) } });

    expect(sortInbox([old, fresh, pinned]).map((row) => row.id)).toEqual(['pinned', 'fresh', 'old']);
  });

  it('peerOf / othersOf — DM ได้คู่สนทนา · กลุ่มได้ทุกคนยกเว้นเรา', () => {
    expect(peerOf(dm(), 'user-002')).toBe('user-003');
    expect(peerOf(dm({ peerCoreUserId: null, name: 'user-009' }), 'user-002')).toBe('user-009');
    expect(peerOf(group(), 'user-002')).toBeNull();
    expect(othersOf(group(), 'user-002')).toEqual(['user-004', 'user-005']);
  });
});

describe('InboxRow', () => {
  it('แสดงชื่อที่แสดงของคู่สนทนา ตัวอย่างข้อความ และเวลา', () => {
    wrap(<InboxRow channel={dm()} onOpen={() => {}} />);

    const row = screen.getByRole('button', { name: /อาจารย์สมชาย/ });

    expect(within(row).getByText('เจอกันพรุ่งนี้')).toBeInTheDocument();
    expect(within(row).getByText(/· 5 นาที/)).toBeInTheDocument();
  });

  it('แชทกลุ่ม: รูปสองคนซ้อน · ชื่อสมาชิกคั่นด้วย ", " · ชื่อคนส่งล่าสุด', () => {
    wrap(
      <InboxRow
        channel={group({
          lastMessage: { content: 'ใครว่าง', authorCoreUserId: 'user-005', attachmentCount: 0, createdAt: minutesAgo(2) },
        })}
        onOpen={() => {}}
      />,
    );

    const row = screen.getByRole('button', { name: /มะลิ, ต้นกล้า/ });

    expect(within(row).getAllByTestId('avatar')).toHaveLength(2);
    expect(row).toHaveTextContent('ต้นกล้า: ใครว่าง');
  });

  it('ชื่อเล่นที่ตั้งไว้ในห้องแทนชื่อที่แสดง', () => {
    wrap(<InboxRow channel={dm({ nicknames: { 'user-003': 'อ.สมชาย' } })} onOpen={() => {}} />);

    expect(screen.getByRole('button', { name: /อ\.สมชาย/ })).toBeInTheDocument();
    expect(screen.queryByText('อาจารย์สมชาย')).not.toBeInTheDocument();
  });

  it('ชื่อกลุ่มที่ตั้งไว้มาก่อนรายชื่อสมาชิก', () => {
    wrap(<InboxRow channel={group({ name: 'ติวสอบ DS' })} onOpen={() => {}} />);

    expect(screen.getByRole('button', { name: /ติวสอบ DS/ })).toBeInTheDocument();
  });

  it('ยังไม่อ่าน = ตัวหนา + จุดฟ้า · ปักหมุด/ปิดเสียงมีไอคอนต่อท้ายชื่อ', () => {
    wrap(
      <InboxRow
        channel={dm({ unreadCount: 2, pinnedAt: '2026-09-29T00:00:00Z', muted: true })}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText('ยังไม่อ่าน')).toHaveClass('sr-only');
    expect(screen.getByText('2 ข้อความใหม่')).toBeInTheDocument();
    expect(screen.getByLabelText('ปักหมุดไว้')).toBeInTheDocument();
    expect(screen.getByLabelText('ปิดเสียงไว้')).toBeInTheDocument();
  });

  it('กดแถว = ส่งห้องนั้นกลับให้ผู้เรียก · แถวที่เปิดอยู่มี aria-current', async () => {
    const onOpen = vi.fn();
    const channel = dm();

    wrap(<InboxRow channel={channel} active onOpen={onOpen} />);

    const row = screen.getByRole('button', { name: /อาจารย์สมชาย/ });

    await userEvent.click(row);

    expect(onOpen).toHaveBeenCalledWith(channel);
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('**เมนู ⋯ → ปักหมุด** ยิง PATCH /inbox แล้วแคชเรียงใหม่ทันที', async () => {
    const other = dm({ id: 'dm-0', peerCoreUserId: 'user-004' });
    const target = dm({ id: 'dm-1' });

    client.setQueryData(CHANNELS_KEY, [other, target]);
    api.patch.mockResolvedValue({ ...target, pinnedAt: '2026-09-30T00:00:00Z' });

    wrap(<InboxRow channel={target} onOpen={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของแชท' }));
    const menu = await screen.findByRole('menu', { name: 'ตัวเลือกของแชท' });

    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'ทำเครื่องหมายว่ายังไม่ได้อ่าน',
      'ปักหมุด',
      'ปิดเสียง',
      'ย้ายไปทั่วไป',
      'ลบ',
    ]);

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'ปักหมุด' }));

    expect(api.patch).toHaveBeenCalledWith('/channels/dm-1/inbox', { pinned: true });
    await waitFor(() =>
      expect(client.getQueryData<Channel[]>(CHANNELS_KEY)?.map((row) => row.id)).toEqual(['dm-1', 'dm-0']),
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('**ทำเครื่องหมายว่ายังไม่ได้อ่าน** ยิง POST /unread แล้วจุดฟ้ากลับมาตามห้องที่หลังบ้านคืน', async () => {
    const target = dm();

    client.setQueryData(CHANNELS_KEY, [target]);
    api.post.mockResolvedValue({ ...target, unreadCount: 1, markedUnread: true });

    wrap(<InboxRow channel={target} onOpen={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของแชท' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'ทำเครื่องหมายว่ายังไม่ได้อ่าน' }));

    expect(api.post).toHaveBeenCalledWith('/channels/dm-1/unread');
    await waitFor(() => expect(client.getQueryData<Channel[]>(CHANNELS_KEY)?.[0].unreadCount).toBe(1));
  });

  it('ห้องที่ยังค้างอยู่ หรือยังไม่มีข้อความ ไม่มีรายการ "ทำเครื่องหมายว่ายังไม่ได้อ่าน"', async () => {
    wrap(<InboxRow channel={dm({ unreadCount: 2 })} onOpen={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของแชท' }));

    expect(
      within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'ทำเครื่องหมายว่ายังไม่ได้อ่าน' }),
    ).not.toBeInTheDocument();
  });

  it('เมนูปิดด้วย Esc', async () => {
    wrap(<InboxRow channel={dm()} onOpen={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของแชท' }));
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('**ลบแชทต้องยืนยันก่อน** แล้วยิง POST /clear และเอาห้องออกจากแคช', async () => {
    const target = dm();

    client.setQueryData(CHANNELS_KEY, [target]);
    api.post.mockResolvedValue({ clearedAt: 'now' });

    wrap(<InboxRow channel={target} onOpen={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของแชท' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'ลบ' }));

    expect(api.post).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('ลบแชทนี้ไหม');
    await userEvent.click(within(dialog).getByRole('button', { name: 'ลบ' }));

    expect(api.post).toHaveBeenCalledWith('/channels/dm-1/clear');
    await waitFor(() => expect(client.getQueryData<Channel[]>(CHANNELS_KEY)).toEqual([]));
  });
});

describe('RequestActions', () => {
  it('ยอมรับ = ย้ายไป PRIMARY · ซ่อน = HIDDEN', async () => {
    const request = dm({ inboxFolder: 'REQUEST' });
    const onGone = vi.fn();

    client.setQueryData(CHANNELS_KEY, [request]);
    api.patch.mockImplementation((_path: string, body: { folder: string }) =>
      Promise.resolve({ ...request, inboxFolder: body.folder }),
    );

    wrap(<RequestActions channel={request} onGone={onGone} />);

    await userEvent.click(screen.getByRole('button', { name: 'ยอมรับ' }));
    expect(api.patch).toHaveBeenCalledWith('/channels/dm-1/inbox', { folder: 'PRIMARY' });
    await waitFor(() => expect(onGone).toHaveBeenCalledWith('accepted'));
    expect(client.getQueryData<Channel[]>(CHANNELS_KEY)?.[0].inboxFolder).toBe('PRIMARY');

    await userEvent.click(screen.getByRole('button', { name: 'ซ่อน' }));
    expect(api.patch).toHaveBeenLastCalledWith('/channels/dm-1/inbox', { folder: 'HIDDEN' });
  });

  it('คำขอที่ซ่อนไว้แล้วไม่มีปุ่ม "ซ่อน" ซ้ำ', () => {
    wrap(<RequestActions channel={dm({ inboxFolder: 'HIDDEN' })} />);

    expect(screen.queryByRole('button', { name: 'ซ่อน' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยอมรับ' })).toBeInTheDocument();
  });
});

describe('InboxList', () => {
  it('แสดงแชทส่วนตัวและแชทกลุ่ม — ห้องแชทแบบ Discord ไม่ปน', () => {
    wrap(
      <InboxList
        channels={[
          dm({ id: 'dm-1' }),
          dm({ id: 'room-1', kind: 'GROUP', name: 'ห้องติว', peerCoreUserId: null }),
          group({ id: 'g-2' }),
        ]}
        activeId="g-2"
        onOpen={() => {}}
        actions={false}
      />,
    );

    const rows = within(screen.getByRole('list', { name: 'บทสนทนา' })).getAllByRole('button');

    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText('ห้องติว')).not.toBeInTheDocument();
  });
});
