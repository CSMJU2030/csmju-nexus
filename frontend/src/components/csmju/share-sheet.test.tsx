import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareSheet, shareUrl } from './share-sheet';

/// เทสต์แผ่นแชร์แบบ Instagram
///
///   - ตาราง: แชทล่าสุดก่อน แล้วคนที่ติดตาม (ไม่ซ้ำคนที่มี DM อยู่แล้ว ไม่มีตัวเอง)
///   - ส่ง = POST /shares ด้วย channelIds (ห้องที่มี) + peerCoreUserIds (คนที่ยังไม่มีห้อง)
///   - แอปภายนอกใช้ URL แชร์ทางการเท่านั้น · Messenger/ดูทั้งหมด โผล่เฉพาะที่ใช้ได้จริง

const apiList = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, post: apiPost, get: vi.fn() },
  ApiError: class extends Error {},
  qs: (values: Record<string, string | number | undefined>) =>
    `?${new URLSearchParams(Object.entries(values).filter(([, v]) => v !== undefined) as [string, string][])}`,
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

const channel = (id: string, extra: Record<string, unknown>) => ({
  id,
  kind: 'DM',
  name: null,
  peerCoreUserId: null,
  inboxFolder: 'PRIMARY',
  ...extra,
});

const page = <T,>(items: T[]) => ({ items, meta: { total: items.length, page: 1, limit: 50, totalPages: 1 } });

beforeEach(() => {
  apiList.mockReset();
  apiPost.mockReset();
  apiList.mockImplementation(async (path: string) => {
    if (path.startsWith('/channels')) {
      return page([
        channel('ch-dm', { peerCoreUserId: 'user-003' }),
        channel('ch-group', { kind: 'GROUP_DM', name: 'ติวสอบ DS' }),
        channel('ch-room', { kind: 'GROUP', name: 'ห้องวิชา' }),
      ]);
    }

    if (path.startsWith('/follows/following')) {
      return page([{ coreUserId: 'user-003' }, { coreUserId: 'user-009' }, { coreUserId: 'user-002' }]);
    }

    return page([]);
  });
  apiPost.mockResolvedValue({ channelIds: ['ch-dm'], messageIds: ['m1'] });
});

afterEach(() => {
  document.querySelectorAll('[role=status]').forEach((node) => node.remove());
});

function renderSheet(kind: 'POST' | 'REEL' | 'STORY' = 'POST') {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ShareSheet open onClose={onClose} target={{ kind, id: 'target-1' }} />
    </QueryClientProvider>,
  );

  return { onClose };
}

describe('ลิงก์ของสิ่งที่แชร์', () => {
  it('เป็นที่อยู่เต็มของหน้าที่เปิดสิ่งนั้นได้จริง', () => {
    const origin = window.location.origin;

    expect(shareUrl({ kind: 'POST', id: 'p1' })).toBe(`${origin}/p/p1`);
    expect(shareUrl({ kind: 'REEL', id: 'r1' })).toBe(`${origin}/reels?reel=r1`);
    expect(shareUrl({ kind: 'STORY', id: 's1' })).toBe(`${origin}/feed?story=s1`);
  });
});

describe('แผ่นแชร์', () => {
  it('**แชทล่าสุดก่อน แล้วคนที่ติดตาม** — ไม่ซ้ำคนที่มี DM แล้ว · ไม่มีตัวเอง · ไม่มีห้องแชทแบบ Discord', async () => {
    renderSheet();

    const dialog = await screen.findByRole('dialog', { name: 'แชร์' });

    await waitFor(() => expect(within(dialog).getAllByRole('button', { pressed: false })).toHaveLength(3));

    const names = within(dialog)
      .getAllByRole('button', { pressed: false })
      .map((button) => button.getAttribute('aria-label'));

    expect(names).toEqual(['ชื่อ user-003', 'ติวสอบ DS', 'ชื่อ user-009']);
  });

  it('เลือกแล้วขึ้นติ๊กฟ้า + ช่องข้อความ + ปุ่มส่ง → POST /shares แล้ว "ส่งแล้ว"', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet('REEL');

    await user.click(await screen.findByRole('button', { name: 'ชื่อ user-003' }));
    await user.click(screen.getByRole('button', { name: 'ชื่อ user-009' }));

    expect(screen.getByRole('button', { name: 'ชื่อ user-003' })).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByRole('textbox', { name: 'เขียนข้อความ' }), 'ดูนี่');
    await user.click(screen.getByRole('button', { name: 'ส่ง' }));

    expect(apiPost).toHaveBeenCalledWith('/shares', {
      targetKind: 'REEL',
      targetId: 'target-1',
      channelIds: ['ch-dm'],
      peerCoreUserIds: ['user-009'],
      message: 'ดูนี่',
    });
    expect(await screen.findByText('ส่งแล้ว')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('ค้นหาด้วยชื่อที่แสดง กรองตาราง', async () => {
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('button', { name: 'ชื่อ user-003' });
    await user.type(screen.getByRole('textbox', { name: 'ค้นหาคนที่จะส่งให้' }), 'ติวสอบ');

    expect(screen.queryByRole('button', { name: 'ชื่อ user-003' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ติวสอบ DS' })).toBeInTheDocument();
  });

  it('**แอปภายนอกใช้ URL แชร์ทางการ** เปิดแท็บใหม่ · Messenger ไม่โผล่บนเดสก์ท็อป · ไม่มี navigator.share = ไม่มี "ดูทั้งหมด"', async () => {
    renderSheet();

    await screen.findByRole('dialog', { name: 'แชร์' });

    const url = encodeURIComponent(`${window.location.origin}/p/target-1`);
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

    expect(href('Facebook')).toBe(`https://www.facebook.com/sharer/sharer.php?u=${url}`);
    expect(href('WhatsApp')).toContain('https://wa.me/?text=');
    expect(href('อีเมล')).toMatch(/^mailto:\?subject=/);
    expect(href('Threads')).toContain('https://www.threads.net/intent/post?text=');
    expect(href('X')).toBe(`https://x.com/intent/post?text=${encodeURIComponent('ดูบน CS Nexus')}&url=${url}`);
    expect(screen.getByRole('link', { name: 'Facebook' })).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: 'Messenger' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ดูทั้งหมด' })).not.toBeInTheDocument();
  });

  it('คัดลอกลิงก์ → คลิปบอร์ด + "คัดลอกลิงก์แล้ว"', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    renderSheet('STORY');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await user.click(await screen.findByRole('button', { name: 'คัดลอกลิงก์' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/feed?story=target-1`);
    expect(await screen.findByText('คัดลอกลิงก์แล้ว')).toBeInTheDocument();
  });

  it('Esc ปิดแผ่น', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    await screen.findByRole('dialog', { name: 'แชร์' });
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
