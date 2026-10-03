import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useModalFocus } from './use-modal-focus';

/// เทสต์การกักโฟกัสของกล่องที่วาดเอง
///
/// `role="dialog" aria-modal="true"` เป็นเพียง **คำสัญญา** กับโปรแกรมอ่าน
/// หน้าจอว่า "ข้างนอกถูกซ่อนแล้ว" ถ้าไม่ทำตาม จะแย่กว่าไม่ประกาศเลย เพราะ
/// ผู้ใช้จะเชื่อว่าตัวเองอยู่ในกล่อง ทั้งที่ Tab เดินออกไปข้างนอกได้จริง
///
/// ชุดนี้คุมทั้งสตอรี่ · แผ่นสายเรียกเข้า · เมนูเพิ่มเติมของแถบล่าง
/// เพราะทั้งสามใช้ hook ตัวเดียวกัน

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useModalFocus<HTMLDivElement>(open, () => {
    setOpen(false);
    onClose?.();
  });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        เปิดแผ่น
      </button>

      <button type="button">ปุ่มหลังฉาก</button>

      {open && (
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true">
          <button type="button">ปุ่มแรกในแผ่น</button>
          <button type="button">ปุ่มสุดท้ายในแผ่น</button>
        </div>
      )}
    </div>
  );
}

describe('useModalFocus', () => {
  it('เปิดแล้วโฟกัสย้ายเข้ามาในแผ่นทันที', async () => {
    // ไม่ย้าย = คนที่ใช้คีย์บอร์ดไม่รู้เลยว่ามีอะไรเปิดขึ้นมา
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดแผ่น' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ปุ่มแรกในแผ่น' })).toHaveFocus(),
    );
  });

  it('Tab จากปุ่มสุดท้ายวนกลับมาปุ่มแรก ไม่หลุดออกไปหลังฉาก', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดแผ่น' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ปุ่มแรกในแผ่น' })).toHaveFocus(),
    );

    await userEvent.tab();
    expect(
      screen.getByRole('button', { name: 'ปุ่มสุดท้ายในแผ่น' }),
    ).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'ปุ่มแรกในแผ่น' })).toHaveFocus();
  });

  it('Shift+Tab จากปุ่มแรกวนไปปุ่มสุดท้าย', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดแผ่น' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ปุ่มแรกในแผ่น' })).toHaveFocus(),
    );

    await userEvent.tab({ shift: true });

    expect(
      screen.getByRole('button', { name: 'ปุ่มสุดท้ายในแผ่น' }),
    ).toHaveFocus();
  });

  it('ปิดแล้วคืนโฟกัสให้ปุ่มที่กดเปิด', async () => {
    // ไม่คืน = โฟกัสร่วงไปที่ <body> ต้อง Tab ไล่ใหม่ตั้งแต่ต้นหน้า
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'เปิดแผ่น' });

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ปุ่มแรกในแผ่น' })).toHaveFocus(),
    );

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Escape เรียก onClose', async () => {
    const onClose = vi.fn();

    render(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดแผ่น' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ปุ่มแรกในแผ่น' })).toHaveFocus(),
    );

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ยังไม่เปิด = ไม่แตะโฟกัสของใคร', async () => {
    render(<Harness />);

    const behind = screen.getByRole('button', { name: 'ปุ่มหลังฉาก' });

    behind.focus();
    expect(behind).toHaveFocus();

    // ไม่มีอะไรเปิดอยู่ Tab ต้องเดินตามปกติ
    await userEvent.tab();

    expect(behind).not.toHaveFocus();
  });
});
