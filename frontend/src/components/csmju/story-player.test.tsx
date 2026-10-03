import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StoryPlayer, type PlayerItem } from './story-player';

/// เทสต์ตัวเล่นไฮไลต์/คลังสตอรี่เต็มจอ
///
/// ต้องทำตัวเหมือนสตอรี่ของ Instagram: แตะขวาไปต่อ · หมดแล้วปิด · Esc ปิด ·
/// และ "ลบ" ต้องถามก่อนเสมอ (กล่องยืนยันอยู่ข้างในตัวเล่น ไม่หลุดโฟกัส)

vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: 'นักศึกษา' }),
}));

const items: PlayerItem[] = [
  { id: 's1', kind: 'IMAGE', src: 'https://files.test/1.png', caption: 'ชิ้นแรก', createdAt: '2026-09-30T00:00:00Z' },
  { id: 's2', kind: 'IMAGE', src: 'https://files.test/2.png', caption: 'ชิ้นที่สอง', createdAt: '2026-09-30T01:00:00Z' },
];

describe('ตัวเล่นสตอรี่', () => {
  it('แตะขวาไปชิ้นถัดไป และแตะชิ้นสุดท้ายแล้วปิด', async () => {
    const onClose = vi.fn();

    render(<StoryPlayer items={items} ownerCoreUserId="user-002" title="เที่ยวทะเล" onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'ไฮไลต์ เที่ยวทะเล' })).toBeInTheDocument();
    expect(screen.getByText('ชิ้นแรก')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ไปต่อ' }));
    expect(screen.getByText('ชิ้นที่สอง')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ย้อนกลับ' }));
    expect(screen.getByText('ชิ้นแรก')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ไปต่อ' }));
    await userEvent.click(screen.getByRole('button', { name: 'ไปต่อ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('เริ่มเล่นจากชิ้นที่กดในคลังได้ (startIndex)', () => {
    render(<StoryPlayer items={items} ownerCoreUserId="user-002" startIndex={1} onClose={vi.fn()} />);

    expect(screen.getByText('ชิ้นที่สอง')).toBeInTheDocument();
  });

  it('Esc ปิดตัวเล่น', () => {
    const onClose = vi.fn();

    render(<StoryPlayer items={items} ownerCoreUserId="user-002" onClose={onClose} />);

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('เดินไปชิ้นถัดไปเองเมื่อครบ 5 วินาที', async () => {
    vi.useFakeTimers();

    try {
      render(<StoryPlayer items={items} ownerCoreUserId="user-002" onClose={vi.fn()} />);

      await act(async () => {
        vi.advanceTimersByTime(5_300);
      });

      expect(screen.getByText('ชิ้นที่สอง')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('**เมนู ⋯ "ลบ" ถามก่อน** แล้วค่อยทำ · Esc ในกล่องยืนยันปิดแค่กล่อง', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <StoryPlayer
        items={items}
        ownerCoreUserId="user-002"
        onClose={onClose}
        actions={[
          {
            label: 'ลบไฮไลท์',
            tone: 'danger',
            confirm: { title: 'ลบไฮไลท์นี้ใช่ไหม', body: 'กู้คืนไม่ได้', confirmLabel: 'ลบ' },
            onSelect: onDelete,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'ลบไฮไลท์' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'ลบไฮไลท์นี้ใช่ไหม' })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'ลบไฮไลท์' }));
    await userEvent.click(screen.getByRole('button', { name: 'ลบ' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
