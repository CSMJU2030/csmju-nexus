import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReelComment } from '@/lib/csmju/types';
import { ReelCommentsPanel } from './reel-comments-panel';

/// เทสต์แผงความคิดเห็นแบบ Instagram
///
/// ของที่พังง่ายและผู้ใช้เห็นทันที:
///   - ตอบคำตอบ → หลังบ้านคืน 400 ต้องผูกกับต้นเรื่องแล้วเติม @ชื่อ แทน
///   - หัวใจต้องแดงทันทีที่กด (ไม่รอหลังบ้าน) และคืนสภาพถ้าหลังบ้านปฏิเสธ
///   - ลบต้องยืนยันก่อน และปุ่ม ⋯ มีเฉพาะคนที่หลังบ้านยอมให้ลบ
///   - Esc ปิดแผง แต่ถ้ามีกล่องซ้อนอยู่ ต้องปิดกล่องนั้นก่อน

const apiList = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const apiDel = vi.hoisted(() => vi.fn());
const me = vi.hoisted(() => ({
  current: { id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' },
}));

vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, post: apiPost, del: apiDel, get: vi.fn() },
  ApiError: class extends Error {},
  qs: (values: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) search.set(key, String(value));
    }

    return search.size ? `?${search}` : '';
  },
}));
vi.mock('@/lib/csmju/session', () => ({ useMe: () => me.current }));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  UserName: ({ coreUserId }: { coreUserId: string }) => <span>ชื่อ {coreUserId}</span>,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ${coreUserId}` }),
}));
// แผงอิโมจิจริงมีเทสต์ของมันเอง — ที่นี่ต้องการแค่ "เลือกแล้วได้อิโมจิหนึ่งตัว"
vi.mock('@/components/csmju/emoji-picker', () => ({
  EmojiPopover: ({ open, onPick }: { open: boolean; onPick: (emoji: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick('😂')}>
        อิโมจิ 😂
      </button>
    ) : null,
}));

const comment = (id: string, extra: Partial<ReelComment> = {}): ReelComment => ({
  id,
  reelId: 'reel-1',
  authorCoreUserId: 'user-003',
  content: `ข้อความ ${id}`,
  parentId: null,
  replyCount: 0,
  likeCount: 0,
  likedByMe: false,
  createdAt: new Date().toISOString(),
  ...extra,
});

function page(items: ReelComment[]) {
  return { items, meta: { total: items.length, page: 1, limit: 20, totalPages: items.length ? 1 : 0 } };
}

let top: ReelComment[] = [];
let replies: ReelComment[] = [];

beforeEach(() => {
  me.current = { ...me.current, id: 'user-002', coreRole: 'student' };
  top = [];
  replies = [];
  apiList.mockReset();
  apiPost.mockReset();
  apiDel.mockReset();
  apiList.mockImplementation(async (path: string) =>
    page(path.includes('parentId=') ? replies : top),
  );
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onCountChange = vi.fn();

  render(
    <QueryClientProvider client={client}>
      <button type="button">ปุ่มก่อนเปิด</button>
      <ReelCommentsPanel
        reelId="reel-1"
        anchorRef={createRef()}
        frameRef={createRef()}
        onClose={onClose}
        onCountChange={onCountChange}
      />
    </QueryClientProvider>,
  );

  return { onClose, onCountChange };
}

describe('แผงความคิดเห็น', () => {
  it('ไม่มีความคิดเห็น → "ยังไม่มีความคิดเห็น" / "เริ่มการสนทนา" และปุ่มโพสต์กดไม่ได้', async () => {
    renderPanel();

    expect(await screen.findByText('ยังไม่มีความคิดเห็น')).toBeInTheDocument();
    expect(screen.getByText('เริ่มการสนทนา')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โพสต์' })).toBeDisabled();
  });

  it('แถว: ชื่อ + เวลา + ข้อความ + "ตอบกลับ" · "ถูกใจ n ครั้ง" เฉพาะเมื่อมากกว่า 0', async () => {
    top = [comment('c1', { likeCount: 3 }), comment('c2')];
    renderPanel();

    expect(await screen.findByText('ข้อความ c1')).toBeInTheDocument();
    expect(screen.getAllByText('ชื่อ user-003')).toHaveLength(2);
    expect(screen.getAllByText('เมื่อครู่')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'ตอบกลับ' })).toHaveLength(2);
    expect(screen.getByText('ถูกใจ 3 ครั้ง')).toBeInTheDocument();
    expect(screen.queryByText('ถูกใจ 0 ครั้ง')).not.toBeInTheDocument();
  });

  it('**หัวใจแดงทันทีที่กด** ก่อนหลังบ้านตอบ แล้วใช้ตัวเลขจริงจากหลังบ้าน', async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => {};

    top = [comment('c1')];
    apiPost.mockImplementation(() => new Promise((done) => (resolve = done)));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ถูกใจความคิดเห็น' }));

    const liked = screen.getByRole('button', { name: 'เลิกถูกใจความคิดเห็น' });

    expect(liked).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ถูกใจ 1 ครั้ง')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/reels/reel-1/comments/c1/likes');

    await act(async () => resolve({ likeCount: 5, likedByMe: true }));

    expect(await screen.findByText('ถูกใจ 5 ครั้ง')).toBeInTheDocument();
  });

  it('หลังบ้านปฏิเสธการถูกใจ → คืนสภาพเดิม', async () => {
    const user = userEvent.setup();

    top = [comment('c1', { likeCount: 2 })];
    apiPost.mockRejectedValue(new Error('ไม่ได้'));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ถูกใจความคิดเห็น' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ถูกใจความคิดเห็น' })).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(screen.getByText('ถูกใจ 2 ครั้ง')).toBeInTheDocument();
  });

  it('"ดูข้อความตอบกลับทั้งหมด n รายการ" → ขอคำตอบด้วย parentId แล้วกลายเป็น "ซ่อนข้อความตอบกลับ"', async () => {
    const user = userEvent.setup();

    top = [comment('c1', { replyCount: 2 })];
    replies = [
      comment('r1', { parentId: 'c1', content: 'คำตอบแรก' }),
      comment('r2', { parentId: 'c1', content: 'คำตอบสอง' }),
    ];
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /ดูข้อความตอบกลับทั้งหมด 2 รายการ/ }));

    expect(await screen.findByText('คำตอบแรก')).toBeInTheDocument();
    expect(apiList).toHaveBeenCalledWith(expect.stringContaining('parentId=c1'));
    expect(screen.getByRole('button', { name: /ซ่อนข้อความตอบกลับ/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ซ่อนข้อความตอบกลับ/ }));

    expect(screen.queryByText('คำตอบแรก')).not.toBeInTheDocument();
  });

  it('**ตอบคำตอบ → ผูกกับต้นเรื่อง (parentId ระดับบนสุด) + เติม @ชื่อ** แถบ "กำลังตอบกลับ" ขึ้น', async () => {
    const user = userEvent.setup();

    top = [comment('c1', { replyCount: 1 })];
    replies = [comment('r1', { parentId: 'c1', authorCoreUserId: 'user-009', content: 'คำตอบแรก' })];
    apiPost.mockResolvedValue(comment('r2', { parentId: 'c1', authorCoreUserId: 'user-002', content: '@ชื่อuser-009 เห็นด้วย' }));
    const { onCountChange } = renderPanel();

    await user.click(await screen.findByRole('button', { name: /ดูข้อความตอบกลับทั้งหมด/ }));
    await screen.findByText('คำตอบแรก');

    const replyRow = screen.getByText('คำตอบแรก').closest('li') as HTMLElement;

    await user.click(within(replyRow).getByRole('button', { name: 'ตอบกลับ' }));

    const input = screen.getByRole('textbox', { name: 'เพิ่มความคิดเห็น' });

    expect(input).toHaveValue('@ชื่อuser-009 ');
    expect(screen.getByText(/กำลังตอบกลับ/)).toHaveTextContent('กำลังตอบกลับ @ชื่อuser-009');

    await user.type(input, 'เห็นด้วย');
    await user.click(screen.getByRole('button', { name: 'โพสต์' }));

    expect(apiPost).toHaveBeenCalledWith('/reels/reel-1/comments', {
      content: '@ชื่อuser-009 เห็นด้วย',
      parentId: 'c1',
    });
    expect(await screen.findByText('@ชื่อuser-009 เห็นด้วย')).toBeInTheDocument();
    expect(onCountChange).toHaveBeenCalledWith(1);
    expect(screen.queryByText(/กำลังตอบกลับ/)).not.toBeInTheDocument();
  });

  it('✕ ที่แถบ "กำลังตอบกลับ" ยกเลิก และเอา @ชื่อ ออก', async () => {
    const user = userEvent.setup();

    top = [comment('c1')];
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'ตอบกลับ' }));
    await user.click(screen.getByRole('button', { name: 'ยกเลิกการตอบกลับ' }));

    expect(screen.getByRole('textbox', { name: 'เพิ่มความคิดเห็น' })).toHaveValue('');
    expect(screen.queryByText(/กำลังตอบกลับ/)).not.toBeInTheDocument();
  });

  it('โพสต์ความคิดเห็นใหม่ขึ้นบนสุด และแจ้งหน้าแม่ +1', async () => {
    const user = userEvent.setup();

    top = [comment('c1')];
    apiPost.mockResolvedValue(comment('c9', { authorCoreUserId: 'user-002', content: 'ใหม่ล่าสุด' }));
    const { onCountChange } = renderPanel();

    await screen.findByText('ข้อความ c1');
    await user.type(screen.getByRole('textbox', { name: 'เพิ่มความคิดเห็น' }), 'ใหม่ล่าสุด');
    await user.click(screen.getByRole('button', { name: 'โพสต์' }));

    expect(apiPost).toHaveBeenCalledWith('/reels/reel-1/comments', { content: 'ใหม่ล่าสุด' });

    const rows = await screen.findAllByText(/ข้อความ c1|ใหม่ล่าสุด/);

    expect(rows[0]).toHaveTextContent('ใหม่ล่าสุด');
    expect(onCountChange).toHaveBeenCalledWith(1);
  });

  it('😊 แทรกอีโมจิตรงตำแหน่งเคอร์เซอร์', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByRole('textbox', { name: 'เพิ่มความคิดเห็น' }) as HTMLInputElement;

    await user.type(input, 'ขำมาก');
    input.setSelectionRange(3, 3);
    await user.click(screen.getByRole('button', { name: 'แทรกอีโมจิ' }));
    await user.click(screen.getByRole('button', { name: 'อิโมจิ 😂' }));

    expect(input).toHaveValue('ขำม😂าก');
  });

  it('**⋯ มีเฉพาะความคิดเห็นของฉัน** (นักศึกษา) · ลบต้องยืนยัน · ต้นเรื่องหักยอดรวมคำตอบด้วย', async () => {
    const user = userEvent.setup();

    top = [
      comment('mine', { authorCoreUserId: 'user-002', replyCount: 2, content: 'ของฉัน' }),
      comment('theirs', { content: 'ของคนอื่น' }),
    ];
    apiDel.mockResolvedValue(undefined);
    const { onCountChange } = renderPanel();

    await screen.findByText('ของฉัน');

    expect(screen.getAllByRole('button', { name: 'ตัวเลือกความคิดเห็น' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'ตัวเลือกความคิดเห็น' }));
    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(apiDel).not.toHaveBeenCalled();
    expect(screen.getByText('ลบความคิดเห็นใช่ไหม')).toBeInTheDocument();
    expect(screen.getByText(/ข้อความตอบกลับ 2 รายการจะถูกลบไปด้วย/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(apiDel).toHaveBeenCalledWith('/reels/reel-1/comments/mine');
    await waitFor(() => expect(screen.queryByText('ของฉัน')).not.toBeInTheDocument());
    expect(onCountChange).toHaveBeenCalledWith(-3);
  });

  it('staff ลบความคิดเห็นของคนอื่นได้ (หลังบ้านยอม) จึงเห็น ⋯ ทุกแถว', async () => {
    me.current = { ...me.current, id: 'user-003', coreRole: 'staff' };
    top = [comment('a', { authorCoreUserId: 'user-009' }), comment('b', { authorCoreUserId: 'user-010' })];
    renderPanel();

    await screen.findByText('ข้อความ a');

    expect(screen.getAllByRole('button', { name: 'ตัวเลือกความคิดเห็น' })).toHaveLength(2);
  });

  it('Esc ปิดแผง · แต่ถ้าแผงอิโมจิเปิดอยู่ Esc ไม่ปิดทั้งแผง', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await screen.findByText('ยังไม่มีความคิดเห็น');
    await user.click(screen.getByRole('button', { name: 'แทรกอีโมจิ' }));
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'แทรกอีโมจิ' }));
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('แผงวาดผ่าน portal ที่ body และกักโฟกัสไว้ในแผง', async () => {
    const user = userEvent.setup();
    renderPanel();

    const panel = await screen.findByRole('dialog', { name: 'ความคิดเห็น' });

    expect(panel.parentElement).toBe(document.body);
    expect(panel).toHaveFocus();

    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(panel.contains(document.activeElement)).toBe(true);
    }
  });
});
