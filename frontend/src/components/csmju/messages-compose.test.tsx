import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposePanel } from './messages-compose';

/// เทสต์หน้า "ข้อความใหม่" (ใช้ทั้งกล่องลอยของ /messages และในแผงข้อความลอย)
///
/// กฎที่ต้องคงไว้:
///   - คนหนึ่งคน = `{ peerCoreUserId }` (หาห้องเดิมก่อน) · สองคนขึ้นไป =
///     `{ peerCoreUserIds, name? }` = แชทกลุ่มใหม่
///   - คำแนะนำมาจากข้อมูลจริง (เคยคุย · ติดตาม · /follows/suggestions) ไม่มีคนสมมติ
///   - ชิปลบได้ · ปุ่มกดไม่ได้เมื่อยังไม่เลือกใคร

const api = vi.hoisted(() => ({ list: vi.fn(), post: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/csmju/api', async (original) => ({
  ...(await original<typeof import('@/lib/csmju/api')>()),
  api,
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 's@x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/profile-follow-list', () => ({
  useMyFollowing: () => ({ data: new Set(['user-004']), isPending: false }),
}));
vi.mock('@/components/csmju/profile-suggestions', () => ({
  useSuggestions: () => ({ people: [{ coreUserId: 'user-005', mutualCount: 1 }], isPending: false }),
}));

const NAMES: Record<string, string> = {
  'user-003': 'อาจารย์สมชาย',
  'user-004': 'มะลิ',
  'user-005': 'ต้นกล้า',
  'user-007': 'ผลค้นหา',
};

vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (id: string) => ({
    coreUserId: id,
    displayName: NAMES[id] ?? id,
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

function setup() {
  const onStarted = vi.fn();
  const onBack = vi.fn();
  const onClose = vi.fn();

  render(
    <ComposePanel recent={['user-003']} onBack={onBack} onClose={onClose} onStarted={onStarted} />,
  );

  return { onStarted, onBack, onClose };
}

const person = (name: RegExp) => screen.getByRole('button', { name, pressed: false }) ?? null;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.post.mockResolvedValue({ id: 'ch-new' });
});

describe('ข้อความใหม่', () => {
  it('แนะนำจากคนที่เคยคุย → ติดตาม → คำแนะนำ ตามลำดับ · ไม่มีคนสมมติ', () => {
    setup();

    const list = screen.getByRole('list', { name: 'แนะนำ' });
    const names = within(list).getAllByRole('button').map((row) => row.textContent);

    expect(names).toEqual([
      expect.stringContaining('อาจารย์สมชาย'),
      expect.stringContaining('มะลิ'),
      expect.stringContaining('ต้นกล้า'),
    ]);
  });

  it('**คนเดียว = แชท** ยิง { peerCoreUserId } แล้วเปิดห้อง', async () => {
    const { onStarted } = setup();
    const chat = screen.getByRole('button', { name: 'แชท' });

    expect(chat).toBeDisabled();
    await userEvent.click(person(/อาจารย์สมชาย/));
    expect(chat).toBeEnabled();
    expect(screen.queryByPlaceholderText('ชื่อกลุ่ม (ไม่บังคับ)')).not.toBeInTheDocument();

    await userEvent.click(chat);

    expect(api.post).toHaveBeenCalledWith('/direct-channels', { peerCoreUserId: 'user-003' });
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ id: 'ch-new' }));
  });

  it('**สองคนขึ้นไป = สร้างแชทกลุ่ม** พร้อมชื่อกลุ่ม (ไม่บังคับ)', async () => {
    setup();

    await userEvent.click(person(/อาจารย์สมชาย/));
    await userEvent.click(person(/มะลิ/));

    const create = screen.getByRole('button', { name: 'สร้างแชทกลุ่ม' });

    await userEvent.type(screen.getByPlaceholderText('ชื่อกลุ่ม (ไม่บังคับ)'), 'ติวสอบ');
    await userEvent.click(create);

    expect(api.post).toHaveBeenCalledWith('/direct-channels', {
      peerCoreUserIds: ['user-003', 'user-004'],
      name: 'ติวสอบ',
    });
  });

  it('ชิปของคนที่เลือกลบได้ทั้งปุ่ม × และ Backspace ในช่องว่าง', async () => {
    setup();

    await userEvent.click(person(/อาจารย์สมชาย/));
    await userEvent.click(person(/มะลิ/));

    await userEvent.click(screen.getByRole('button', { name: 'เอา อาจารย์สมชาย ออก' }));
    expect(screen.queryByRole('button', { name: 'เอา อาจารย์สมชาย ออก' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('ค้นหาคน'));
    await userEvent.keyboard('{Backspace}');

    expect(screen.queryByRole('button', { name: 'เอา มะลิ ออก' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แชท' })).toBeDisabled();
  });

  it('พิมพ์ค้นแล้วรายการเปลี่ยนเป็นผลค้นหาจาก /search?kind=people (ตัดตัวเองออก)', async () => {
    api.list.mockResolvedValue({
      items: [
        { kind: 'people', id: 'user-007', title: 'ผลค้นหา' },
        { kind: 'people', id: 'user-002', title: 'ตัวเอง' },
      ],
      meta: {},
    });

    setup();

    await userEvent.type(screen.getByLabelText('ค้นหาคน'), 'ผล');

    const results = await screen.findByRole('list', { name: 'ผลการค้นหา' }, { timeout: 2000 });

    await waitFor(() => expect(within(results).getAllByRole('button')).toHaveLength(1));
    expect(api.list).toHaveBeenCalledWith(expect.stringContaining('kind=people'));
  });

  it('← กลับ และ ✕ ปิด', async () => {
    const { onBack, onClose } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'กลับ' }));
    await userEvent.click(screen.getByRole('button', { name: 'ปิด' }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
