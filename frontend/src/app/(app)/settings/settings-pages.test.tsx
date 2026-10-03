import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isPaused, NotificationsSection } from './notifications/notifications-section';
import { BlockedSection, CloseFriendsSection } from './people-sections';
import { ActivityStatusSection, CommentsSection } from './privacy-sections';
import type { NotificationPreferences } from './settings-types';

/// เทสต์หน้าตั้งค่าย่อย — ค่ามาจากหลังบ้านจริง · แตะแล้วบันทึกทันที (ย้อนกลับถ้าพัง)
/// · ตัวเลขใน "อนุญาตความคิดเห็นจาก" เป็นจำนวนคนจริง · ลบ/เลิกบล็อกต้องยืนยัน

const apiGet = vi.hoisted(() => vi.fn());
const apiList = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());
const apiDel = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({
  api: { get: apiGet, list: apiList, patch: apiPatch, put: apiPut, del: apiDel },
  ApiError: class extends Error {},
}));
vi.mock('@/components/csmju/user-name', async (original) => ({
  ...(await original<typeof import('@/components/csmju/user-name')>()),
  Avatar: () => <span />,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: `ชื่อ ${coreUserId}` }),
}));

const page = <T,>(items: T[]) => ({ items, meta: { page: 1, limit: 100, total: items.length, totalPages: 1 } });

const prefs: NotificationPreferences = {
  pausedUntil: null,
  likes: 'EVERYONE',
  comments: 'FOLLOWING',
  mentions: 'EVERYONE',
  commentLikes: 'ON',
  newFollowers: 'ON',
  reposts: 'ON',
  storyReplies: 'ON',
  messageRequests: 'ON',
  groupRequests: 'OFF',
  messages: 'PRIMARY_GENERAL',
};

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  for (const fn of [apiGet, apiList, apiPatch, apiPut, apiDel]) fn.mockReset();
  apiList.mockResolvedValue(page([]));
});

describe('การแจ้งเตือนแบบพุช', () => {
  it('isPaused ดูจากเวลาที่หยุดไว้จริง', () => {
    expect(isPaused({ pausedUntil: null })).toBe(false);
    expect(isPaused({ pausedUntil: '2026-10-01T10:00:00Z' }, Date.parse('2026-10-01T09:00:00Z'))).toBe(true);
    expect(isPaused({ pausedUntil: '2026-10-01T10:00:00Z' }, Date.parse('2026-10-01T11:00:00Z'))).toBe(false);
  });

  it('แสดงค่าปัจจุบัน · ตัวอย่างใช้ชื่อจริงของคนที่ติดตาม · แตะแล้ว PATCH ทันที', async () => {
    apiGet.mockResolvedValue(prefs);
    apiList.mockResolvedValue(page([{ coreUserId: 'user-003', createdAt: '' }]));
    apiPatch.mockImplementation((_path: string, patch: object) => Promise.resolve({ ...prefs, ...patch }));

    renderWith(<NotificationsSection />);

    const likes = await screen.findByRole('group', { name: 'การกดถูกใจ' });

    expect(likes.querySelector('input:checked')?.closest('label')).toHaveTextContent('จากทุกคน');
    expect(await screen.findByText(/ชื่อ user-003 ถูกใจคลิปของคุณ/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByText('ปิด')[0]);

    expect(apiPatch).toHaveBeenCalledWith('/me/notification-preferences', { likes: 'OFF' });
    // ตัวเลือกข้อความสามระดับตามจริง
    expect(screen.getByText('จากกล่องข้อความหลักและกล่องข้อความทั่วไป')).toBeInTheDocument();
    // ไม่มีแถวของฟีเจอร์ที่ระบบนี้ไม่มี
    expect(screen.queryByText(/วิดีโอถ่ายทอดสด|วันเกิด|ระดมทุน/)).not.toBeInTheDocument();
  });

  it('หลังบ้านปฏิเสธ → ค่าบนจอย้อนกลับ และบอกผู้ใช้', async () => {
    apiGet.mockResolvedValue(prefs);
    apiPatch.mockRejectedValue(new Error('บันทึกไม่ได้'));

    renderWith(<NotificationsSection />);

    const likes = await screen.findByRole('group', { name: 'การกดถูกใจ' });

    await userEvent.click(screen.getAllByText('ปิด')[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกไม่ได้');
    await waitFor(() =>
      expect(likes.querySelector('input:checked')?.closest('label')).toHaveTextContent('จากทุกคน'),
    );
  });

  it('หยุดชั่วคราวทั้งหมด: เปิดสวิตช์ → เลือกเวลา → ส่ง pauseMinutes', async () => {
    apiGet.mockResolvedValue(prefs);
    apiPatch.mockImplementation(() =>
      Promise.resolve({ ...prefs, pausedUntil: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    renderWith(<NotificationsSection />);

    await userEvent.click(await screen.findByRole('switch', { name: 'หยุดชั่วคราวทั้งหมด' }));
    await userEvent.click(await screen.findByRole('button', { name: '1 ชั่วโมง' }));

    // ส่งแค่ pauseMinutes — pausedUntil เป็นค่าที่หลังบ้านคำนวณ ส่งไปจะได้ 400
    expect(apiPatch).toHaveBeenCalledWith('/me/notification-preferences', { pauseMinutes: 60 });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'หยุดชั่วคราวทั้งหมด' })).toHaveAttribute('aria-checked', 'true'),
    );
  });
});

describe('ความคิดเห็นและสถานะกิจกรรม', () => {
  it('ตัวเลือก "อนุญาตความคิดเห็นจาก" มีจำนวนคนจริงจาก audience-counts', async () => {
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/me/audience-counts'
          ? { following: 12, followers: 30, mutual: 5 }
          : { commentsFrom: 'EVERYONE', showActivityStatus: true, showInSuggestions: true },
      ),
    );
    apiPatch.mockResolvedValue({ commentsFrom: 'MUTUAL', showActivityStatus: true, showInSuggestions: true });

    renderWith(<CommentsSection />);

    expect(await screen.findByText('คนที่คุณติดตาม · 12 คน')).toBeInTheDocument();
    expect(screen.getByText('ผู้ติดตามของคุณ · 30 คน')).toBeInTheDocument();

    await userEvent.click(screen.getByText('คนที่คุณติดตามและผู้ติดตามของคุณ · 5 คน'));

    expect(apiPatch).toHaveBeenCalledWith('/me/privacy', { commentsFrom: 'MUTUAL' });
  });

  it('สวิตช์สถานะกิจกรรมบันทึก showActivityStatus', async () => {
    apiGet.mockResolvedValue({ commentsFrom: 'EVERYONE', showActivityStatus: true, showInSuggestions: false });
    apiPatch.mockResolvedValue({ commentsFrom: 'EVERYONE', showActivityStatus: false, showInSuggestions: false });

    renderWith(<ActivityStatusSection />);

    const toggle = await screen.findByRole('switch', { name: 'แสดงสถานะกิจกรรม' });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'แสดงบัญชีของคุณในคำแนะนำ' })).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);

    expect(apiPatch).toHaveBeenCalledWith('/me/privacy', { showActivityStatus: false });
  });
});

