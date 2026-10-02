import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile, ProfileDetail } from '@/lib/csmju/types';
import { ProfileHeader } from './profile-header';

/// เทสต์หัวโปรไฟล์แบบ Instagram
///
/// ของตัวเองต้องพาไปหน้าตั้งค่า (ไม่มีปุ่มติดตามตัวเอง) · ของคนอื่นต้องไม่
/// เลิกติดตามทันทีที่กด "กำลังติดตาม" · ปุ่มข้อความต้องเปิดห้องส่วนตัวจริง

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, post: apiPost },
  ApiError: class extends Error {},
}));
const signOut = vi.hoisted(() => vi.fn());
const notes = vi.hoisted(() => ({ current: [] as { coreUserId: string; text: string; isMe: boolean }[] }));

vi.mock('@/lib/csmju/session', () => ({ useSignOut: () => signOut }));
vi.mock('@/components/csmju/messages-notes', () => ({ useNotes: () => ({ data: notes.current }) }));
vi.mock('@/components/csmju/profile-settings-form', () => ({ CORE_HOME: 'http://core.test' }));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
}));

const profile = (overrides: Partial<ProfileDetail> = {}): ProfileDetail => ({
  coreUserId: 'user-003',
  displayName: 'อ.สมชาย',
  avatarUrl: null,
  syncedAt: '2026-09-01T00:00:00Z',
  badge: 'STAFF',
  stats: { reelCount: 2, postCount: 3, followerCount: 1200, followingCount: 7 },
  relation: { following: false, followedBy: false, mutual: false },
  layer2Role: null,
  joinedAt: null,
  bio: null,
  coverUrl: null,
  ...overrides,
});

function renderHeader(props: Partial<Parameters<typeof ProfileHeader>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handlers = {
    onToggleFollow: vi.fn(),
    onToggleSuggestions: vi.fn(),
    onOpenList: vi.fn(),
  };

  render(
    <QueryClientProvider client={client}>
      <ProfileHeader
        profile={profile()}
        mine={null}
        isMe={false}
        handle="user-003"
        busy={false}
        suggestionsOpen
        hasSuggestions={false}
        {...handlers}
        {...props}
      />
    </QueryClientProvider>,
  );

  return handlers;
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  push.mockReset();
  // ไม่มีใครมีสตอรี่ — รูปโปรไฟล์ไม่มีวงแหวน
  apiGet.mockResolvedValue([]);
});

