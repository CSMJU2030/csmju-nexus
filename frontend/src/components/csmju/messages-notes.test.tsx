import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/lib/csmju/types';
import { NoteComposer, noteLength, NOTES_KEY, NotesRow } from './messages-notes';

/// เทสต์แถวโน้ตและหน้า "โน้ตใหม่"
///
/// กฎที่ต้องคงไว้:
///   - ช่องแรกเป็นของเราเสมอ ("โน้ตของคุณ" · ฟองว่าง "แชร์โน้ต…" ถ้ายังไม่มี)
///   - ที่เหลือเป็นโน้ตจริงจาก GET /notes — ไม่มีฟองตัวอย่าง
///   - พิมพ์ได้ 60 ตัว (นับแบบที่ตาเห็น) · แชร์ = PUT · ลบ = DELETE
///   - เลือกได้ว่าใครเห็นโน้ต (ผู้ติดตามที่คุณติดตามกลับ / เพื่อนสนิท)

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/csmju/api', () => ({ api }));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 's@x', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/emoji-picker', () => ({
  EmojiPopover: ({ open, onPick }: { open: boolean; onPick: (emoji: string) => void }) =>
    open ? (
      <div role="dialog" aria-label="เลือกอีโมจิ">
        <button type="button" onClick={() => onPick('📚')}>
          📚
        </button>
      </div>
    ) : null,
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: () => <span />,
  useProfile: (id: string) => ({
    coreUserId: id,
    displayName: id === 'user-003' ? 'อาจารย์สมชาย' : id,
    avatarUrl: null,
    syncedAt: null,
    badge: null,
  }),
}));

const note = (over: Partial<Note> & Record<string, unknown>): Note => ({
  coreUserId: 'user-003',
  text: 'สอบวันศุกร์นะ',
  createdAt: '2026-09-30T01:00:00Z',
  expiresAt: '2026-10-01T01:00:00Z',
  isMe: false,
  ...over,
});

let client: QueryClient;

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('แถวโน้ต', () => {
  it('ยังไม่มีโน้ต = ฟองว่าง "แชร์โน้ต…" ตามด้วยโน้ตจริงของคนอื่น', async () => {
    api.get.mockResolvedValue([note({})]);

    wrap(<NotesRow onEditMine={() => {}} />);

    const list = screen.getByRole('list', { name: 'โน้ต' });

    expect(within(list).getByRole('button', { name: 'แชร์โน้ต' })).toHaveTextContent('แชร์โน้ต…');
    expect(within(list).getByRole('button', { name: 'แชร์โน้ต' })).toHaveTextContent('โน้ตของคุณ');
    expect(await within(list).findByText('สอบวันศุกร์นะ')).toBeInTheDocument();
    expect(list).toHaveTextContent('อาจารย์สมชาย');
  });

  it('กดโน้ตของเรา = เปิดหน้า "โน้ตใหม่" · กดโน้ตของคนอื่น = เปิดแชทกับคนนั้น', async () => {
    api.get.mockResolvedValue([note({})]);

    const onEditMine = vi.fn();
    const onOpenChat = vi.fn();

    wrap(<NotesRow onEditMine={onEditMine} onOpenChat={onOpenChat} />);

    await userEvent.click(screen.getByRole('button', { name: 'แชร์โน้ต' }));
    await userEvent.click(await screen.findByRole('button', { name: /โน้ตของ อาจารย์สมชาย/ }));

    expect(onEditMine).toHaveBeenCalledOnce();
    expect(onOpenChat).toHaveBeenCalledWith('user-003');
  });

  it('นับความยาวแบบที่ตาเห็น — อิโมจิหนึ่งตัวและสระไทยไม่นับเกิน', () => {
    expect(noteLength('😂')).toBe(1);
    expect(noteLength('ที่')).toBe(1);
    expect(noteLength('สวัสดี')).toBe(4);
  });
});

describe('หน้า "โน้ตใหม่"', () => {
  it('**แชร์** กดไม่ได้ตอนว่าง · พิมพ์แล้วยิง PUT /notes/me · ใส่อิโมจิได้', async () => {
    api.get.mockResolvedValue([]);
    api.put.mockResolvedValue(note({ coreUserId: 'user-002', text: 'อ่านหนังสืออยู่📚', isMe: true }));

    const onClose = vi.fn();

    wrap(<NoteComposer onClose={onClose} />);

    const share = await screen.findByRole('button', { name: 'แชร์' });

    expect(screen.getByRole('heading', { name: 'โน้ตใหม่' })).toBeInTheDocument();
    expect(share).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('แชร์ความคิด…'), 'อ่านหนังสืออยู่');
    await userEvent.click(screen.getByRole('button', { name: 'ใส่อิโมจิ' }));
    await userEvent.click(screen.getByRole('button', { name: '📚' }));
    expect(screen.getByText('11/60')).toBeInTheDocument();

    await userEvent.click(share);

    // ค่าเริ่มต้นของ IG: ผู้ติดตามที่คุณติดตามกลับ
    expect(api.put).toHaveBeenCalledWith('/notes/me', {
      text: 'อ่านหนังสืออยู่📚',
      audience: 'MUTUAL_FOLLOWERS',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.getQueryData<Note[]>(NOTES_KEY)?.[0].text).toBe('อ่านหนังสืออยู่📚');
  });

  it('เลือก "เพื่อนสนิท" แล้วส่งไปด้วย', async () => {
    api.get.mockResolvedValue([]);
    api.put.mockResolvedValue(note({ coreUserId: 'user-002', text: 'ติวไหม', isMe: true, audience: 'CLOSE_FRIENDS' }));

    wrap(<NoteComposer onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /แชร์กับผู้ติดตามที่คุณติดตามกลับ/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'เพื่อนสนิท' }));
    await userEvent.type(screen.getByPlaceholderText('แชร์ความคิด…'), 'ติวไหม');
    await userEvent.click(screen.getByRole('button', { name: 'แชร์' }));

    expect(api.put).toHaveBeenCalledWith('/notes/me', { text: 'ติวไหม', audience: 'CLOSE_FRIENDS' });
  });

  it('มีโน้ตอยู่แล้ว → ร่างเริ่มจากโน้ตเดิม และลบโน้ตได้ (DELETE /notes/me)', async () => {
    api.get.mockResolvedValue([note({ coreUserId: 'user-002', text: 'เดิม', isMe: true })]);
    api.del.mockResolvedValue(undefined);

    const onClose = vi.fn();

    wrap(<NoteComposer onClose={onClose} />);

    expect(await screen.findByPlaceholderText('แชร์ความคิด…')).toHaveValue('เดิม');
    await userEvent.click(screen.getByRole('button', { name: 'ลบโน้ต' }));

    expect(api.del).toHaveBeenCalledWith('/notes/me');
    await waitFor(() => expect(client.getQueryData<Note[]>(NOTES_KEY)).toEqual([]));
    expect(onClose).toHaveBeenCalled();
  });
});
