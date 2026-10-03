import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, Message } from '@/lib/csmju/types';
import {
  CHANNELS_KEY,
  DirectThread,
  replacePending,
  withIncoming,
  withRead,
} from './direct-thread';

/// เทสต์บทสนทนาส่วนตัว (หน้าเต็มและหน้าต่างลอย)
///
/// กฎที่ต้องคงไว้:
///   - ส่งแล้วเห็นทันที และของจริงจากเซิร์ฟเวอร์ **แทนที่** ตัวชั่วคราว ไม่ขึ้นซ้ำ
///   - socket ต่อไม่ได้ยังส่งได้ทาง REST
///   - ข้อความใหม่/การอ่าน อัปเดตแคช ['channels','mine'] ที่รายการซ้ายและ
///     ตัวเลขบนแถบซ้ายอ่านอยู่ — ไม่ต้องรอรอบดึงใหม่ 30 วินาที

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
}));
const socketMock = vi.hoisted(() => ({
  connect: vi.fn(),
  emitWithAck: vi.fn(),
  handlers: {} as Record<string, (payload: unknown) => void>,
}));
const startCall = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', async (original) => ({
  ...(await original<typeof import('@/lib/csmju/api')>()),
  api,
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 's@x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: socketMock.connect,
  emitWithAck: socketMock.emitWithAck,
  bindSocket: (_socket: unknown, event: string, handler: (payload: unknown) => void) => {
    socketMock.handlers[event] = handler;

    return () => {
      delete socketMock.handlers[event];
    };
  },
  onSocketStatus: () => () => {},
  onSocketReconnect: () => () => {},
  rememberRoom: vi.fn(),
  forgetRoom: vi.fn(),
}));
vi.mock('@/components/csmju/call-provider', () => ({
  useCall: () => ({ startCall, inCall: false, error: null }),
}));
// แผงรายละเอียดใช้ปุ่มติดตามของหน้าโปรไฟล์ — ไม่ใช่สิ่งที่เทสต์นี้ตรวจ
vi.mock('@/components/csmju/profile-follow-list', () => ({
  useMyFollowing: () => ({ data: new Set<string>(), isPending: false }),
  useFollowToggle: () => vi.fn(),
}));
// ลิงก์ไฟล์เสียงมาจาก signed URL — ในเทสต์ถือว่ายังขอไม่เสร็จ
vi.mock('@/lib/csmju/asset-url', () => ({
  useAssetUrl: () => ({ url: null, error: null }),
}));
// แผงอิโมจิเต็มชุดโหลดข้อมูล 250 KB แบบ dynamic — แทนด้วยปุ่มเดียวที่ส่ง 😀
vi.mock('@/components/csmju/emoji-picker', async (original) => ({
  ...(await original<typeof import('@/components/csmju/emoji-picker')>()),
  EmojiPopover: ({ open, onPick }: { open: boolean; onPick: (emoji: string) => void }) =>
    open ? (
      <div role="dialog" aria-label="เลือกอีโมจิ">
        <button type="button" onClick={() => onPick('😀')}>
          😀
        </button>
      </div>
    ) : null,
}));
vi.mock('@/components/csmju/user-badge', () => ({
  useOnline: () => false,
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: ({ coreUserId }: { coreUserId: string }) => (
    <span data-testid={`avatar-${coreUserId}`} />
  ),
  useProfile: (id: string) => ({
    coreUserId: id,
    displayName:
      ({ 'user-003': 'อาจารย์สมชาย', 'user-004': 'มะลิ', 'user-005': 'ต้นกล้า' } as Record<string, string>)[id] ?? id,
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

function dm(over: Partial<Channel> = {}): Channel {
  return {
    id: 'dm-1',
    kind: 'DM',
    name: null,
    courseTag: null,
    maxSeats: 2,
    memberCount: 2,
    myRole: 'MEMBER',
    unreadCount: 2,
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

function msg(over: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    seq: 1,
    channelId: 'dm-1',
    authorCoreUserId: 'user-003',
    content: 'สวัสดี',
    attachments: [],
    embed: null,
    parentId: null,
    replyCount: 0,
    pinnedAt: null,
    pinnedByCoreUserId: null,
    clientNonce: 'n-1',
    editedAt: null,
    createdAt: '2026-09-29T02:00:00.000Z',
    ...over,
  };
}

const page = (items: Message[]) => ({
  items,
  meta: { total: items.length, page: 1, limit: 50, totalPages: 1 },
});

function setup(
  props: Partial<Parameters<typeof DirectThread>[0]> = {},
  channel = dm(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  client.setQueryData(CHANNELS_KEY, [
    dm({ id: 'dm-0', peerCoreUserId: 'user-009', unreadCount: 0 }),
    channel,
  ]);

  const view = render(
    <QueryClientProvider client={client}>
      <DirectThread channel={channel} {...props} />
    </QueryClientProvider>,
  );

  return { client, ...view };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  socketMock.connect.mockReset();
  socketMock.emitWithAck.mockReset();
  socketMock.handlers = {};
  startCall.mockReset();

  api.post.mockResolvedValue({});
  api.get.mockResolvedValue([]);
  // ค่าเริ่มต้น: ต่อ socket ไม่ได้ → ต้องตกไปใช้ REST
  socketMock.connect.mockRejectedValue(new Error('offline'));
});

describe('ตัวช่วยแคช', () => {
  it('ข้อความใหม่ → ห้องขึ้นบนสุด พร้อมตัวอย่างข้อความใหม่', () => {
    const next = withIncoming(
      [dm({ id: 'a' }), dm({ id: 'dm-1' })],
      msg({ content: null, attachments: [{ id: 'x', fileName: 'a.png', kind: 'IMAGE', mimeType: 'image/png', sizeBytes: '1' }] }),
    );

    expect(next?.map((row) => row.id)).toEqual(['dm-1', 'a']);
    expect(next?.[0].lastMessage).toEqual({
      seq: 1,
      content: null,
      authorCoreUserId: 'user-003',
      attachmentCount: 1,
      createdAt: '2026-09-29T02:00:00.000Z',
    });
  });

  it('ข้อความที่มาช้ากว่าไม่ทับตัวอย่างที่ใหม่กว่า · คำตอบในเธรดไม่นับ', () => {
    const channels = [
      dm({
        lastMessage: {
          content: 'ใหม่กว่า',
          authorCoreUserId: 'user-003',
          attachmentCount: 0,
          createdAt: '2026-09-29T09:00:00.000Z',
        },
      }),
    ];

    expect(withIncoming(channels, msg())).toBe(channels);
    expect(withIncoming(channels, msg({ parentId: 'p', createdAt: '2026-09-30T00:00:00Z' }))).toBe(channels);
  });

  it('อ่านแล้ว → ตัวเลขค้างของห้องนั้นเป็นศูนย์ ห้องอื่นไม่แตะ', () => {
    const next = withRead([dm({ id: 'a', unreadCount: 4 }), dm()], 'dm-1');

    expect(next?.map((row) => row.unreadCount)).toEqual([4, 0]);
  });

  it('ของจริงแทนตัวชั่วคราวที่ nonce ตรงกัน ไม่ต่อท้ายซ้ำ', () => {
    const pending = msg({ id: 'pending-n-9', clientNonce: 'n-9' });
    const real = msg({ id: 'm-9', clientNonce: 'n-9' });

    expect(replacePending([pending], real)).toEqual([real]);
    expect(replacePending([real], real)).toEqual([real]);
  });
});

describe('DirectThread', () => {
  it('ประวัติเรียงเก่า→ใหม่ มีป้ายเวลาคั่นเมื่อห่างเกิน 15 นาที และหัวบทสนทนาบอกว่าคุยกับใคร', async () => {
    api.list.mockResolvedValue(
      // หลังบ้านส่งใหม่สุดก่อน
      page([
        msg({ id: 'm-3', seq: 3, content: 'สาม', createdAt: '2026-09-29T03:00:00Z' }),
        msg({ id: 'm-2', seq: 2, content: 'สอง', createdAt: '2026-09-29T02:05:00Z', authorCoreUserId: 'user-002' }),
        msg({ id: 'm-1', seq: 1, content: 'หนึ่ง', createdAt: '2026-09-29T02:00:00Z' }),
      ]),
    );

    setup();

    const list = await screen.findByRole('list', { name: 'ข้อความ' });
    const text = list.textContent ?? '';

    expect(text.indexOf('หนึ่ง')).toBeLessThan(text.indexOf('สอง'));
    expect(text.indexOf('สอง')).toBeLessThan(text.indexOf('สาม'));
    // 02:00 และ 03:00 ขึ้นป้าย · 02:05 อยู่กลุ่มเดียวกับ 02:00
    expect(list.querySelectorAll('li[aria-hidden]')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'ดูโปรไฟล์' })).toHaveAttribute(
      'href',
      '/profile/user-003',
    );
  });

  it('**รายงานการอ่านถึงข้อความล่าสุด** แล้วจุดยังไม่อ่านในแคชหายทันที', async () => {
    api.list.mockResolvedValue(page([msg({ seq: 7 })]));

    const { client } = setup();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/channels/dm-1/read-markers', { seq: 7 }),
    );
    await waitFor(() =>
      expect(
        client.getQueryData<Channel[]>(CHANNELS_KEY)?.find((row) => row.id === 'dm-1')
          ?.unreadCount,
      ).toBe(0),
    );
  });

  it('socket ต่อไม่ได้ → ส่งทาง REST ได้ และรายการซ้ายเห็นข้อความใหม่ทันที', async () => {
    api.list.mockResolvedValue(page([]));
    api.post.mockImplementation((path: string, body: { clientNonce: string; content: string }) =>
      path.endsWith('/messages')
        ? Promise.resolve(
            msg({
              id: 'm-new',
              seq: 5,
              authorCoreUserId: 'user-002',
              content: body.content,
              clientNonce: body.clientNonce,
              createdAt: '2026-09-29T05:00:00Z',
            }),
          )
        : Promise.resolve({}),
    );

    const { client } = setup();

    await screen.findByText(/ส่งผ่าน REST/);
    await userEvent.type(screen.getByLabelText('พิมพ์ข้อความ'), 'ส่งการบ้านแล้วครับ{Enter}');

    await waitFor(() => expect(screen.getByText('ส่งแล้ว')).toBeInTheDocument());
    expect(screen.getAllByText('ส่งการบ้านแล้วครับ')).toHaveLength(1);
    expect(api.post).toHaveBeenCalledWith(
      '/channels/dm-1/messages',
      expect.objectContaining({ channelId: 'dm-1', content: 'ส่งการบ้านแล้วครับ' }),
    );

    const cached = client.getQueryData<Channel[]>(CHANNELS_KEY);

    expect(cached?.[0].id).toBe('dm-1');
    expect(cached?.[0].lastMessage?.content).toBe('ส่งการบ้านแล้วครับ');
    // ช่องพิมพ์ว่างแล้ว ปุ่ม "ส่ง" หายไป กลับเป็นไอคอนแนบรูป
    expect(screen.getByLabelText('พิมพ์ข้อความ')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'ส่ง' })).not.toBeInTheDocument();
  });

  it('**ส่งผ่าน socket แล้ว broadcast กลับมา = ฟองเดียว** ไม่ซ้ำกับตัวชั่วคราว', async () => {
    api.list.mockResolvedValue(page([]));
    socketMock.connect.mockResolvedValue({ connected: true, emit: vi.fn() });
    socketMock.emitWithAck.mockResolvedValue({ ok: true });

    setup();

    await screen.findByText('user-003');
    await userEvent.type(screen.getByLabelText('พิมพ์ข้อความ'), 'ถึงแล้วครับ{Enter}');

    expect(await screen.findByText('กำลังส่ง…')).toBeInTheDocument();

    const sendCall = socketMock.emitWithAck.mock.calls.find(
      ([, event]) => event === 'message:send',
    );
    const nonce = (sendCall?.[2] as { clientNonce: string }).clientNonce;

    act(() =>
      socketMock.handlers['message:new'](
        msg({
          id: 'm-real',
          seq: 9,
          authorCoreUserId: 'user-002',
          content: 'ถึงแล้วครับ',
          clientNonce: nonce,
        }),
      ),
    );

    expect(screen.getAllByText('ถึงแล้วครับ')).toHaveLength(1);
    expect(screen.queryByText('กำลังส่ง…')).not.toBeInTheDocument();
    expect(await screen.findByText('ส่งแล้ว')).toBeInTheDocument();
    // ข้อความจริงมี id แล้ว → ไปขอยอดรีแอ็กชัน รอให้จบในเทสต์
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });

  it('ข้อความของอีกฝ่ายเข้ามาสด · ห้องอื่นไม่ปนเข้ามา', async () => {
    api.list.mockResolvedValue(page([]));
    socketMock.connect.mockResolvedValue({ connected: true, emit: vi.fn() });
    socketMock.emitWithAck.mockResolvedValue({ ok: true });

    setup();

    await waitFor(() => expect(socketMock.handlers['message:new']).toBeDefined());

    act(() => {
      socketMock.handlers['message:new'](msg({ id: 'x', channelId: 'other', content: 'ห้องอื่น' }));
      socketMock.handlers['message:new'](msg({ id: 'y', content: 'มาแล้ว' }));
    });

    expect(await screen.findByText('มาแล้ว')).toBeInTheDocument();
    expect(screen.queryByText('ห้องอื่น')).not.toBeInTheDocument();
    // รอยอดรีแอ็กชันของข้อความใหม่โหลดเสร็จ ไม่งั้น setState หลังเทสต์จบ
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });

  it('ปุ่มโทรเริ่มสายกับคู่สนทนาของห้องนี้', async () => {
    api.list.mockResolvedValue(page([]));

    setup();

    await userEvent.click(screen.getByRole('button', { name: 'โทรด้วยเสียง' }));

    expect(startCall).toHaveBeenCalledWith('dm-1', 'user-003', { kind: 'AUDIO' });

    await userEvent.click(screen.getByRole('button', { name: 'โทรวิดีโอ' }));

    expect(startCall).toHaveBeenLastCalledWith('dm-1', 'user-003', { kind: 'VIDEO' });
  });

  it('หน้าต่างลอย: มีปุ่มกลับ ขยาย ปิด · รายละเอียดเปิดทับในหน้าต่าง', async () => {
    api.list.mockResolvedValue(page([]));

    const onBack = vi.fn();
    const onClose = vi.fn();
    const onExpand = vi.fn();

    setup({ variant: 'dock', onBack, onClose, onExpand });

    await userEvent.click(screen.getByRole('button', { name: 'กลับไปรายการข้อความ' }));
    await userEvent.click(screen.getByRole('button', { name: 'เปิดเต็มหน้า' }));
    await userEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่างแชท' }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onExpand).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดบทสนทนา' }));
    expect(screen.getByRole('complementary', { name: 'รายละเอียดบทสนทนา' })).toHaveClass('absolute');
  });

  it('หน้าเต็ม: ปุ่ม i เปิด/ปิดแผงรายละเอียดที่มีสมาชิกจริงของห้อง', async () => {
    api.list.mockResolvedValue(page([]));

    setup();

    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดบทสนทนา' }));

    const panel = screen.getByRole('complementary', { name: 'รายละเอียดบทสนทนา' });

    expect(panel).toHaveTextContent('อาจารย์สมชาย');
    expect(panel).toHaveTextContent('user-002 (คุณ)');
  });
});

