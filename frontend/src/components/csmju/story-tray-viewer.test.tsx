import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryTray } from '@/lib/csmju/types';
import { QUICK_REACTIONS, StoryTrayViewer, firstUnseen } from './story-tray-viewer';

/// เทสต์ตัวดูสตอรี่แบบ Instagram
///
///   - การ์ดข้างของคนก่อน/ถัดไป กดแล้วกระโดดไปคนนั้น
///   - แตะช่องตอบกลับ = หยุด + รีแอ็กชันทันใจ 8 ตัว · กด = POST replies {emoji} · Enter = {content}
///   - ของฉัน: "เห็นแล้ว n คน" · ⋯ = ลบ / ดูข้อมูลเชิงลึก / เกี่ยวกับบัญชีนี้ / ยกเลิก (ไม่มีโปรโมท)

const apiList = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const apiDel = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, get: apiGet, post: apiPost, del: apiDel },
  ApiError: class extends Error {},
  qs: () => '',
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

const story = (id: string, author: string, viewed = false) => ({
  id,
  authorCoreUserId: author,
  kind: 'IMAGE' as const,
  mediaUrl: `http://files.local/${id}.jpg`,
  assetId: `asset-${id}`,
  caption: null,
  viewedByMe: viewed,
  viewCount: 3,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

const trays: StoryTray[] = [
  { authorCoreUserId: 'user-002', isMe: true, hasUnseen: false, stories: [story('mine', 'user-002')] },
  { authorCoreUserId: 'user-003', isMe: false, hasUnseen: true, stories: [story('s1', 'user-003', true), story('s2', 'user-003')] },
  { authorCoreUserId: 'user-004', isMe: false, hasUnseen: true, stories: [story('s3', 'user-004')] },
];

beforeEach(() => {
  for (const mock of [apiList, apiGet, apiPost, apiDel]) mock.mockReset();
  apiList.mockResolvedValue({
    items: [{ coreUserId: 'user-003', viewedAt: new Date().toISOString() }],
    meta: { total: 7, page: 1, limit: 20, totalPages: 1 },
  });
  apiGet.mockResolvedValue({ viewCount: 7, replyCount: 2, reactionCounts: { '😍': 3, '🔥': 1 } });
  apiPost.mockResolvedValue({ channelIds: ['c1'], messageIds: ['m1'] });
});

afterEach(() => {
  document.querySelectorAll('[role=status]').forEach((node) => node.remove());
});

function renderViewer(startTray: number) {
  const props = {
    onClose: vi.fn(),
    onViewed: vi.fn(),
    onMediaError: vi.fn(),
    onDeleted: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <StoryTrayViewer trays={trays} startTray={startTray} {...props} />
    </QueryClientProvider>,
  );

  return props;
}

describe('ตัวดูสตอรี่', () => {
  it('เปิดต่อจากชิ้นแรกที่ยังไม่ดู แบบ IG', () => {
    expect(firstUnseen(trays[1])).toBe(1);
    expect(firstUnseen(trays[0])).toBe(0);
  });

  it('**การ์ดข้างของคนก่อน/ถัดไป** กดแล้วกระโดดไปดูคนนั้น', async () => {
    const user = userEvent.setup();
    const props = renderViewer(1);

    expect(screen.getByRole('dialog', { name: 'สตอรี่ของ ชื่อ user-003' })).toBeInTheDocument();
    expect(props.onViewed).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));

    await user.click(screen.getByRole('button', { name: 'ดูสตอรี่ของ ชื่อ user-004' }));

    expect(screen.getByRole('dialog', { name: 'สตอรี่ของ ชื่อ user-004' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดูสตอรี่ของ ชื่อ user-002' })).toBeInTheDocument();
  });

  it('**แตะช่องตอบกลับ → "การแสดงความรู้สึกทันใจ" 8 ตัว** · กดตัวหนึ่ง = ส่ง REACTION', async () => {
    const user = userEvent.setup();
    renderViewer(1);

    await user.click(screen.getByRole('textbox', { name: 'ตอบกลับ ชื่อ user-003' }));

    expect(screen.getByText('การแสดงความรู้สึกทันใจ')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^ส่งรีแอ็กชัน / })).toHaveLength(QUICK_REACTIONS.length + 1);
    expect(QUICK_REACTIONS).toEqual(['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯']);

    await user.click(screen.getByRole('button', { name: 'ส่งรีแอ็กชัน 😍' }));

    expect(apiPost).toHaveBeenCalledWith('/stories/s2/replies', { emoji: '😍' });
    expect(await screen.findByText('ส่งแล้ว')).toBeInTheDocument();
  });

  it('พิมพ์แล้ว Enter = ส่ง REPLY', async () => {
    const user = userEvent.setup();
    renderViewer(1);

    await user.type(screen.getByRole('textbox', { name: 'ตอบกลับ ชื่อ user-003' }), 'สวยมาก{Enter}');

    expect(apiPost).toHaveBeenCalledWith('/stories/s2/replies', { content: 'สวยมาก' });
  });

  it('**ของฉัน: "เห็นแล้ว n คน"** · กดแล้วขึ้นรายชื่อผู้ชม · ไม่มีช่องตอบกลับ', async () => {
    const user = userEvent.setup();
    renderViewer(0);

    const seen = await screen.findByRole('button', { name: /เห็นแล้ว 7 คน/ });

    expect(screen.queryByRole('textbox', { name: /ตอบกลับ/ })).not.toBeInTheDocument();

    await user.click(seen);

    expect(await screen.findByRole('heading', { name: 'ผู้ชม' })).toBeInTheDocument();
    expect(apiList).toHaveBeenCalledWith('/stories/mine/viewers?page=1&limit=50');
  });

  it('**⋯ ของฉัน = ลบ · ดูข้อมูลเชิงลึก · เกี่ยวกับบัญชีนี้ · ยกเลิก** (ไม่มีโปรโมท) · ข้อมูลเชิงลึกเป็นตัวเลขจริง', async () => {
    const user = userEvent.setup();
    renderViewer(0);

    await user.click(screen.getByRole('button', { name: 'ตัวเลือกสตอรี่' }));

    for (const name of ['ลบ', 'ดูข้อมูลเชิงลึก', 'เกี่ยวกับบัญชีนี้', 'ยกเลิก']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/โปรโมท/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ดูข้อมูลเชิงลึก' }));

    expect(await screen.findByText('การตอบกลับ')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/stories/mine/insights');
    expect(screen.getByText('😍').parentElement).toHaveTextContent('3');
  });

  it('ลบสตอรี่ต้องยืนยันก่อน', async () => {
    const user = userEvent.setup();
    apiDel.mockResolvedValue(undefined);
    const props = renderViewer(0);

    await user.click(screen.getByRole('button', { name: 'ตัวเลือกสตอรี่' }));
    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(apiDel).not.toHaveBeenCalled();
    expect(screen.getByText('ลบสตอรี่ใช่ไหม')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ลบ' }));

    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/stories/mine'));
    expect(props.onDeleted).toHaveBeenCalled();
  });

  it('Esc ปิดแผงก่อน แล้วค่อยปิดตัวดู', async () => {
    const user = userEvent.setup();
    const props = renderViewer(0);

    await user.click(screen.getByRole('button', { name: 'ตัวเลือกสตอรี่' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: 'ดูข้อมูลเชิงลึก' })).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
  });
});
