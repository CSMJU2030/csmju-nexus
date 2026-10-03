import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageUpload } from './use-image-upload';

/// เทสต์ของ hook เลือกรูป
///
/// สิ่งที่ต้องพิสูจน์คือ **ไม่รั่ว blob URL** — เบราว์เซอร์ถือ blob ไว้ใน
/// หน่วยความจำจนกว่าจะ revoke หรือปิดแท็บ ถ้าผู้ใช้ลองเลือกรูปหลายสิบใบ
/// (ซึ่งเกิดขึ้นจริงตอนเลือกรูปปก) หน่วยความจำจะบวมโดยไม่มีอะไรบอก
///
/// จุดที่พลาดง่าย: เรียก createObjectURL/revokeObjectURL ข้างใน state updater
/// React เรียก updater ซ้ำได้ (StrictMode เรียกสองครั้งเสมอ) ผลคือสร้าง URL
/// สองอันแต่เก็บอันเดียว อีกอันรั่วถาวร

const created: string[] = [];
const revoked: string[] = [];

let counter = 0;

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  counter = 0;

  // jsdom ไม่มี createObjectURL — ทำตัวนับขึ้นมาเพื่อดูว่าสร้าง/คืนกี่ครั้ง
  URL.createObjectURL = vi.fn(() => {
    counter += 1;

    const url = `blob:test/${counter}`;

    created.push(url);

    return url;
  });

  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness() {
  // แยกออกมาเป็นตัวแปรของตัวเอง — การอ่าน `upload.fileInputRef` ตอน render
  // ทำให้ตัววิเคราะห์ของ React Compiler คิดว่าเรากำลังอ่าน ref ระหว่าง render
  const {
    fileInputRef,
    handleFileChange,
    handleRemove,
    previewUrl,
    fileName,
  } = useImageUpload();

  return (
    <div>
      <input
        type="file"
        data-testid="picker"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <span data-testid="preview">{previewUrl ?? 'ไม่มี'}</span>
      <span data-testid="name">{fileName ?? '-'}</span>
      <button type="button" onClick={handleRemove}>
        เอาออก
      </button>
    </div>
  );
}

const png = (name = 'cover.png') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

describe('useImageUpload', () => {
  it('เลือกรูปแล้วได้พรีวิวและชื่อไฟล์', async () => {
    render(<Harness />);

    await userEvent.upload(screen.getByTestId('picker'), png());

    expect(screen.getByTestId('preview')).toHaveTextContent('blob:test/');
    expect(screen.getByTestId('name')).toHaveTextContent('cover.png');
  });

  it('สร้าง blob URL แค่ครั้งเดียวต่อไฟล์ แม้อยู่ใน StrictMode', async () => {
    // StrictMode เรียก state updater สองครั้งโดยตั้งใจ เพื่อจับผลข้างเคียง
    // ที่ไม่ควรอยู่ในนั้น — ถ้า createObjectURL อยู่ใน updater จะเห็นสองอัน
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    await userEvent.upload(screen.getByTestId('picker'), png());

    expect(created).toHaveLength(1);
  });

  it('ทุก URL ที่สร้างต้องถูกคืนเมื่อเลิกใช้ (ไม่รั่ว)', async () => {
    const { unmount } = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    await userEvent.upload(screen.getByTestId('picker'), png('a.png'));
    await userEvent.upload(screen.getByTestId('picker'), png('b.png'));
    await userEvent.upload(screen.getByTestId('picker'), png('c.png'));

    unmount();

    // ทุกอันที่สร้างต้องมีอยู่ในรายการที่คืนแล้ว
    const leaked = created.filter((url) => !revoked.includes(url));

    expect(leaked).toEqual([]);
  });

  it('คืน URL เดิมไม่ซ้ำซ้อน', async () => {
    render(<Harness />);

    await userEvent.upload(screen.getByTestId('picker'), png('a.png'));
    await userEvent.upload(screen.getByTestId('picker'), png('b.png'));

    // revoke ซ้ำตัวเดิมไม่ทำให้พัง แต่บอกว่ามีสองที่แย่งกันรับผิดชอบ
    // ซึ่งเป็นต้นทางของบั๊กที่ตามยาก
    const duplicates = revoked.filter(
      (url, index) => revoked.indexOf(url) !== index,
    );

    expect(duplicates).toEqual([]);
  });

  it('กดเอาออกแล้วล้างทั้งพรีวิว ชื่อไฟล์ และค่าใน input', async () => {
    render(<Harness />);

    const picker = screen.getByTestId('picker') as HTMLInputElement;

    await userEvent.upload(picker, png());
    expect(picker.files).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'เอาออก' }));

    expect(screen.getByTestId('preview')).toHaveTextContent('ไม่มี');
    expect(screen.getByTestId('name')).toHaveTextContent('-');
    // ต้องล้างค่าใน input ด้วย ไม่งั้นเลือกไฟล์เดิมซ้ำจะไม่ยิง onChange
    expect(picker.value).toBe('');
  });

  it('ยกเลิกหน้าต่างเลือกไฟล์ (ไม่ได้เลือกอะไร) ไม่ทำอะไรเลย', async () => {
    render(<Harness />);

    const picker = screen.getByTestId('picker');

    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(created).toEqual([]);
    expect(screen.getByTestId('preview')).toHaveTextContent('ไม่มี');
  });
});
