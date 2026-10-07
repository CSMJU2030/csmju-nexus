'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bookmark,
  CalendarDays,
  ChevronLeft,
  Clapperboard,
  Hash,
  House,
  Menu,
  MessageSquareWarning,
  Moon,
  Plus,
  Search,
  Send,
  Settings,
  Shapes,
  ShieldCheck,
  SquarePen,
  SquarePlay,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ReportProblemDialog, SwitchAccountDialog } from '@/components/csmju/account-dialogs';
import { NotificationBell } from '@/components/csmju/notification-bell';
import { useThemeChoice } from '@/components/csmju/theme-toggle';
import { inFolder } from '@/components/csmju/inbox-list';
import { Avatar } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { isStaffLike } from '@/lib/csmju/roles';
import { useMe, useSignOut } from '@/lib/csmju/session';
import type { Channel } from '@/lib/csmju/types';

/// แถบซ้ายแบบ Instagram — แคบ 72px ชี้แล้วขยายพร้อมชื่อเมนู (ดู .csmju-rail)
///
///   Instagram  หน้าหลัก · คลิปสั้น · ข้อความ · ค้นหา · การแจ้งเตือน · สร้าง
///   Discord    ห้อง (ช่องข้อความ + ช่องสำหรับพูดในหน้าเดียว · เสียงต่อค้างข้ามหน้า)
///   Teams      นัดประชุม
///
/// เมนู ≡ "เพิ่มเติม" เด้งขึ้นจากปุ่มแบบเดียวกับ Instagram (ย่อ-ขยายจากมุมล่างซ้าย)
/// และมีหน้าย่อย "สลับโหมด" ที่เป็นสวิตช์โหมดมืด

interface RailLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /// ไอคอนที่ถมสีได้ (บ้าน) ถมตอนเป็นหน้าปัจจุบันแบบ Instagram
  fillWhenActive?: boolean;
}

const TOP: RailLink[] = [
  { href: '/feed', label: 'หน้าหลัก', icon: House, fillWhenActive: true },
  { href: '/reels', label: 'Reels', icon: SquarePlay },
];

const TALK: RailLink[] = [
  { href: '/chat', label: 'ห้อง', icon: Hash },
  { href: '/meetings', label: 'นัดประชุม', icon: CalendarDays },
];

/// ปุ่ม + เปิดเมนูว่าจะสร้างอะไร — ทุกรายการเปิดกล่องสร้างให้ทันทีด้วย ?create=
export const CREATE_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/feed?create=post', label: 'โพสต์', icon: SquarePen },
  { href: '/reels?create=1', label: 'คลิปสั้น', icon: Clapperboard },
  { href: '/chat?create=1', label: 'ห้อง', icon: Users },
];

/// ศูนย์กลาง CSMJU2030 — ที่เดียวกับที่ผู้ใช้ล็อกอินมา
export const CORE_HOME = (() => {
  try {
    // NEXT_PUBLIC_CORE_LOGIN_URL เป็นชื่อเดิมของ SSO 1.0 — อ่านไว้เผื่อเครื่องที่ยังไม่ได้ตั้งค่าใหม่
    return new URL(
      process.env.NEXT_PUBLIC_CORE_HUB_WEB_URL ?? process.env.NEXT_PUBLIC_CORE_LOGIN_URL ?? '',
    ).origin;
  } catch {
    return null;
  }
})();

export const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + '/');

function RailItem({ link, pathname }: { link: RailLink; pathname: string }) {
  const active = isActivePath(pathname, link.href);
  const Icon = link.icon;

  return (
    <Link
      href={link.href}
      // ชื่อเมนูถูกซ่อนด้วย visibility ตอนแถบหุบ ซึ่งซ่อนจากโปรแกรมอ่านหน้าจอด้วย
      // จึงต้องมี aria-label ของตัวเอง
      aria-label={link.label}
      aria-current={active ? 'page' : undefined}
      data-active={active}
      className="csmju-rail-item"
    >
      <Icon
        aria-hidden
        className={`size-6 ${active && link.fillWhenActive ? 'fill-current' : ''}`}
        strokeWidth={active ? 2.6 : 1.9}
      />
      <span className="csmju-rail-label">{link.label}</span>
    </Link>
  );
}

