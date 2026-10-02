import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StoryArchiveItem } from '@/lib/csmju/types';
import { ArchiveTile, DateBadge } from './story-archive';

/// เทสต์ช่องในคลังสตอรี่ — ป้ายวันที่มุมซ้ายบนแบบ Instagram และวงกลมติ๊กตอนเลือก

const item: StoryArchiveItem = {
  id: 's1',
  assetId: 'a1',
  mediaKind: 'VIDEO',
  mediaUrl: 'https://files.test/s1.mp4',
  caption: null,
  viewCount: 4,
  isExpired: true,
  createdAt: `${new Date().getFullYear()}-09-30T05:00:00Z`,
  expiresAt: '',
};

describe('คลังสตอรี่', () => {
  it('ป้ายวันที่ของปีนี้เป็น "30 ก.ย." ไม่มีปี · ปีอื่นต้องมีปี', () => {
    const { rerender } = render(<DateBadge iso={item.createdAt} />);

    expect(screen.getByLabelText('30 ก.ย.')).toBeInTheDocument();

    rerender(<DateBadge iso="2020-01-05T05:00:00Z" />);
    expect(screen.getByLabelText(/^5 ม\.ค\. .*2563/)).toBeInTheDocument();
  });

  it('วิดีโอใช้เฟรมแรกเป็นภาพย่อ และโหมดเลือกบอกสถานะด้วย aria-pressed', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ArchiveTile item={item} selected={false} onClick={onClick} />);
    const tile = screen.getByRole('button', { name: /^เลือกสตอรี่วันที่/ });

    expect(tile.querySelector('video')).toHaveAttribute('src', 'https://files.test/s1.mp4#t=0.1');
    expect(tile).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(tile);
    expect(onClick).toHaveBeenCalled();

    rerender(<ArchiveTile item={item} selected onClick={onClick} />);
    expect(screen.getByRole('button', { name: /^เลือกสตอรี่วันที่/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
