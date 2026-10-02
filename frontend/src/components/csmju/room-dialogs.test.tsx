import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/csmju/types';
import { CreateRoomDialog, ManageRoomDialog } from './room-dialogs';

/// เทสต์การสร้าง แก้ไข และลบห้อง
///
/// กฎที่ต้องคงไว้:
///   - สร้างห้องไม่ได้ถ้าไม่บอกว่าห้องไว้ทำอะไร
///   - นักศึกษาเลือกห้องประจำวิชาไม่ได้ และเห็นเหตุผลตั้งแต่ที่ตัวเลือก
///   - ลบต้องผ่านขั้นยืนยันที่ระบุชื่อห้อง (ui-design-system.md ข้อ 8.3)

const apiPost = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());
const apiDel = vi.hoisted(() => vi.fn());
const me = vi.hoisted(() => ({
  current: {
    id: 'user-002',
    email: 'student@core.local',
    coreRole: 'student',
    subsystemRole: 'GUEST',
  },
}));

vi.mock('@/lib/csmju/api', () => ({
  api: { post: apiPost, patch: apiPatch, del: apiDel },
  ApiError: class extends Error {},
}));

vi.mock('@/lib/csmju/session', () => ({
  useMe: () => me.current,
}));

function room(over: Partial<Channel> = {}): Channel {
  return {
    id: 'room-1',
    kind: 'GROUP',
    name: 'ติวสอบ DS',
    courseTag: null,
    maxSeats: 8,
    memberCount: 4,
    myRole: 'MODERATOR',
    unreadCount: 0,
    peerCoreUserId: null,
    description: 'ติวก่อนสอบกลางภาค',
    createdByCoreUserId: 'user-002',
    canManage: true,
    lastMessage: null,
    inboxFolder: 'PRIMARY',
    pinnedAt: null,
    muted: false,
    clearedAt: null,
    peerLastReadSeq: null,
    memberCoreUserIds: null,
    createdAt: '2026-09-29T01:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  apiPost.mockReset();
  apiPatch.mockReset();
  apiDel.mockReset();
  me.current = { ...me.current, coreRole: 'student' };
});

describe('สร้างห้อง', () => {
  it('**ไม่บอกวัตถุประสงค์ = กดสร้างไม่ได้**', async () => {
    render(<CreateRoomDialog onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'สร้างห้อง' }));
    await userEvent.type(screen.getByLabelText('ชื่อห้อง'), 'ห้องทดสอบ');

    const submit = screen
      .getAllByRole('button', { name: 'สร้างห้อง' })
      .find((button) => button.getAttribute('type') === 'submit')!;

    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('สร้างห้องนี้เพื่ออะไร'), '   ');
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('สร้างห้องนี้เพื่ออะไร'), 'ติวสอบ');
    expect(submit).toBeEnabled();
  });

  it('ส่งชื่อและวัตถุประสงค์ที่ตัดช่องว่างแล้วไปหลังบ้าน', async () => {
    const onCreated = vi.fn();

    apiPost.mockResolvedValue(room());
    render(<CreateRoomDialog onCreated={onCreated} />);

    await userEvent.click(screen.getByRole('button', { name: 'สร้างห้อง' }));
    await userEvent.type(screen.getByLabelText('ชื่อห้อง'), '  ติวสอบ DS  ');
    await userEvent.type(screen.getByLabelText('สร้างห้องนี้เพื่ออะไร'), '  ติวก่อนสอบกลางภาค ');
    await userEvent.click(
      screen
        .getAllByRole('button', { name: 'สร้างห้อง' })
        .find((button) => button.getAttribute('type') === 'submit')!,
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/channels', {
      kind: 'GROUP',
      name: 'ติวสอบ DS',
      description: 'ติวก่อนสอบกลางภาค',
    });
  });

  it('นักศึกษาเลือกห้องประจำวิชาไม่ได้ และเห็นเหตุผลที่ตัวเลือก', async () => {
    render(<CreateRoomDialog onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'สร้างห้อง' }));

    expect(screen.getByRole('radio', { name: /ห้องประจำวิชา/ })).toBeDisabled();
    expect(screen.getByText('ต้องเป็นอาจารย์หรือบุคลากร')).toBeInTheDocument();
  });

  it('อาจารย์เลือกห้องประจำวิชาได้ พร้อมรหัสวิชา', async () => {
    me.current = { ...me.current, coreRole: 'staff' };
    apiPost.mockResolvedValue(room({ kind: 'COURSE' }));
    render(<CreateRoomDialog onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'สร้างห้อง' }));
    await userEvent.click(screen.getByRole('radio', { name: /ห้องประจำวิชา/ }));
    await userEvent.type(screen.getByLabelText('ชื่อห้อง'), 'CS201 กลุ่ม 1');
    await userEvent.type(screen.getByLabelText('สร้างห้องนี้เพื่ออะไร'), 'ประกาศของรายวิชา');
    await userEvent.type(screen.getByLabelText('รหัสวิชา (ไม่บังคับ)'), 'cs201');
    await userEvent.click(
      screen
        .getAllByRole('button', { name: 'สร้างห้อง' })
        .find((button) => button.getAttribute('type') === 'submit')!,
    );

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/channels', {
        kind: 'COURSE',
        name: 'CS201 กลุ่ม 1',
        description: 'ประกาศของรายวิชา',
        courseTag: 'CS201',
      }),
    );
  });

  it('หลังบ้านปฏิเสธ → เห็นเหตุผลจริง กล่องยังเปิดอยู่', async () => {
    apiPost.mockRejectedValue(new Error('บอกวัตถุประสงค์ของห้อง 1-300 ตัวอักษร'));
    render(<CreateRoomDialog onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'สร้างห้อง' }));
    await userEvent.type(screen.getByLabelText('ชื่อห้อง'), 'ห้อง');
    await userEvent.type(screen.getByLabelText('สร้างห้องนี้เพื่ออะไร'), 'ทดสอบ');
    await userEvent.click(
      screen
        .getAllByRole('button', { name: 'สร้างห้อง' })
        .find((button) => button.getAttribute('type') === 'submit')!,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('บอกวัตถุประสงค์ของห้อง');
  });
});