/// ข้อความส่วนตัวที่ยังไม่อ่าน — ใช้คิวรีเดียวกับหน้าแชท จึงไม่ยิงซ้ำ
export function useDirectUnread() {
  const { data: channels = [] } = useQuery({
    queryKey: ['channels', 'mine'],
    queryFn: async () => (await api.list<Channel>('/channels?limit=50')).items,
    refetchInterval: 30_000,
  });

  // นับเฉพาะแชทที่อยู่ในกล่องหลักและทั่วไป (รวมแชทกลุ่ม) แบบเดียวกับแผงข้อความ —
  // คำขอข้อความกับแชทที่ซ่อนไว้ไม่ขึ้นเลขแดง เหมือน Instagram
  const direct = channels.filter((channel) => inFolder(channel, 'PRIMARY') || inFolder(channel, 'GENERAL'));

  return {
    direct,
    unread: direct.reduce((sum, channel) => sum + channel.unreadCount, 0),
    /// คู่สนทนาล่าสุดที่มีข้อความค้างก่อน แล้วค่อยเป็นคนอื่น
    peers: [...direct]
      .sort((a, b) => b.unreadCount - a.unreadCount)
      .map((channel) => channel.peerCoreUserId)
      .filter((id): id is string => Boolean(id)),
  };
}

