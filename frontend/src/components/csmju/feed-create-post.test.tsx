import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePostModal, MAX_POST_MEDIA, pickProblem } from './feed-create-post';

/// เทสต์กล่อง "สร้างโพสต์ใหม่"
///
///   - ไฟล์ขึ้น storage ตอนกด "แชร์" เท่านั้น (เลือกแล้วยกเลิก = ไม่กินโควตา)
///   - assetIds ส่งตามลำดับที่เลือก · ไม่เกิน 10 ชิ้น
///   - มีของค้างแล้วปิด = ถาม "ละทิ้งโพสต์ใช่ไหม" แบบ IG

const apiPost = vi.hoisted(() => vi.fn());
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { post: apiPost },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/csmju/upload', () => ({
  uploadFile,
  formatBytes: (n: number) => `${Math.round(n / 1024 / 1024)} MB`,
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span aria-hidden />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));
vi.mock('@/components/csmju/emoji-picker', () => ({
  EmojiPopover: ({ open, onPick }: { open: boolean; onPick: (emoji: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick('😀')}>
        อิโมจิ 😀
      </button>
    ) : null,
}));

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  apiPost.mockReset();
  uploadFile.mockReset();
  let n = 0;
  uploadFile.mockImplementation(async () => ({ assetId: `asset-${++n}` }));
  apiPost.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ id: 'post-9', ...body }));
  URL.createObjectURL = vi.fn(() => `blob:preview-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
});

function renderModal() {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  render(<CreatePostModal open onClose={onClose} onCreated={onCreated} />);

  return { onClose, onCreated };
}

describe('ตรวจไฟล์', () => {
  it('รับเฉพาะรูป/วิดีโอ ไม่เกิน 50 MB และบอกเหตุผลรายไฟล์', () => {
    expect(pickProblem({ name: 'a.jpg', type: 'image/jpeg', size: 10 })).toBeNull();
    expect(pickProblem({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toContain('รับเฉพาะรูปภาพและวิดีโอ');
    expect(pickProblem({ name: 'big.mp4', type: 'video/mp4', size: 60 * 1024 * 1024 })).toContain('เกินเพดาน');
  });
});

describe('สร้างโพสต์ใหม่', () => {
  it('ขั้นแรกแบบ IG: "ลากรูปภาพและวิดีโอมาที่นี่" + ปุ่มฟ้า "เลือกจากคอมพิวเตอร์"', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'สร้างโพสต์ใหม่' })).toBeInTheDocument();
    expect(screen.getByText('ลากรูปภาพและวิดีโอมาที่นี่')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เลือกจากคอมพิวเตอร์' })).toBeInTheDocument();
  });

  it('**เลือก → ตัวอย่าง (‹ › จุด) → ถัดไป → คำบรรยาย → แชร์: อัปโหลดทีละไฟล์แล้ว POST /posts พร้อม assetIds**', async () => {
    const user = userEvent.setup();
    const { onCreated, onClose } = renderModal();

    await user.upload(screen.getByLabelText('เลือกรูปภาพหรือวิดีโอ'), [
      file('a.jpg', 'image/jpeg'),
      file('b.mp4', 'video/mp4'),
    ]);

    expect(screen.getByRole('heading', { name: 'ตัวอย่าง' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ตัวอย่างชิ้นที่ 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ชิ้นถัดไป' }));
    expect(screen.getByLabelText('ตัวอย่างชิ้นที่ 2').tagName).toBe('VIDEO');

    await user.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await user.type(screen.getByRole('textbox', { name: 'คำบรรยาย' }), 'สรุปบทที่ 3 ');
    await user.click(screen.getByRole('button', { name: 'แทรกอีโมจิ' }));
    await user.click(screen.getByRole('button', { name: 'อิโมจิ 😀' }));
    await user.click(screen.getByRole('button', { name: 'แชร์' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenCalledWith('/posts', {
      content: 'สรุปบทที่ 3 😀',
      assetIds: ['asset-1', 'asset-2'],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('**ไม่เกิน 10 ชิ้น** — เกินแล้วบอก ไม่ตัดทิ้งเงียบ ๆ', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.upload(
      screen.getByLabelText('เลือกรูปภาพหรือวิดีโอ'),
      Array.from({ length: MAX_POST_MEDIA + 2 }, (_, i) => file(`p${i}.jpg`, 'image/jpeg')),
    );

    expect(screen.getByText(/เลือกได้ไม่เกิน 10 ชิ้นต่อโพสต์/)).toBeInTheDocument();
    // ครบ 10 แล้ว ปุ่ม "+ เพิ่ม" หายไป (รับ 10 ชิ้นแรก ไม่ใช่ทิ้งทั้งหมด)
    expect(screen.getByRole('heading', { name: 'ตัวอย่าง' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ เพิ่ม/ })).not.toBeInTheDocument();
  });

  it('ข้อความล้วน (กระทู้) ต้องมีหัวข้อและเนื้อหาก่อนถึงแชร์ได้', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'เขียนข้อความอย่างเดียว' }));

    const share = screen.getByRole('button', { name: 'แชร์' });

    await user.type(screen.getByRole('textbox', { name: 'คำบรรยาย' }), 'เนื้อหา');
    expect(share).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'หัวข้อ' }), 'ถาม pointer');
    expect(share).toBeEnabled();
  });

  it('**มีของค้างแล้วกด Esc → "ละทิ้งโพสต์ใช่ไหม"** · ยกเลิก = กลับไปที่เดิม', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.upload(screen.getByLabelText('เลือกรูปภาพหรือวิดีโอ'), [file('a.jpg', 'image/jpeg')]);
    await user.keyboard('{Escape}');

    expect(screen.getByText('ละทิ้งโพสต์ใช่ไหม')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByRole('heading', { name: 'ตัวอย่าง' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'ละทิ้ง' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('ไฟล์ที่ไม่ใช่รูป/วิดีโอถูกปฏิเสธพร้อมเหตุผล', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderModal();

    await user.upload(screen.getByLabelText('เลือกรูปภาพหรือวิดีโอ'), [file('notes.pdf', 'application/pdf')]);

    expect(screen.getByRole('alert')).toHaveTextContent('notes.pdf: รับเฉพาะรูปภาพและวิดีโอ');
  });
});
