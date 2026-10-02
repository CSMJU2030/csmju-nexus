import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentList } from './attachment-list';
import type { MessageAttachment } from '@/lib/csmju/types';

/// เทสต์การแสดงไฟล์แนบในข้อความ
///
/// **หลังบ้านเก็บไฟล์แนบได้มาตั้งแต่ต้น แต่หน้าบ้านไม่เคยเรนเดอร์มันเลย**
/// ส่งไฟล์เข้าไปได้ แต่ไม่มีใครเห็น
///
/// กฎที่ต้องคงไว้:
///
///   รูป (รวม GIF) → เห็นภาพเลย ไม่ต้องกดอะไรก่อน
///   วิดีโอ        → **ไม่โหลดจนกว่าจะกด** เพราะห้องหนึ่งมีคลิปได้หลายสิบคลิป
///                   ถ้าโหลดหมดคือกินเน็ตผู้ใช้ทิ้งเปล่า ๆ และเสียงดังซ้อนกัน
///   เอกสาร        → การ์ดพร้อมชื่อ ขนาด และปุ่มดาวน์โหลด

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet },
  ApiError: class extends Error {},
}));

function file(over: Partial<MessageAttachment>): MessageAttachment {
  return {
    id: 'asset-1',
    fileName: 'ไฟล์.bin',
    kind: 'DOCUMENT',
    mimeType: 'application/octet-stream',
    sizeBytes: '2048',
    ...over,
  };
}

beforeEach(async () => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({
    downloadUrl: 'http://localhost:4000/blob/ลิงก์ที่เซ็นแล้ว',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    asAttachment: false,
  });

  // แคชระดับโมดูลอยู่ข้ามเทสต์ ต้องล้าง ไม่งั้นข้อถัดไปจะไม่ยิงคำขอเลย
  // แล้วเราจะเข้าใจผิดว่าโค้ดไม่ได้ขอลิงก์
  const { assetUrlCacheForTests } = await import('@/lib/csmju/asset-url');
  const { cache, inflight } = assetUrlCacheForTests();

  cache.clear();
  inflight.clear();
});

describe('ไฟล์แนบในข้อความ', () => {
  it('ไม่มีไฟล์แนบก็ไม่เรนเดอร์อะไรเลย', () => {
    const { container } = render(<AttachmentList attachments={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('**รูปภาพเห็นภาพเลย** ไม่ต้องกดก่อน', async () => {
    render(
      <AttachmentList
        attachments={[file({ kind: 'IMAGE', fileName: 'ภาพกิจกรรม.png' })]}
      />,
    );

    const image = await screen.findByAltText('ภาพกิจกรรม.png');

    expect(image).toHaveAttribute('src', expect.stringContaining('ลิงก์ที่เซ็นแล้ว'));
  });

  it('GIF ถือเป็นรูปภาพ เห็นภาพเคลื่อนไหวได้เลย', async () => {
    render(
      <AttachmentList
        attachments={[
          file({ kind: 'IMAGE', mimeType: 'image/gif', fileName: 'สติกเกอร์.gif' }),
        ]}
      />,
    );

    expect(await screen.findByAltText('สติกเกอร์.gif')).toBeInTheDocument();
  });

  it('กดรูปแล้วดูเต็มจอได้ และปิดกลับมาได้', async () => {
    render(
      <AttachmentList
        attachments={[file({ kind: 'IMAGE', fileName: 'ภาพ.png' })]}
      />,
    );

    await screen.findByAltText('ภาพ.png');
    await userEvent.click(screen.getByRole('button'));

    const dialog = screen.getByRole('dialog', { name: 'ภาพ.png' });

    expect(dialog).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ปิด' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('**วิดีโอไม่โหลดจนกว่าจะกด**', async () => {
    render(
      <AttachmentList
        attachments={[file({ kind: 'VIDEO', fileName: 'คลิป.mp4' })]}
      />,
    );

    // ยังไม่กด = ยังไม่ขอลิงก์ และยังไม่มีตัวเล่น
    expect(apiGet).not.toHaveBeenCalled();
    expect(document.querySelector('video')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /คลิป\.mp4/ }));

    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(apiGet).toHaveBeenCalledOnce();
  });

  it('เอกสารขึ้นเป็นการ์ดพร้อมขนาดที่อ่านรู้เรื่อง', () => {
    render(
      <AttachmentList
        attachments={[
          file({
            kind: 'DOCUMENT',
            fileName: 'รายงานกลุ่ม.docx',
            sizeBytes: '1572864',
          }),
        ]}
      />,
    );

    expect(screen.getByText('รายงานกลุ่ม.docx')).toBeInTheDocument();
    expect(screen.getByText('1.5 MB')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'ดาวน์โหลด รายงานกลุ่ม.docx' }),
    ).toBeInTheDocument();
  });

  it('ไฟล์เปิดไม่ได้ต้องบอกเหตุผล ไม่ใช่กรอบว่าง', async () => {
    apiGet.mockRejectedValue(new Error('ไม่มีสิทธิ์เข้าถึงไฟล์นี้'));

    render(
      <AttachmentList
        attachments={[file({ kind: 'IMAGE', fileName: 'ลับ.png' })]}
      />,
    );

    expect(
      await screen.findByText(/ไม่มีสิทธิ์เข้าถึงไฟล์นี้/),
    ).toBeInTheDocument();
  });

  it('ไฟล์หลายไฟล์ในข้อความเดียวขึ้นครบทุกไฟล์', async () => {
    render(
      <AttachmentList
        attachments={[
          file({ id: 'a', kind: 'IMAGE', fileName: 'รูป.png' }),
          file({ id: 'b', kind: 'DOCUMENT', fileName: 'เอกสาร.pdf' }),
          file({ id: 'c', kind: 'ARCHIVE', fileName: 'โปรเจกต์.zip' }),
        ]}
      />,
    );

    expect(await screen.findByAltText('รูป.png')).toBeInTheDocument();
    expect(screen.getByText('เอกสาร.pdf')).toBeInTheDocument();
    expect(screen.getByText('โปรเจกต์.zip')).toBeInTheDocument();
  });
});
