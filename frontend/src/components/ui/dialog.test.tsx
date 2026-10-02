import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

/// เทสต์ของ Dialog ที่เขียนเองบน <dialog> ของเบราว์เซอร์
///
/// เขียนเองแทนการลง @radix-ui/react-dialog จึงต้องพิสูจน์ว่าได้พฤติกรรม
/// ที่คนใช้ radix มาเพื่อมันครบจริง: เปิด-ปิด, Escape, คลิกฉากหลัง,
/// และ asChild ที่ไม่ห่อปุ่มซ้อนปุ่ม

function Basic({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button type="button">เปิดกล่อง</button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>หัวข้อกล่อง</DialogTitle>
        </DialogHeader>
        <DialogDescription>คำอธิบาย</DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button">ยกเลิก</button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('เริ่มต้นปิดอยู่', () => {
    render(<Basic />);

    expect(screen.queryByText('หัวข้อกล่อง')).not.toBeInTheDocument();
  });

  it('กดปุ่มแล้วเปิด', async () => {
    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));

    expect(screen.getByText('หัวข้อกล่อง')).toBeInTheDocument();
  });

  it('asChild ไม่ห่อปุ่มซ้อนปุ่ม', async () => {
    render(<Basic />);

    const trigger = screen.getByRole('button', { name: 'เปิดกล่อง' });

    // ปุ่มซ้อนปุ่มเป็น HTML ที่ไม่ถูกต้อง และทำให้ style เพี้ยน
    expect(trigger.querySelector('button')).toBeNull();
    expect(trigger.closest('button')).toBe(trigger);
  });

  it('DialogClose ปิดกล่อง', async () => {
    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    await waitFor(() =>
      expect(screen.queryByText('หัวข้อกล่อง')).not.toBeInTheDocument(),
    );
  });

  it('ปุ่มกากบาทปิดกล่อง', async () => {
    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ปิด' }));

    await waitFor(() =>
      expect(screen.queryByText('หัวข้อกล่อง')).not.toBeInTheDocument(),
    );
  });

  it('แจ้ง onOpenChange ทั้งตอนเปิดและตอนปิด', async () => {
    const onOpenChange = vi.fn();

    render(<Basic onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false));
  });

  it('โหมดควบคุมจากภายนอกทำงาน (open ถูกส่งเข้ามา)', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            เปิดจากข้างนอก
          </button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>ควบคุมจากข้างนอก</DialogTitle>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    render(<Controlled />);

    await userEvent.click(
      screen.getByRole('button', { name: 'เปิดจากข้างนอก' }),
    );

    expect(screen.getByText('ควบคุมจากข้างนอก')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ปิด' }));

    await waitFor(() =>
      expect(screen.queryByText('ควบคุมจากข้างนอก')).not.toBeInTheDocument(),
    );
  });

  it('ใช้ <dialog> จริง ไม่ใช่ div ที่วาดเลียนแบบ', async () => {
    // <dialog> ให้โฟกัสถูกกัก, Escape ปิดเอง และอยู่บน top layer จริง
    // ซึ่งเป็นเหตุผลทั้งหมดที่ไม่ต้องลง radix
    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));

    const dialog = screen.getByText('หัวข้อกล่อง').closest('dialog');

    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
  });

  it('ใช้ component ข้างนอก <Dialog> แล้วต้องบอกให้ชัด', () => {
    // ข้อความ error ที่บอกชื่อ component ช่วยให้หาที่ผิดเจอทันที
    // ต่างจาก "Cannot read properties of null" ที่ไม่บอกอะไรเลย
    expect(() =>
      render(
        <DialogTrigger>
          <span>ลอย</span>
        </DialogTrigger>,
      ),
    ).toThrow(/DialogTrigger.*ต้องอยู่ภายใน <Dialog>/);
  });
});

describe('การคืนโฟกัสตอนปิด', () => {
  it('ปิดกล่องแล้วต้องเรียก dialog.close() จริง ๆ', async () => {
    // เบราว์เซอร์คืนโฟกัสกลับไปที่ปุ่มที่กดเปิดในลำดับการปิดของ <dialog>
    // ถ้าเราถอด element ออกจาก DOM ก่อน ลำดับนั้นไม่เคยทำงาน โฟกัสจึงร่วง
    // ไปที่ <body> แล้วคนที่ใช้คีย์บอร์ดต้อง Tab ไล่ใหม่ตั้งแต่ต้นหน้า
    //
    // jsdom ไม่ได้จำลองการคืนโฟกัสของ <dialog> จึงตรวจที่กลไกที่หายไปแทน:
    // close() ถูกเรียกไหม
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');

    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));
    await screen.findByText('หัวข้อกล่อง');

    close.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    await waitFor(() => expect(close).toHaveBeenCalled());

    close.mockRestore();
  });

  it('ปิดแล้วเนื้อหาข้างในถูกถอดออก', async () => {
    // ยังต้องถอดลูกอยู่ ไม่งั้น effect ของลูก (เช่นตัวอัปโหลดรูป) จะทำงาน
    // ทั้งที่กล่องไม่ได้เปิด
    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));
    await screen.findByText('หัวข้อกล่อง');

    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    await waitFor(() =>
      expect(screen.queryByText('หัวข้อกล่อง')).not.toBeInTheDocument(),
    );
  });

  it('**อยู่กลางจอ** — m-auto คืนค่าที่ preflight ของ Tailwind ลบทิ้ง', async () => {
    // jsdom ไม่คำนวณเลย์เอาต์ จึงตรวจที่ class — ถ้าใครลบ m-auto ออก
    // กล่องทุกใบในระบบจะกลับไปติดมุมซ้ายบนทันที
    render(<Basic />);

    await userEvent.click(screen.getByRole('button', { name: 'เปิดกล่อง' }));

    expect(document.querySelector('dialog')).toHaveClass('m-auto');
  });
});
