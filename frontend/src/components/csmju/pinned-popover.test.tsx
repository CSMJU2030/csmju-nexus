import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/lib/csmju/types';

vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (id: string) => ({ coreUserId: id, displayName: `ชื่อ-${id}`, avatarUrl: null, badge: null }),
}));

vi.mock('@/components/csmju/attachment-list', () => ({ AttachmentList: () => null }));

const { PinnedPopover } = await import('./pinned-popover');

const anchor = { rect: new DOMRect(500, 10, 20, 20) };

const pinned: Message = {
  id: 'm1',
  seq: 1,
  channelId: 'c1',
  authorCoreUserId: 'u1',
  content: 'ส่งงานวันศุกร์',
  attachments: [],
  embed: null,
  parentId: null,
  replyCount: 0,
  pinnedAt: '2026-10-01T00:00:00.000Z',
  pinnedByCoreUserId: 'u1',
  clientNonce: 'n',
  editedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('PinnedPopover', () => {
  it('ว่าง = ข้อความแบบ Discord พร้อมเคล็ดลับ', () => {
    render(
      <PinnedPopover
        open
        onClose={vi.fn()}
        anchor={anchor}
        pinned={[]}
        loading={false}
        canPin
        onJump={vi.fn()}
        onUnpin={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'ข้อความที่ปักหมุด' })).toHaveClass('animate-in', 'fade-in-0', 'zoom-in-95');
    expect(screen.getByText('ช่องนี้ยังไม่มีข้อความปักไว้เลย')).toBeInTheDocument();
    expect(screen.getByText('เคล็ดลับ:')).toBeInTheDocument();
  });

  it('มีหมุด = ไปที่ข้อความ / ถอนหมุด · Esc ปิด', async () => {
    const onJump = vi.fn();
    const onUnpin = vi.fn();
    const onClose = vi.fn();

    render(
      <PinnedPopover
        open
        onClose={onClose}
        anchor={anchor}
        pinned={[pinned]}
        loading={false}
        canPin
        onJump={onJump}
        onUnpin={onUnpin}
      />,
    );

    expect(screen.getByText('ส่งงานวันศุกร์')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ถอนหมุด' }));
    expect(onUnpin).toHaveBeenCalledWith(pinned);

    await userEvent.click(screen.getByRole('button', { name: 'ไปที่ข้อความ' }));
    expect(onJump).toHaveBeenCalledWith(pinned);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