describe('ติดล่างสุดระหว่างรูปโหลด', () => {
  /// jsdom ไม่มี layout — จำลองกรอบเลื่อนเอง: ความสูงเนื้อหาปรับได้ และ
  /// ResizeObserver ที่เรายิง callback ได้ตามต้องการ (แทน "รูปโหลดเสร็จแล้วกล่องสูงขึ้น")
  const observers: (() => void)[] = [];
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  async function openThread() {
    api.list.mockResolvedValue(page([msg({ content: 'ข้อความล่าสุด' })]));
    setup();
    await screen.findByText('ข้อความล่าสุด');

    const list = screen
      .getByRole('list', { name: 'ข้อความ' })
      .closest('.overflow-y-auto') as HTMLDivElement;
    const box = { height: 1000, top: 600 };

    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => box.height });
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => box.top,
      set: (value: number) => {
        box.top = Math.min(value, box.height - 400);
      },
    });

    // รูปโหลดเสร็จ: กล่องสูงขึ้น แล้วบอกทุกตัวที่เฝ้าขนาดอยู่
    const grow = (by: number) =>
      act(() => {
        box.height += by;
        observers.forEach((notify) => notify());
      });

    return { list, box, grow };
  }

  it('**scroll event จากเบราว์เซอร์ (ไม่ใช่ผู้ใช้) ไม่ปลดการติดล่างสุด** — รูปโหลดแล้วยังเห็นข้อความล่าสุด', async () => {
    const { list, box, grow } = await openThread();

    // scroll anchoring: เบราว์เซอร์ขยับเองหลังกล่องสูงขึ้น 171px ก่อน ResizeObserver
    // ได้ทำงาน — ตำแหน่งตอนนั้นดูเหมือน "ผู้ใช้เลื่อนขึ้นไป" ทั้งที่ไม่มีใครแตะ
    box.height = 1171;
    fireEvent.scroll(list);
    grow(0);

    expect(box.top).toBe(box.height - 400);

    grow(300);
    expect(box.top).toBe(box.height - 400);
  });

  it('ผู้ใช้เลื่อนขึ้นไปอ่านของเก่าเอง → รูปที่โหลดเสร็จไม่กระชากกลับลงมา', async () => {
    const { list, box, grow } = await openThread();

    fireEvent.wheel(list, { deltaY: -300 });
    box.top = 100;
    fireEvent.scroll(list);
    grow(300);

    expect(box.top).toBe(100);

    // เลื่อนกลับลงมาถึงล่างสุดเอง = ติดล่างสุดอีกครั้ง
    box.top = box.height - 400;
    fireEvent.scroll(list);
    grow(200);

    expect(box.top).toBe(box.height - 400);
  });

  it('เบราว์เซอร์ที่ไม่มี ResizeObserver ยังตามลงล่างเมื่อรูป/วิดีโอโหลดเสร็จ', async () => {
    const { list, box } = await openThread();

    box.height = 1500;
    // load ไม่ bubble แต่ผ่านช่วง capture ของกล่องเนื้อหา
    fireEvent.load(screen.getByRole('list', { name: 'ข้อความ' }));

    expect(box.top).toBe(1100);
    expect(list.scrollTop).toBe(1100);
  });
});

