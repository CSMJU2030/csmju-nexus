import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRail } from './app-rail';

/// เทสต์แถบไอคอนซ้ายแบบ Instagram
///
/// แถบไม่มีข้อความ — ทุกปุ่มต้องมีชื่อให้โปรแกรมอ่านหน้าจอ และตัวเลขที่ค้าง
/// ต้องมาจากข้อมูลจริง (ห้องแชทส่วนตัวที่ยังไม่อ่าน) ไม่ใช่เลขตกแต่ง

const apiList = vi.hoisted(() => vi.fn());
const pickTheme = vi.hoisted(() => vi.fn());
const me = vi.hoisted(() => ({
  current: { id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' },
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/feed' }));
vi.mock('@/lib/csmju/api', () => ({
  api: { list: apiList, get: vi.fn().mockResolvedValue({ unreadCount: 0 }) },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => me.current,
  useSignOut: () => vi.fn().mockResolvedValue(undefined),
}));
// กระดิ่งมีการต่อ socket ของมันเอง — ไม่ใช่สิ่งที่เทสต์นี้ตรวจ
vi.mock('@/components/csmju/notification-bell', () => ({
  NotificationBell: () => <button type="button" aria-label="การแจ้งเตือน" />,
}));
// ตัวสลับธีมอ่าน matchMedia ซึ่ง jsdom ไม่มี — มีเทสต์ของมันเองแยกไว้แล้ว
vi.mock('@/components/csmju/theme-toggle', () => ({
  ThemeToggle: () => <div role="radiogroup" aria-label="ธีมของหน้าจอ" />,
  useThemeChoice: () => ({ choice: 'system', dark: false, pick: pickTheme }),
}));
vi.mock('@/components/csmju/user-name', () => ({
  Avatar: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
  useProfile: (coreUserId: string) => ({ coreUserId, displayName: coreUserId, avatarUrl: null, syncedAt: null, badge: null }),
}));

function renderRail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <AppRail />
    </QueryClientProvider>,
  );
}

const dm = (unread: number, peer: string) => ({
  id: `dm-${peer}`,
  kind: 'DM',
  unreadCount: unread,
  peerCoreUserId: peer,
  inboxFolder: 'PRIMARY',
});

beforeEach(() => {
  apiList.mockReset();
  apiList.mockResolvedValue({ items: [], meta: {} });
  me.current = { ...me.current, coreRole: 'student' };
});

describe('แถบไอคอนซ้าย', () => {
  it('ทุกโหมดของระบบมีปุ่มพร้อมชื่อ — Instagram · Discord · Teams', () => {
    renderRail();

    for (const name of ['หน้าหลัก', 'Reels', 'ข้อความ', 'ค้นหา', 'ห้อง', 'นัดประชุม', 'โปรไฟล์ของฉัน']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'สร้าง' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เพิ่มเติม' })).toBeInTheDocument();
  });

  it('หน้าปัจจุบันถูกระบุด้วย aria-current', () => {
    renderRail();

    expect(screen.getByRole('link', { name: 'หน้าหลัก' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Reels' })).not.toHaveAttribute('aria-current');
  });

  it('**ตัวเลขบนปุ่มข้อความ = ผลรวมแชทส่วนตัวและแชทกลุ่มที่ยังไม่อ่านจริง** (ไม่นับคำขอ แชทที่ซ่อน และห้องแชท)', async () => {
    apiList.mockResolvedValue({
      items: [
        dm(2, 'user-003'),
        dm(1, 'user-004'),
        { id: 'gd', kind: 'GROUP_DM', unreadCount: 4, peerCoreUserId: null, inboxFolder: 'GENERAL' },
        { ...dm(5, 'user-005'), inboxFolder: 'REQUEST' },
        { ...dm(6, 'user-006'), inboxFolder: 'HIDDEN' },
        { id: 'g', kind: 'GROUP', unreadCount: 9, peerCoreUserId: null, inboxFolder: null },
      ],
      meta: {},
    });
    renderRail();

    expect(await screen.findByRole('link', { name: 'ข้อความ (7 ยังไม่อ่าน)' })).toBeInTheDocument();
  });

  it('นักศึกษาไม่เห็นปุ่มแดชบอร์ดผู้ดูแล · บุคลากรเห็น', () => {
    const { unmount } = renderRail();

    expect(screen.queryByRole('link', { name: 'แดชบอร์ด' })).not.toBeInTheDocument();
    unmount();

    me.current = { ...me.current, coreRole: 'staff' };
    renderRail();

    expect(screen.getByRole('link', { name: 'แดชบอร์ด' })).toBeInTheDocument();
  });

  it('เมนูสร้างพาไปหน้าที่เปิดกล่องสร้างให้ทันที', async () => {
    renderRail();

    await userEvent.click(screen.getByRole('button', { name: 'สร้าง' }));

    expect(screen.getByRole('menuitem', { name: /โพสต์/ })).toHaveAttribute('href', '/feed?create=post');
    expect(screen.getByRole('menuitem', { name: /คลิปสั้น/ })).toHaveAttribute('href', '/reels?create=1');
    expect(screen.getByRole('menuitem', { name: /ห้อง/ })).toHaveAttribute('href', '/chat?create=1');
  });

  it('Esc ปิดเมนู', async () => {
    renderRail();

    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มเติม' }));
    expect(screen.getByRole('menuitem', { name: 'ออกจากระบบ' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'ออกจากระบบ' })).not.toBeInTheDocument());
  });

  it('**เมนู ≡ → สลับโหมด → สวิตช์โหมดมืด** เปลี่ยนธีมจริง และย้อนกลับได้', async () => {
    pickTheme.mockReset();
    renderRail();

    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มเติม' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'สลับโหมด' }));

    const toggle = screen.getByRole('switch', { name: 'โหมดมืด' });

    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);
    expect(pickTheme).toHaveBeenCalledWith('dark');

    await userEvent.click(screen.getByRole('button', { name: 'กลับไปเมนูเพิ่มเติม' }));
    expect(screen.getByRole('menuitem', { name: 'การตั้งค่า' })).toHaveAttribute('href', '/settings');
  });
});