describe('หัวโปรไฟล์', () => {
  it('ตัวเลขโพสต์ = กระทู้ + คลิป และกดผู้ติดตาม/กำลังติดตามเปิดรายชื่อ', async () => {
    const { onOpenList } = renderHeader();

    expect(screen.getByRole('list', { name: 'สถิติ' })).toHaveTextContent('5โพสต์');

    await userEvent.click(screen.getByRole('button', { name: /^ผู้ติดตาม 1,200 คน/ }));
    expect(onOpenList).toHaveBeenLastCalledWith('followers');

    await userEvent.click(screen.getByRole('button', { name: /^กำลังติดตาม 7 คน/ }));
    expect(onOpenList).toHaveBeenLastCalledWith('following');
  });

  it('โปรไฟล์ตัวเอง: แก้ไขโปรไฟล์ไป /settings/edit · ดูคลังไป /archive · ไม่มีปุ่มติดตาม', () => {
    const mine: MyProfile = {
      ...profile({ coreUserId: 'user-002', badge: null }),
      bio: 'ปี 3 สนใจ backend',
      coverUrl: null,
      managedByCore: ['displayName'],
    };

    renderHeader({ profile: mine, mine, isMe: true, handle: 'user-002 · student@core.local' });

    expect(screen.getByRole('link', { name: 'แก้ไขโปรไฟล์' })).toHaveAttribute('href', '/settings/edit');
    expect(screen.getByRole('link', { name: 'ดูคลัง' })).toHaveAttribute('href', '/archive');
    expect(screen.getByText('ปี 3 สนใจ backend')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ติดตาม' })).not.toBeInTheDocument();
  });

  it('ฟันเฟืองเปิดกล่องตัวเลือกแบบ Instagram — มีเฉพาะที่ทำได้จริง และออกจากระบบได้', async () => {
    const mine: MyProfile = { ...profile({ coreUserId: 'user-002' }), bio: null, coverUrl: null, managedByCore: [] };

    renderHeader({ profile: mine, mine, isMe: true, handle: 'user-002' });

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือก' }));

    expect(await screen.findByRole('link', { name: 'การแจ้งเตือน' })).toHaveAttribute('href', '/settings/notifications');
    expect(screen.getByRole('link', { name: 'การตั้งค่าและความเป็นส่วนตัว' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'กิจกรรมการเข้าสู่ระบบ' })).toHaveAttribute('href', 'http://core.test');
    // คิวอาร์โค้ดต้องใช้ไลบรารีที่ whitelist ไม่อนุญาต — ไม่มีปุ่มหลอก
    expect(screen.queryByText(/คิวอาร์/)).not.toBeInTheDocument();

    signOut.mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('ฟองโน้ตบนรูปโปรไฟล์ตัวเองแสดงโน้ตจริง และพาไปแก้ที่หน้าข้อความ', () => {
    notes.current = [{ coreUserId: 'user-002', text: 'อ่านหนังสือสอบ', isMe: true }];

    const mine: MyProfile = { ...profile({ coreUserId: 'user-002' }), bio: null, coverUrl: null, managedByCore: [] };

    renderHeader({ profile: mine, mine, isMe: true, handle: 'user-002' });

    expect(screen.getByRole('link', { name: /โน้ตของคุณ: อ่านหนังสือสอบ/ })).toHaveAttribute('href', '/messages?note=1');
    notes.current = [];
  });

  it('เว็บไซต์แสดงใต้คำแนะนำตัวเป็นโดเมน และเปิดแท็บใหม่แบบไม่ส่ง referrer', () => {
    renderHeader({ profile: { ...profile(), bio: 'สอน DS', website: 'https://csmju.ac.th/cs' } as ProfileDetail });

    const link = screen.getByRole('link', { name: 'csmju.ac.th/cs' });

    expect(link).toHaveAttribute('href', 'https://csmju.ac.th/cs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('โปรไฟล์คนอื่นไม่มีฟองโน้ตของเรา', () => {
    notes.current = [{ coreUserId: 'user-002', text: 'โน้ตของฉัน', isMe: true }];

    renderHeader();

    expect(screen.queryByText('โน้ตของฉัน')).not.toBeInTheDocument();
    notes.current = [];
  });

  it('ยังไม่ได้ติดตาม → ปุ่มติดตามหลัก · เขาติดตามเราอยู่ → "ติดตามกลับ"', async () => {
    const { onToggleFollow } = renderHeader({
      profile: profile({ relation: { following: false, followedBy: true, mutual: false } }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'ติดตามกลับ' }));
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it('**กด "กำลังติดตาม" ยังไม่เลิกติดตาม** — ต้องยืนยันในกล่องก่อน', async () => {
    const { onToggleFollow } = renderHeader({
      profile: profile({ relation: { following: true, followedBy: false, mutual: false } }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'กำลังติดตาม' }));
    expect(onToggleFollow).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: 'เลิกติดตาม' }));
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it('ปุ่มข้อความเปิดห้องส่วนตัวผ่าน /direct-channels แล้วพาไปหน้าข้อความ', async () => {
    apiPost.mockResolvedValue({ id: 'dm-42' });

    renderHeader();

    await userEvent.click(screen.getByRole('button', { name: 'ข้อความ' }));

    expect(apiPost).toHaveBeenCalledWith('/direct-channels', { peerCoreUserId: 'user-003' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/messages?channel=dm-42'));
  });

  it('**โปรไฟล์ของคนอื่นแสดงคำแนะนำตัว** ที่หลังบ้านส่งมา', () => {
    renderHeader({ profile: profile({ bio: 'สอนวิชา Data Structures' }) });

    expect(screen.getByText('สอนวิชา Data Structures')).toBeInTheDocument();
  });

  it('ปุ่มคนที่แนะนำขึ้นเฉพาะเมื่อหลังบ้านมีคนแนะนำจริง', async () => {
    const { onToggleSuggestions } = renderHeader({ hasSuggestions: true });

    await userEvent.click(screen.getByRole('button', { name: 'ซ่อนคนที่แนะนำ' }));
    expect(onToggleSuggestions).toHaveBeenCalledTimes(1);
  });

  it('รายงานผู้ใช้ต้องมีเหตุผลอย่างน้อย 10 ตัวอักษร แล้วส่ง targetKind USER', async () => {
    apiPost.mockResolvedValue({});

    renderHeader();

    await userEvent.click(screen.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }));
    await userEvent.click(await screen.findByRole('button', { name: 'รายงาน' }));

    const send = screen.getByRole('button', { name: 'ส่งรายงาน' });

    expect(send).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/รายงาน อ.สมชาย/), 'ส่งข้อความคุกคามรุ่นน้อง');
    await userEvent.click(send);

    expect(apiPost).toHaveBeenCalledWith('/reports', {
      targetKind: 'USER',
      targetId: 'user-003',
      reason: 'ส่งข้อความคุกคามรุ่นน้อง',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('ส่งรายงานแล้ว');
  });
});