describe('รายละเอียดแบบ IG', () => {
  it('**"เห็นแล้ว"** เมื่ออีกฝ่ายอ่านถึงข้อความสุดท้ายของเรา · ไม่ถึง = "ส่งแล้ว"', async () => {
    api.list.mockResolvedValue(
      page([msg({ id: 'm-9', seq: 9, authorCoreUserId: 'user-002', content: 'ถึงยัง' })]),
    );

    const { unmount } = setup({}, dm({ peerLastReadSeq: 9 }));

    expect(await screen.findByText('เห็นแล้ว')).toBeInTheDocument();
    unmount();

    setup({}, dm({ peerLastReadSeq: 8 }));

    expect(await screen.findByText('ส่งแล้ว')).toBeInTheDocument();
    expect(screen.queryByText('เห็นแล้ว')).not.toBeInTheDocument();
  });

  it('อิโมจิล้วนขึ้นตัวใหญ่ไม่มีฟอง · ข้อความปกติอยู่ในฟอง', async () => {
    api.list.mockResolvedValue(
      page([
        msg({ id: 'm-2', seq: 2, content: '🎉🔥', createdAt: '2026-09-29T02:01:00Z' }),
        msg({ id: 'm-1', seq: 1, content: 'ยินดีด้วย' }),
      ]),
    );

    setup();

    expect(await screen.findByText('🎉🔥')).toHaveClass('text-[2.75rem]');
    expect(screen.getByText('ยินดีด้วย')).toHaveClass('rounded-[22px]');
  });

  it('ข้อความเสียง (AUDIO) ขึ้นเป็นฟองเล่นเสียง ไม่ใช่การ์ดไฟล์', async () => {
    api.list.mockResolvedValue(
      page([
        msg({
          content: null,
          attachments: [
            { id: 'a-1', fileName: 'voice.webm', kind: 'AUDIO', mimeType: 'audio/webm', sizeBytes: '3000' },
          ],
        }),
      ]),
    );

    setup();

    expect(await screen.findByRole('button', { name: 'เล่นข้อความเสียง' })).toBeInTheDocument();
    expect(screen.queryByText('voice.webm')).not.toBeInTheDocument();
  });

  it('แชทกลุ่ม: โทรหาทุกคนในกลุ่ม · ชื่อกลุ่มบนหัว · ชื่อคนส่งเหนือฟองของคนอื่น', async () => {
    const group = dm({
      kind: 'GROUP_DM',
      name: 'ติวสอบ DS',
      peerCoreUserId: null,
      memberCoreUserIds: ['user-002', 'user-004', 'user-005'],
    });

    api.list.mockResolvedValue(page([msg({ authorCoreUserId: 'user-004', content: 'ใครว่างบ้าง' })]));

    setup({}, group);

    await screen.findByText('ใครว่างบ้าง');

    await userEvent.click(screen.getByRole('button', { name: 'โทรด้วยเสียง' }));
    expect(startCall).toHaveBeenCalledWith('dm-1', ['user-004', 'user-005'], { kind: 'AUDIO' });
    expect(screen.getByRole('banner')).toHaveTextContent('ติวสอบ DS');
    // หัวบทสนทนาของกลุ่ม (ถึงต้นบทสนทนาแล้ว) บอกจำนวนคน
    expect(screen.getByText('แชทกลุ่ม · 3 คน')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'ข้อความ' })).toHaveTextContent('มะลิ');
  });

  it('คำขอข้อความ: แถบ ลบ/ซ่อน/ยอมรับ เหนือช่องพิมพ์ · ยอมรับ = ย้ายไปกล่องหลัก', async () => {
    const request = dm({ inboxFolder: 'REQUEST' });

    api.list.mockResolvedValue(page([]));
    api.patch.mockResolvedValue({ ...request, inboxFolder: 'PRIMARY' });

    setup({}, request);

    expect(await screen.findByText(/ต้องการส่งข้อความถึงคุณ/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ยอมรับ' }));

    expect(api.patch).toHaveBeenCalledWith('/channels/dm-1/inbox', { folder: 'PRIMARY' });
  });

  it('ปุ่ม 😊 เปิดแผงอิโมจิแล้วแทรกที่ตำแหน่งเคอร์เซอร์', async () => {
    api.list.mockResolvedValue(page([]));

    setup();

    const input = screen.getByLabelText('พิมพ์ข้อความ') as HTMLTextAreaElement;

    await userEvent.type(input, 'สวัสดี');
    input.setSelectionRange(0, 0);
    fireEvent.select(input);

    await userEvent.click(screen.getByRole('button', { name: 'ใส่อิโมจิ' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'เลือกอีโมจิ' })).getByRole('button', { name: '😀' }),
    );

    expect(input).toHaveValue('😀สวัสดี');
  });

  it('เบราว์เซอร์ที่อัดเสียงไม่ได้ ไม่มีปุ่มไมค์ให้กด', async () => {
    api.list.mockResolvedValue(page([]));

    setup();

    await screen.findByLabelText('พิมพ์ข้อความ');
    // jsdom ไม่มี MediaRecorder
    expect(screen.queryByRole('button', { name: 'อัดข้อความเสียง' })).not.toBeInTheDocument();
  });

  it('แผงรายละเอียด: สวิตช์ปิดเสียง · ชื่อเล่น · บล็อก · รายงาน · ลบแชท ตามลำดับ IG', async () => {
    const channel = dm();

    api.list.mockResolvedValue(page([]));
    api.patch.mockResolvedValue({ ...channel, muted: true });

    setup({}, channel);

    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดบทสนทนา' }));
    await userEvent.click(screen.getByRole('switch', { name: 'ปิดเสียงข้อความ' }));

    expect(api.patch).toHaveBeenCalledWith('/channels/dm-1/inbox', { muted: true });

    const panel = screen.getByRole('complementary', { name: 'รายละเอียดบทสนทนา' });
    const actions = within(panel)
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((text) => ['ชื่อเล่น', 'บล็อก', 'รายงาน', 'ลบแชท'].includes(text ?? ''));

    expect(actions).toEqual(['ชื่อเล่น', 'บล็อก', 'รายงาน', 'ลบแชท']);
  });

  it('ตั้งชื่อเล่น: กดสมาชิก → ช่อง "ป้อนชื่อเล่น…" + ✓ → PUT nickname แล้วขึ้นหัวแชท', async () => {
    const channel = dm();

    api.list.mockResolvedValue(page([]));
    api.put.mockResolvedValue({ ...channel, nicknames: { 'user-003': 'อ.สมชาย' } });

    const { client } = setup({}, channel);

    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดบทสนทนา' }));
    await userEvent.click(screen.getByRole('button', { name: 'ชื่อเล่น' }));

    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('ชื่อเล่นจะปรากฏในแชทนี้เท่านั้น');
    await userEvent.click(within(dialog).getByRole('button', { name: /อาจารย์สมชาย/ }));
    await userEvent.type(within(dialog).getByPlaceholderText('ป้อนชื่อเล่น…'), 'อ.สมชาย');
    await userEvent.click(within(dialog).getByRole('button', { name: 'บันทึกชื่อเล่น' }));

    expect(api.put).toHaveBeenCalledWith('/channels/dm-1/members/user-003/nickname', {
      nickname: 'อ.สมชาย',
    });
    await waitFor(() =>
      expect(
        client.getQueryData<Channel[]>(CHANNELS_KEY)?.find((row) => row.id === 'dm-1')?.nicknames,
      ).toEqual({ 'user-003': 'อ.สมชาย' }),
    );
  });

  it('บล็อกต้องยืนยันด้วยข้อความแบบ IG แล้วยิง POST /blocks', async () => {
    api.list.mockResolvedValue(page([]));
    api.post.mockResolvedValue({ coreUserId: 'user-003', createdAt: 'now' });

    setup();

    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดบทสนทนา' }));
    await userEvent.click(screen.getByRole('button', { name: 'บล็อก' }));

    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('บล็อก อาจารย์สมชาย ไหม');
    await userEvent.click(within(dialog).getByRole('button', { name: 'บล็อก' }));

    expect(api.post).toHaveBeenCalledWith('/blocks', { coreUserId: 'user-003' });
    expect(await screen.findByText('คุณบล็อกบัญชีนี้แล้ว')).toBeInTheDocument();
  });
});