describe('แก้ไขและลบห้อง', () => {
  it('แก้วัตถุประสงค์แล้วบันทึก', async () => {
    const onUpdated = vi.fn();

    apiPatch.mockResolvedValue(room({ description: 'ติวก่อนสอบปลายภาค' }));
    render(<ManageRoomDialog channel={room()} onUpdated={onUpdated} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'แก้ไขหรือลบห้อง' }));

    const purpose = screen.getByLabelText('สร้างห้องนี้เพื่ออะไร');

    expect(purpose).toHaveValue('ติวก่อนสอบกลางภาค');

    // ยังไม่แก้อะไร = ปุ่มบันทึกกดไม่ได้
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();

    await userEvent.clear(purpose);
    await userEvent.type(purpose, 'ติวก่อนสอบปลายภาค');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/channels/room-1', {
      name: 'ติวสอบ DS',
      description: 'ติวก่อนสอบปลายภาค',
    });
  });

  it('**ลบต้องผ่านขั้นยืนยันที่บอกชื่อห้องและผลที่ตามมา**', async () => {
    const onDeleted = vi.fn();

    apiDel.mockResolvedValue(undefined);
    render(<ManageRoomDialog channel={room()} onUpdated={vi.fn()} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: 'แก้ไขหรือลบห้อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ลบห้อง' }));

    // กดครั้งแรกแค่เปิดขั้นยืนยัน ยังไม่ลบ
    expect(apiDel).not.toHaveBeenCalled();
    expect(screen.getByText('ลบห้อง "ติวสอบ DS"?')).toBeInTheDocument();
    expect(screen.getByText(/กู้คืนไม่ได้/)).toBeInTheDocument();
    expect(screen.getByText(/สมาชิก 4 คน/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ลบห้อง' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('room-1'));
    expect(apiDel).toHaveBeenCalledWith('/channels/room-1');
  });

  it('ยกเลิกจากขั้นยืนยันแล้วห้องไม่ถูกลบ', async () => {
    render(<ManageRoomDialog channel={room()} onUpdated={vi.fn()} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'แก้ไขหรือลบห้อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ลบห้อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(apiDel).not.toHaveBeenCalled();
    expect(screen.getByLabelText('ชื่อห้อง')).toBeInTheDocument();
  });

  it('ลบไม่สำเร็จ → บอกเหตุผล ไม่ถือว่าลบแล้ว', async () => {
    const onDeleted = vi.fn();

    apiDel.mockRejectedValue(new Error('ลบห้องได้เฉพาะผู้สร้างห้อง ผู้ดูแลห้อง หรือผู้ดูแลระบบ'));
    render(<ManageRoomDialog channel={room()} onUpdated={vi.fn()} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: 'แก้ไขหรือลบห้อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ลบห้อง' }));
    await userEvent.click(screen.getByRole('button', { name: 'ลบห้อง' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ลบห้องได้เฉพาะผู้สร้างห้อง');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
