import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttachmentButton,
  AttachmentTray,
  useAttachments,
} from './attachment-picker';

/// เทสต์การแนบไฟล์ในช่องพิมพ์ข้อความ
///
/// **บั๊กที่ต้องกันไว้ให้ได้: แนบทีเดียวหลายไฟล์แล้วเหลือแค่ไฟล์สุดท้าย**
///
/// การอัปโหลดวนทีละไฟล์แบบ await ต่อกัน ถ้าต่อท้ายรายการด้วยค่าที่อ่านจาก
/// closure (`[...assets, ไฟล์ใหม่]`) ทุกรอบจะอ่านค่าของรอบวาดแรกเสมอ ไฟล์ที่
/// อัปเสร็จก่อนจึงถูกทับหายทีละตัว — และเห็นเฉพาะตอนแนบหลายไฟล์พร้อมกัน
/// ซึ่งเป็นสิ่งที่ผู้ใช้ทำเป็นปกติเวลาส่งรูปหลายรูป

const uploadFile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/upload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csmju/upload')>(
    '@/lib/csmju/upload',
  );

  return { ...actual, uploadFile };
});

function Harness() {
  const attachments = useAttachments({ max: 3 });

  return (
    <div>
      <AttachmentTray attachments={attachments} />
      <AttachmentButton attachments={attachments} />
      <output data-testid="count">{attachments.assets.length}</output>
      <output data-testid="uploading">
        {attachments.uploading ? 'กำลังอัป' : 'ว่าง'}
      </output>
    </div>
  );
}

function fakeFile(name: string) {
  return new File(['เนื้อไฟล์'], name, { type: 'image/png' });
}

function asset(name: string) {
  return {
    assetId: `asset-${name}`,
    fileName: name,
    kind: 'IMAGE' as const,
    mimeType: 'image/png',
    sizeBytes: '2048',
  };
}

function input(): HTMLInputElement {
  return screen.getByLabelText('เลือกไฟล์ที่จะแนบ') as HTMLInputElement;
}

beforeEach(() => {
  uploadFile.mockReset();
  uploadFile.mockImplementation((file: File) =>
    Promise.resolve(asset(file.name)),
  );
});

describe('แนบไฟล์', () => {
  it('เลือกไฟล์แล้วอัปโหลดทันที ไม่รอตอนกดส่ง', async () => {
    render(<Harness />);

    await userEvent.upload(input(), fakeFile('รูป.png'));

    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('1'),
    );

    expect(uploadFile).toHaveBeenCalledOnce();
    expect(screen.getByText('รูป.png')).toBeInTheDocument();
  });

  it('**แนบหลายไฟล์พร้อมกันต้องอยู่ครบทุกไฟล์**', async () => {
    render(<Harness />);

    await userEvent.upload(input(), [
      fakeFile('หนึ่ง.png'),
      fakeFile('สอง.png'),
      fakeFile('สาม.png'),
    ]);

    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('3'),
    );

    for (const name of ['หนึ่ง.png', 'สอง.png', 'สาม.png']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('เอาไฟล์ออกได้ทีละไฟล์', async () => {
    render(<Harness />);

    await userEvent.upload(input(), [fakeFile('อยู่.png'), fakeFile('ออก.png')]);

    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('2'),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เอา ออก.png ออก' }),
    );

    expect(screen.queryByText('ออก.png')).not.toBeInTheDocument();
    expect(screen.getByText('อยู่.png')).toBeInTheDocument();
  });

  it('**บอกว่ากำลังอัปอยู่** — ช่องพิมพ์ใช้ค่านี้กันกดส่งก่อนไฟล์เสร็จ', async () => {
    // ถ้าไม่มีสถานะนี้ ผู้ใช้กดส่งตอนไฟล์ยังไม่เสร็จได้ แล้วไฟล์จะหลุดไปเงียบ ๆ
    let finish: ((value: unknown) => void) | undefined;

    uploadFile.mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );

    render(<Harness />);

    await userEvent.upload(input(), fakeFile('ใหญ่.mp4'));

    await waitFor(() =>
      expect(screen.getByTestId('uploading')).toHaveTextContent('กำลังอัป'),
    );

    finish?.(asset('ใหญ่.mp4'));

    await waitFor(() =>
      expect(screen.getByTestId('uploading')).toHaveTextContent('ว่าง'),
    );
  });

  it('อัปไม่ผ่านต้องบอกเหตุผลจากหลังบ้าน ไม่ใช่หายไปเฉย ๆ', async () => {
    uploadFile.mockRejectedValue(
      new Error('ไม่รองรับไฟล์นามสกุล .exe'),
    );

    render(<Harness />);

    await userEvent.upload(input(), fakeFile('ตัวติดตั้ง.exe'));

    expect(
      await screen.findByText('ไม่รองรับไฟล์นามสกุล .exe'),
    ).toBeInTheDocument();

    // ไฟล์ที่ล้มต้องไม่ถูกนับเป็นไฟล์ที่แนบสำเร็จ
    expect(screen.getByTestId('count')).toHaveTextContent('0');

    // และต้องไม่ค้างสถานะ "กำลังอัป" ไว้ตลอดกาล ไม่งั้นกดส่งไม่ได้อีกเลย
    expect(screen.getByTestId('uploading')).toHaveTextContent('ว่าง');
  });

  it('เกินเพดานแล้วปุ่มแนบถูกปิด และไฟล์ส่วนเกินไม่ถูกอัป', async () => {
    render(<Harness />);

    await userEvent.upload(input(), [
      fakeFile('1.png'),
      fakeFile('2.png'),
      fakeFile('3.png'),
      fakeFile('4.png'),
      fakeFile('5.png'),
    ]);

    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('3'),
    );

    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'แนบไฟล์' })).toBeDisabled();
  });
});