/// สวิตช์เปิด-ปิดแบบ iOS/Instagram
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
        on ? 'bg-foreground' : 'bg-muted-foreground/40'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 size-5 rounded-full shadow transition-[left] duration-200 ${
          on ? 'left-[1.125rem] bg-background' : 'left-0.5 bg-background'
        }`}
      />
    </button>
  );
}

const MENU_ROW =
  'flex h-12 w-full items-center gap-3 rounded-lg px-4 text-left text-[0.9375rem] transition-colors hover:bg-accent';

export function AppRail() {
  const pathname = usePathname();
  const me = useMe();
  const signOut = useSignOut();
  const theme = useThemeChoice();
  const { unread } = useDirectUnread();
  const [menu, setMenu] = useState<'more' | 'mode' | 'create' | null>(null);
  const [dialog, setDialog] = useState<'switch' | 'report' | null>(null);
  const [pathAtOpen, setPathAtOpen] = useState(pathname);

  // เปลี่ยนหน้า = ปิดเมนู (ปรับระหว่าง render ไม่ใช่ใน effect กันจอกะพริบ)
  if (pathname !== pathAtOpen) {
    setPathAtOpen(pathname);
    setMenu(null);
  }

  const canAdmin = isStaffLike(me.coreRole);
  const profileHref = `/profile/${encodeURIComponent(me.id)}`;
  const onProfile = isActivePath(pathname, profileHref);
  const onMessages = isActivePath(pathname, '/messages');
  const toggle = (next: 'more' | 'create') =>
    setMenu((current) => (current === next || (next === 'more' && current === 'mode') ? null : next));

  return (
    // กล่องนอกจองที่ 72px ไว้ในเลย์เอาต์ — กล่องในขยายลอยทับเนื้อหาได้โดยไม่ดันหน้า
    <div className="relative z-40 w-[4.5rem] shrink-0 max-lg:hidden">
      <aside
        aria-label="เมนูหลัก"
        data-expanded={menu !== null}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMenu(null);
        }}
        className="csmju-rail absolute inset-y-0 left-0 flex flex-col border-r border-sidebar-border bg-sidebar px-3"
      >
        <Link href="/feed" aria-label="CS Nexus หน้าหลัก" className="csmju-rail-item csmju-rail-brand">
          {/* โลโก้สาขาในวงกลมขาวแบบหัวแถบของ Core Hub */}
          <span className="csmju-rail-icon csmju-logo-badge size-9 p-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์เล็กใน public ไม่ต้องผ่านตัวย่อรูป */}
            <img src="/csmju-mark.png" alt="" width={32} height={32} className="size-8 rounded-full object-contain" />
          </span>
          <span className="csmju-rail-label font-heading text-xl font-extrabold leading-none tracking-tight">
            CS Nexus
          </span>
        </Link>

        <nav className="flex min-h-0 flex-1 flex-col gap-1">
          {TOP.map((link) => (
            <RailItem key={link.href} link={link} pathname={pathname} />
          ))}

          <Link
            href="/messages"
            aria-current={onMessages ? 'page' : undefined}
            aria-label={`ข้อความ${unread > 0 ? ` (${unread} ยังไม่อ่าน)` : ''}`}
            data-active={onMessages}
            className="csmju-rail-item"
          >
            <Send aria-hidden className="size-6 -rotate-12" strokeWidth={onMessages ? 2.6 : 1.9} />
            {unread > 0 && (
              <span aria-hidden className="csmju-rail-badge">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
            <span className="csmju-rail-label">ข้อความ</span>
          </Link>

          <RailItem link={{ href: '/search', label: 'ค้นหา', icon: Search }} pathname={pathname} />

          <NotificationBell variant="rail" />

          <div className="relative">
            <button
              type="button"
              onClick={() => toggle('create')}
              aria-label="สร้าง"
              aria-expanded={menu === 'create'}
              aria-haspopup="menu"
              className={`csmju-rail-item ${menu === 'create' ? 'bg-sidebar-accent font-bold' : ''}`}
            >
              <Plus aria-hidden className="size-6" strokeWidth={menu === 'create' ? 2.6 : 1.9} />
              <span className="csmju-rail-label">สร้าง</span>
            </button>

            {menu === 'create' && (
              <div
                role="menu"
                aria-label="สร้าง"
                className="absolute left-0 top-full z-50 mt-1 w-[14.5rem] origin-top-left rounded-2xl bg-popover p-2 shadow-csmju-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
              >
                {CREATE_ITEMS.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} role="menuitem" className={MENU_ROW}>
                    {label}
                    <Icon aria-hidden className="ml-auto size-5" strokeWidth={1.9} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {TALK.map((link) => (
            <RailItem key={link.href} link={link} pathname={pathname} />
          ))}

          {canAdmin && (
            <RailItem
              link={{ href: '/admin', label: 'แดชบอร์ด', icon: ShieldCheck }}
              pathname={pathname}
            />
          )}

          <Link
            href={profileHref}
            aria-label="โปรไฟล์ของฉัน"
            aria-current={onProfile ? 'page' : undefined}
            data-active={onProfile}
            className="csmju-rail-item"
          >
            <span
              className={`csmju-rail-icon grid size-6 place-items-center rounded-full ${
                onProfile ? 'ring-2 ring-white ring-offset-1 ring-offset-sidebar' : ''
              }`}
            >
              <Avatar coreUserId={me.id} size={24} showOnline={false} />
            </span>
            <span className="csmju-rail-label">โปรไฟล์</span>
          </Link>
        </nav>

        <div className="relative mt-3 flex flex-col gap-1">
          {(menu === 'more' || menu === 'mode') && (
            <div
              role="menu"
              aria-label={menu === 'mode' ? 'สลับโหมด' : 'เพิ่มเติม'}
              // เด้งขึ้นจากปุ่ม ≡ — ย่อ-ขยายจากมุมล่างซ้ายแบบเมนู "เพิ่มเติม" ของ Instagram
              className="absolute bottom-full left-0 z-50 mb-2 w-[16.5rem] origin-bottom-left overflow-hidden rounded-2xl bg-popover shadow-csmju-lg animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-150"
            >
              {menu === 'more' ? (
                <>
                  <div className="p-2">
                    <Link href="/settings" role="menuitem" className={MENU_ROW}>
                      <Settings aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
                      การตั้งค่า
                    </Link>
                    <Link href="/activity" role="menuitem" className={MENU_ROW}>
                      <Activity aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
                      กิจกรรมของคุณ
                    </Link>
                    <Link href="/saved" role="menuitem" className={MENU_ROW}>
                      <Bookmark aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
                      บันทึกไว้
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setMenu('mode')}
                      className={MENU_ROW}
                    >
                      <Moon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
                      สลับโหมด
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        setDialog('report');
                      }}
                      className={MENU_ROW}
                    >
                      <MessageSquareWarning aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
                      รายงานปัญหา
                    </button>
                  </div>

                  {/* แถบคั่นหนาแบบ Instagram — แยกเรื่องบัญชีออกจากเมนูทั่วไป */}
                  <span aria-hidden className="block h-1.5 bg-border/60" />

                  <div className="p-2">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        setDialog('switch');
                      }}
                      className={MENU_ROW}
                    >
                      สลับบัญชี
                    </button>
                  </div>

                  <span aria-hidden className="block h-px bg-border/60" />

                  <div className="p-2">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut().catch(() => undefined)}
                      className={MENU_ROW}
                    >
                      ออกจากระบบ
                    </button>
                  </div>
                </>
              ) : (
                <div className="animate-in fade-in-0 slide-in-from-right-2 duration-150">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setMenu('more')}
                      aria-label="กลับไปเมนูเพิ่มเติม"
                      className="grid size-8 place-items-center rounded-full hover:bg-accent"
                    >
                      <ChevronLeft aria-hidden className="size-5" />
                    </button>
                    <span className="flex-1 font-semibold">สลับโหมด</span>
                    <Moon aria-hidden className="size-5 text-muted-foreground" />
                  </div>

                  <div className="p-2">
                    <div className="flex h-12 items-center gap-3 rounded-lg px-4 hover:bg-accent">
                      <span className="flex-1 text-[0.9375rem]">โหมดมืด</span>
                      <Switch
                        on={theme.dark}
                        label="โหมดมืด"
                        onToggle={() => theme.pick(theme.dark ? 'light' : 'dark')}
                      />
                    </div>

                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => toggle('more')}
            aria-label="เพิ่มเติม"
            aria-expanded={menu === 'more' || menu === 'mode'}
            aria-haspopup="menu"
            className={`csmju-rail-item ${menu === 'more' || menu === 'mode' ? 'font-bold' : ''}`}
          >
            <Menu
              aria-hidden
              className={`size-6 transition-transform duration-200 ${
                menu === 'more' || menu === 'mode' ? 'scale-110' : ''
              }`}
              strokeWidth={menu === 'more' || menu === 'mode' ? 2.6 : 1.9}
            />
            <span className="csmju-rail-label">เพิ่มเติม</span>
          </button>

          {CORE_HOME && (
            <a href={CORE_HOME} aria-label="ระบบอื่นใน CSMJU2030" className="csmju-rail-item">
              <Shapes aria-hidden className="size-6" strokeWidth={1.9} />
              <span className="csmju-rail-label">ระบบอื่นใน CSMJU2030</span>
            </a>
          )}
        </div>
      </aside>

      <SwitchAccountDialog open={dialog === 'switch'} onOpenChange={(next) => setDialog(next ? 'switch' : null)} />
      <ReportProblemDialog open={dialog === 'report'} onOpenChange={(next) => setDialog(next ? 'report' : null)} />

      {menu && (
        // คลิกนอกเมนูแล้วปิด
        <button
          type="button"
          aria-label="ปิดเมนู"
          tabIndex={-1}
          onClick={() => setMenu(null)}
          className="fixed inset-0 -z-10 cursor-default"
        />
      )}
    </div>
  );
}