describe('รอบที่ 3 — เมนูข้อความ ตอบกลับ ส่งต่อ ชื่อเล่น บล็อก การโทร', () => {
  const mine = (over: Partial<Message> = {}) =>
    msg({
      id: 'm-mine',
      seq: 5,
      authorCoreUserId: 'user-002',
      content: 'ส่งการบ้านแล้วครับ',
      createdAt: new Date().toISOString(),
      ...over,
    });

  async function openMenu(text: string) {
    const row = (await screen.findByText(text)).closest('li') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: 'ตัวเลือกของข้อความ' }));

    return screen.findByRole('menu', { name: 'ตัวเลือกของข้อความ' });
  }

  it('⋮ ของข้อความเรา: แก้ไข · ส่งต่อ · คัดลอก · ปักหมุด · ยกเลิกการส่ง (DM ปักหมุดได้ทุกคนเหมือน IG)', async () => {
    api.list.mockResolvedValue(page([mine()]));

    setup();

    const menu = await openMenu('ส่งการบ้านแล้วครับ');

    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'แก้ไข',
      'ส่งต่อ',
      'คัดลอก',
      'ปักหมุด',
      'ยกเลิกการส่ง',
    ]);
  });

  it('⋮ ของข้อความอีกฝ่าย: ไม่มีแก้ไขและยกเลิกการส่ง · ผู้ดูแลห้องปักหมุดได้', async () => {
    api.list.mockResolvedValue(page([msg({ content: 'ประกาศ' })]));

    setup({}, dm({ myRole: 'MODERATOR' }));

    const menu = await openMenu('ประกาศ');

    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'ส่งต่อ',
      'คัดลอก',
      'ปักหมุด',
    ]);
  });

  it('**แก้ไข**: แถบ "กำลังแก้ไขข้อความ" · ช่องพิมพ์เติมข้อความเดิม · ✓ ยิง PATCH แล้วขึ้น "มีการแก้ไข"', async () => {
    api.list.mockResolvedValue(page([mine()]));
    api.patch.mockResolvedValue(
      mine({ content: 'ส่งการบ้านแล้วครับ (ฉบับแก้)', editedAt: new Date().toISOString() }),
    );

    setup();

    const menu = await openMenu('ส่งการบ้านแล้วครับ');

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'แก้ไข' }));

    expect(screen.getByText('กำลังแก้ไขข้อความ')).toBeInTheDocument();

    const input = screen.getByLabelText('พิมพ์ข้อความ');

    expect(input).toHaveValue('ส่งการบ้านแล้วครับ');
    await userEvent.type(input, ' (ฉบับแก้)');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    expect(api.patch).toHaveBeenCalledWith('/channels/dm-1/messages/m-mine', {
      content: 'ส่งการบ้านแล้วครับ (ฉบับแก้)',
    });
    expect(await screen.findByText('มีการแก้ไข')).toHaveClass('text-link');
    expect(screen.queryByText('กำลังแก้ไขข้อความ')).not.toBeInTheDocument();
  });

  it('คัดลอก → toast "คัดลอกแล้ว"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    api.list.mockResolvedValue(page([mine()]));

    setup();

    const menu = await openMenu('ส่งการบ้านแล้วครับ');

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'คัดลอก' }));

    expect(writeText).toHaveBeenCalledWith('ส่งการบ้านแล้วครับ');
    expect(await screen.findByRole('status')).toHaveTextContent('คัดลอกแล้ว');
  });

  it('**ยกเลิกการส่งต้องยืนยัน** แล้วยิง DELETE และข้อความหาย', async () => {
    api.list.mockResolvedValue(page([mine()]));
    api.del.mockResolvedValue(undefined);

    setup();

    const menu = await openMenu('ส่งการบ้านแล้วครับ');

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'ยกเลิกการส่ง' }));
    expect(api.del).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิกการส่ง' }));

    expect(api.del).toHaveBeenCalledWith('/channels/dm-1/messages/m-mine');
    await waitFor(() => expect(screen.queryByText('ส่งการบ้านแล้วครับ')).not.toBeInTheDocument());
  });

  /// พบตอนทดสอบกับ Core Hub จริง: ยกเลิกข้อความล่าสุดแล้ว แถวในกล่องข้อความยังโชว์
  /// "คุณ: <ข้อความที่ยกเลิก>" จนกว่าจะรีเฟรชหน้า
  it('ยกเลิกการส่งแล้ว ขอรายการห้องใหม่ — ตัวอย่างในกล่องข้อความไม่ค้างข้อความที่ยกเลิกไปแล้ว', async () => {
    api.list.mockResolvedValue(page([mine()]));
    api.del.mockResolvedValue(undefined);

    const { client } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const menu = await openMenu('ส่งการบ้านแล้วครับ');

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'ยกเลิกการส่ง' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'ยกเลิกการส่ง' }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: CHANNELS_KEY }));
  });

  it('ปักหมุดแล้วขึ้นแถบใต้หัวบทสนทนา และป้าย "ปักหมุดแล้ว" บนข้อความ', async () => {
    const target = msg({ content: 'สอบวันศุกร์' });

    api.list.mockResolvedValue(page([target]));
    api.put.mockResolvedValue({ ...target, pinnedAt: '2026-10-01T00:00:00Z' });

    setup({}, dm({ myRole: 'MODERATOR' }));

    const menu = await openMenu('สอบวันศุกร์');

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'ปักหมุด' }));

    expect(api.put).toHaveBeenCalledWith('/channels/dm-1/messages/m-1/pin');
    expect(
      await screen.findByRole('button', { name: /ข้อความที่ปักหมุด: สอบวันศุกร์/ }),
    ).toBeInTheDocument();
    // ป้ายบนข้อความ + toast ยืนยัน
    expect(screen.getAllByText('ปักหมุดแล้ว').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('status')).toHaveTextContent('ปักหมุดแล้ว');
  });

  it('**ตอบกลับ**: แถบ "กำลังตอบกลับ …" แล้วส่งพร้อม replyToMessageId · ป้าย "คุณตอบกลับ …"', async () => {
    api.list.mockResolvedValue(page([msg({ content: 'ติดข้อไหน' })]));
    api.post.mockImplementation((path: string, body: { clientNonce: string; content: string }) =>
      path.endsWith('/messages')
        ? Promise.resolve(
            mine({
              id: 'm-reply',
              content: body.content,
              clientNonce: body.clientNonce,
              replyTo: {
                id: 'm-1',
                authorCoreUserId: 'user-003',
                preview: 'ติดข้อไหน',
                attachmentKind: null,
                deleted: false,
              },
            }),
          )
        : Promise.resolve({}),
    );

    setup();

    const row = (await screen.findByText('ติดข้อไหน')).closest('li') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: 'ตอบกลับ' }));
    expect(screen.getByText('กำลังตอบกลับ อาจารย์สมชาย')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('พิมพ์ข้อความ'), 'ข้อ 3.2 ครับ{Enter}');

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/channels/dm-1/messages',
        expect.objectContaining({ content: 'ข้อ 3.2 ครับ', replyToMessageId: 'm-1' }),
      ),
    );
    expect(await screen.findByText(/คุณตอบกลับ/)).toHaveTextContent('คุณตอบกลับ อาจารย์สมชาย');
    expect(screen.queryByText(/กำลังตอบกลับ/)).not.toBeInTheDocument();
  });

  it('**ส่งต่อ**: กล่อง "ส่งต่อ" ปุ่มส่งกดไม่ได้จนกว่าจะเลือก · ยิง POST /forwards', async () => {
    api.list.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/channels?')
          ? page([dm({ id: 'dm-0', peerCoreUserId: 'user-009', unreadCount: 0 }) as never])
          : path.startsWith('/channels/dm-1/messages?')
            ? page([mine()])
            : page([]),
      ),
    );
    api.post.mockResolvedValue({ channelIds: ['dm-0'], messageIds: ['x'] });

    setup();

    const menu = await openMenu('ส่งการบ้านแล้วครับ');

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'ส่งต่อ' }));

    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'ส่ง' });

    expect(send).toBeDisabled();
    // แชทล่าสุดมาจากแคชรายการห้อง (ไม่มีแถวสมมติ)
    await userEvent.click(within(dialog).getByRole('button', { name: /user-009/ }));
    await userEvent.click(send);

    expect(api.post).toHaveBeenCalledWith('/channels/dm-1/messages/m-mine/forwards', {
      channelIds: ['dm-0'],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('ส่งต่อแล้ว');
  });

  it('ข้อความที่ส่งต่อมามีป้าย "ส่งต่อแล้ว"', async () => {
    api.list.mockResolvedValue(page([msg({ content: 'ประกาศจากกลุ่ม', forwarded: true })]));

    setup();

    expect(await screen.findByText('ส่งต่อแล้ว')).toBeInTheDocument();
  });

  it('ชื่อเล่นของห้องแทนชื่อที่แสดงบนหัวบทสนทนา', async () => {
    api.list.mockResolvedValue(page([]));

    setup({}, dm({ nicknames: { 'user-003': 'อ.สมชาย' } }));

    expect(await screen.findByRole('banner')).toHaveTextContent('อ.สมชาย');
  });

  it('**บล็อกแล้ว = ช่องพิมพ์กลายเป็น "คุณบล็อกบัญชีนี้แล้ว"** · เลิกบล็อกยิง DELETE /blocks', async () => {
    api.list.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/blocks') ? page([{ coreUserId: 'user-003' } as never]) : page([])),
    );
    api.del.mockResolvedValue(undefined);

    setup();

    expect(await screen.findByText('คุณบล็อกบัญชีนี้แล้ว')).toBeInTheDocument();
    expect(screen.queryByLabelText('พิมพ์ข้อความ')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'เลิกบล็อก' }));

    expect(api.del).toHaveBeenCalledWith('/blocks/user-003');
    expect(await screen.findByLabelText('พิมพ์ข้อความ')).toBeInTheDocument();
  });

  it('สถานะใต้ชื่อ: "ใช้งานเมื่อ … ที่แล้ว" จาก GET /presence', async () => {
    api.list.mockResolvedValue(page([]));
    socketMock.connect.mockResolvedValue({ connected: true, emit: vi.fn() });
    socketMock.emitWithAck.mockResolvedValue({ ok: true });
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/presence')
          ? {
              users: [
                {
                  coreUserId: 'user-003',
                  online: false,
                  lastActiveAt: new Date(Date.now() - 5 * 60_000).toISOString(),
                },
              ],
            }
          : [],
      ),
    );

    setup();

    expect(await screen.findByText('ใช้งานเมื่อ 5 นาทีที่แล้ว')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/presence?ids=user-003');
  });

  it('**การ์ดการโทร**: ไม่ได้รับสาย = แดง · ไม่มีเมนู ⋮ · "โทรกลับ" เริ่มสายจริงด้วยชนิดเดิม', async () => {
    api.list.mockResolvedValue(
      page([
        msg({
          content: null,
          callLog: {
            media: 'VIDEO',
            status: 'MISSED',
            durationSec: null,
            callerCoreUserId: 'user-003',
            startedAt: '2026-10-01T03:00:00Z',
            endedAt: '2026-10-01T03:00:45Z',
          },
        }),
      ]),
    );

    setup();

    const title = await screen.findByText('ไม่ได้รับสาย');
    const row = title.closest('li') as HTMLElement;

    expect(title).toHaveClass('text-destructive');
    expect(within(row).queryByRole('button', { name: 'ตัวเลือกของข้อความ' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'ตอบกลับ' })).not.toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'โทรกลับ' }));

    expect(startCall).toHaveBeenCalledWith('dm-1', 'user-003', { kind: 'VIDEO' });
  });

  it('**สายที่ยังไม่จบ (endedAt = null) = "กำลังโทร…"** ไม่อ่าน status · ไม่มีโทรกลับ · อัปเดตสดด้วย message:updated', async () => {
    const ringing = msg({
      id: 'm-call',
      content: null,
      callLog: {
        media: 'AUDIO',
        status: 'MISSED',
        durationSec: null,
        callerCoreUserId: 'user-003',
        startedAt: '2026-10-01T03:00:00Z',
        endedAt: null,
      },
    });

    api.list.mockResolvedValue(page([ringing]));
    socketMock.connect.mockResolvedValue({ connected: true, emit: vi.fn() });
    socketMock.emitWithAck.mockResolvedValue({ ok: true });

    setup();

    expect(await screen.findByText('กำลังโทร…')).not.toHaveClass('text-destructive');
    expect(screen.queryByText('ไม่ได้รับสาย')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'โทรกลับ' })).not.toBeInTheDocument();

    await waitFor(() => expect(socketMock.handlers['message:updated']).toBeDefined());
    act(() =>
      socketMock.handlers['message:updated']({
        ...ringing,
        callLog: { ...ringing.callLog!, status: 'ANSWERED', durationSec: 42, endedAt: '2026-10-01T03:00:42Z' },
      }),
    );

    expect(await screen.findByText('การโทรด้วยเสียง')).toBeInTheDocument();
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โทรกลับ' })).toBeInTheDocument();
  });

  it('การ์ดการโทรที่รับสายแล้วบอกความยาว mm:ss', async () => {
    api.list.mockResolvedValue(
      page([
        msg({
          content: null,
          callLog: {
            media: 'AUDIO',
            status: 'ANSWERED',
            durationSec: 125,
            callerCoreUserId: 'user-002',
            startedAt: '2026-10-01T03:00:00Z',
            endedAt: '2026-10-01T03:02:05Z',
          },
        }),
      ]),
    );

    setup();

    expect(await screen.findByText('การโทรด้วยเสียง')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('การ์ดแชร์โพสต์: เปิดของจริง · ถูกลบไปแล้ว = "ข้อความนี้ไม่พร้อมใช้งาน"', async () => {
    api.list.mockResolvedValue(
      page([
        msg({
          id: 'm-2',
          seq: 2,
          content: null,
          createdAt: '2026-09-29T02:01:00Z',
          embed: { kind: 'POST', refId: 'p-1', targetId: 'p-1', authorCoreUserId: 'user-004', title: 'สรุปบทที่ 3', preview: 'สูตรสำคัญ', thumbnailUrl: null, thumbnailKind: null, available: true },
        }),
        msg({
          id: 'm-1',
          seq: 1,
          content: null,
          embed: { kind: 'REEL', refId: 'r-1', targetId: 'r-1', authorCoreUserId: null, title: null, preview: null, thumbnailUrl: null, thumbnailKind: null, available: false },
        }),
      ]),
    );

    setup();

    expect(await screen.findByRole('link', { name: 'เปิดโพสต์: สรุปบทที่ 3' })).toHaveAttribute('href', '/p/p-1');
    expect(screen.getByText('ข้อความนี้ไม่พร้อมใช้งาน')).toBeInTheDocument();
  });

  it('ตอบกลับสตอรี่: "ตอบกลับสตอรี่ของคุณ" + อิโมจิตัวใหญ่', async () => {
    api.list.mockResolvedValue(
      page([
        msg({
          content: null,
          storyReply: { kind: 'REACTION', emoji: '🔥' },
          embed: { kind: 'STORY', refId: 's-1', targetId: 's-1', authorCoreUserId: 'user-002', title: null, preview: null, thumbnailUrl: null, thumbnailKind: 'IMAGE', available: true },
        }),
      ]),
    );

    setup();

    expect(await screen.findByText(/ตอบกลับสตอรี่ของคุณ/)).toBeInTheDocument();
    expect(screen.getByText('🔥')).toHaveClass('text-[2.75rem]');
  });

  it('สติกเกอร์: แผงสองแท็บ (สติกเกอร์ · GIF) · กดสติกเกอร์ = ส่งเป็นอิโมจิ', async () => {
    api.list.mockResolvedValue(page([]));
    api.post.mockImplementation((path: string, body: { clientNonce: string; content: string }) =>
      path.endsWith('/messages')
        ? Promise.resolve(mine({ id: 'm-st', content: body.content, clientNonce: body.clientNonce }))
        : Promise.resolve({}),
    );

    setup();

    await userEvent.click(screen.getByRole('button', { name: 'สติกเกอร์และ GIF' }));

    const panel = await screen.findByRole('dialog', { name: 'สติกเกอร์และ GIF' });

    expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['สติกเกอร์', 'GIF']);
    await userEvent.click(await within(panel).findByRole('button', { name: 'ส่งสติกเกอร์ 🥳' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/channels/dm-1/messages',
        expect.objectContaining({ content: '🥳' }),
      ),
    );
  });
});

describe('รีแอ็กชันสด', () => {
  it('**broadcast ของคนอื่นไม่ทำให้เรากลายเป็นคนกด** · ของเราเองจากอีกแท็บเชื่อตามนั้น', async () => {
    api.list.mockResolvedValue(page([msg({ content: 'สวัสดี' })]));
    api.get.mockResolvedValue([]);
    socketMock.connect.mockResolvedValue({ connected: true, emit: vi.fn() });
    socketMock.emitWithAck.mockResolvedValue({ ok: true });

    setup();

    await screen.findByText('สวัสดี');
    await waitFor(() => expect(socketMock.handlers['reaction:changed']).toBeDefined());

    const broadcast = (actor: string) =>
      act(() =>
        socketMock.handlers['reaction:changed']({
          channelId: 'dm-1',
          targetKind: 'MESSAGE',
          targetId: 'm-1',
          totalCount: 1,
          totals: [{ emoji: '❤️', count: 1, reactedByMe: true }],
          actorCoreUserId: actor,
        }),
      );

    broadcast('user-003');
    await userEvent.click(screen.getByRole('button', { name: /^รีแอ็กชัน ❤️ 1/ }));
    expect(screen.getByRole('button', { name: '❤️' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.keyboard('{Escape}');

    broadcast('user-002');
    await userEvent.click(screen.getByRole('button', { name: /^รีแอ็กชัน ❤️ 1/ }));
    expect(screen.getByRole('button', { name: 'ถอน ❤️' })).toHaveAttribute('aria-pressed', 'true');
  });
});