describe('เพื่อนสนิทและถูกบล็อก', () => {
  it('เพื่อนสนิทเลือกจากคนที่ติดตาม · ค้นหาได้ · ติ๊กแล้ว PUT ทันที', async () => {
    apiList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/follows/following')
          ? page([{ coreUserId: 'user-003' }, { coreUserId: 'user-004' }])
          : page([{ coreUserId: 'user-004', createdAt: '' }]),
      ),
    );
    apiGet.mockResolvedValue([
      { coreUserId: 'user-003', displayName: 'อาจารย์สมชาย' },
      { coreUserId: 'user-004', displayName: 'เพื่อนร่วมห้อง' },
    ]);
    apiPut.mockResolvedValue(undefined);

    renderWith(<CloseFriendsSection />);

    const somchai = await screen.findByRole('checkbox', { name: 'เพื่อนสนิท: อาจารย์สมชาย' });

    expect(somchai).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: 'เพื่อนสนิท: เพื่อนร่วมห้อง' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(somchai);
    expect(apiPut).toHaveBeenCalledWith('/close-friends/user-003');
    expect(somchai).toHaveAttribute('aria-checked', 'true');

    await userEvent.type(screen.getByRole('searchbox'), 'สมชาย');
    expect(screen.queryByRole('checkbox', { name: 'เพื่อนสนิท: เพื่อนร่วมห้อง' })).not.toBeInTheDocument();
  });

  it('เลิกบล็อกต้องยืนยันก่อน แล้ว DELETE /blocks/:coreUserId', async () => {
    apiList.mockResolvedValue(page([{ coreUserId: 'user-009', createdAt: '' }]));
    apiDel.mockResolvedValue(undefined);

    renderWith(<BlockedSection />);

    await userEvent.click(await screen.findByRole('button', { name: 'เลิกบล็อก' }));

    expect(apiDel).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'เลิกบล็อก ชื่อ user-009 ใช่ไหม' })).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: 'เลิกบล็อก' });

    await userEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/blocks/user-009'));
    expect(await screen.findByText('ยังไม่มีบัญชีที่ถูกบล็อก')).toBeInTheDocument();
  });
});
