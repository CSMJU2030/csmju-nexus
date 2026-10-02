'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bookmark,
  CalendarDays,
  Hash,
  House,
  Menu,
  Plus,
  Search,
  Send,
  Settings,
  Shapes,
  ShieldCheck,
  SquarePlay,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  CORE_HOME,
  CREATE_ITEMS,
  isActivePath,
  useDirectUnread,
} from '@/components/csmju/app-rail';
import { NotificationBell } from '@/components/csmju/notification-bell';
import { SessionCard } from '@/components/csmju/session-card';
import { useThemeChoice } from '@/components/csmju/theme-toggle';
import { Avatar } from '@/components/csmju/user-name';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { isStaffLike } from '@/lib/csmju/roles';
import { useMe } from '@/lib/csmju/session';

/// แถบบนและแถบล่างของจอมือถือ แบบ Instagram บนเว็บมือถือ
///
///   บน   ชื่อระบบตัวเขียน · ช่องค้นหา · หัวใจ · ≡
///   ล่าง  หน้าหลัก · ค้นหา · คลิปสั้น · + · ข้อความ · ห้อง · โปรไฟล์
///
/// Instagram ใช้ช่องที่หกเป็นแดชบอร์ด — ระบบนี้ใช้เป็น "ห้อง" แบบ Discord (ช่องข้อความ
/// และช่องสำหรับพูดอยู่ในหน้าเดียวกัน) เพราะเป็นสิ่งที่นักศึกษาเปิดบ่อยกว่า ส่วนที่เหลือ
/// (นัดประชุม ที่บันทึก ธีม ออกจากระบบ) อยู่ในแผ่นเมนูจากปุ่ม ≡

type Sheet = 'menu' | 'create' | null;

function useSheet() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pathAtOpen, setPathAtOpen] = useState(pathname);

  if (pathname !== pathAtOpen) {
    setPathAtOpen(pathname);
    setSheet(null);
  }

  return [sheet, setSheet] as const;
}

/// แผ่นที่เลื่อนขึ้นจากขอบล่าง — ใช้ทั้งเมนูและปุ่มสร้าง
///
/// **วาดผ่าน portal ไปที่ <body>** — แผ่นเมนูของแถบบนอยู่ใต้ <header> ที่เป็น
/// sticky z-30 ซึ่งสร้าง stacking context ของตัวเอง ต่อให้ตั้ง z-80 ก็ขึ้นไป
/// เหนือแถบล่าง (z-60) ไม่ได้ ขอบล่างของแผ่นจึงถูกแถบล่างทับ (พบ 29 ก.ย. 2569)
function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useModalFocus<HTMLDivElement>(true, onClose);

  return createPortal(
    <>
      <button
        type="button"
        aria-label="ปิด"
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-black/60 animate-in fade-in-0 duration-150 lg:hidden"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-[80] max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-popover pb-[max(1rem,env(safe-area-inset-bottom))] outline-none animate-in slide-in-from-bottom duration-200 lg:hidden"
      >
        <div className="sticky top-0 flex items-center justify-center bg-popover pb-2 pt-2.5">
          <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="grid size-8 place-items-center rounded-full hover:bg-accent"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}

const SHEET_ROW =
  'flex h-12 w-full items-center gap-3 px-4 text-left text-[0.9375rem] transition-colors active:bg-accent';

const MENU_LINKS: { href: string; label: string; icon: LucideIcon; staffOnly?: boolean }[] = [
  { href: '/meetings', label: 'นัดประชุม', icon: CalendarDays },
  { href: '/saved', label: 'บันทึกไว้', icon: Bookmark },
  { href: '/settings', label: 'การตั้งค่า', icon: Settings },
  { href: '/admin', label: 'แดชบอร์ด', icon: ShieldCheck, staffOnly: true },
];

export function MobileTopBar() {
  const pathname = usePathname();
  const me = useMe();
  const theme = useThemeChoice();
  const [sheet, setSheet] = useSheet();
  const canAdmin = isStaffLike(me.coreRole);

  return (
    <header className="sticky top-0 z-30 flex h-[3.25rem] shrink-0 items-center gap-3 border-b border-border bg-background px-3 lg:hidden">
      <Link href="/feed" className="shrink-0 font-[Segoe_Script,Brush_Script_MT,cursive] text-[1.45rem] leading-none">
        CS Nexus
      </Link>

      {/* หน้าค้นหามีช่องค้นหาของตัวเองอยู่แล้ว — ถ้าคงช่องนี้ไว้จะเห็นสองช่องซ้อนกัน */}
      {isActivePath(pathname, '/search') ? (
        <span className="flex-1" />
      ) : (
        <Link
          href="/search"
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted px-3 text-muted-foreground"
        >
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="truncate text-sm">ค้นหา</span>
        </Link>
      )}

      <NotificationBell />

      <button
        type="button"
        onClick={() => setSheet('menu')}
        aria-label="เมนูเพิ่มเติม"
        aria-expanded={sheet === 'menu'}
        className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-accent"
      >
        <Menu aria-hidden className="size-6" strokeWidth={1.9} />
      </button>

      {sheet === 'menu' && (
        <BottomSheet title="เพิ่มเติม" onClose={() => setSheet(null)}>
          <nav aria-label="เมนูเพิ่มเติม">
            {MENU_LINKS.filter((item) => !item.staffOnly || canAdmin).map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={SHEET_ROW}>
                <Icon aria-hidden className="size-5" strokeWidth={1.9} />
                {label}
              </Link>
            ))}
            {CORE_HOME && (
              <a href={CORE_HOME} className={SHEET_ROW}>
                <Shapes aria-hidden className="size-5" strokeWidth={1.9} />
                บัญชีกลาง CSMJU2030
              </a>
            )}
          </nav>

          <div className="flex h-12 items-center gap-3 px-4">
            <span className="flex-1 text-[0.9375rem]">โหมดมืด</span>
            <button
              type="button"
              role="switch"
              aria-checked={theme.dark}
              aria-label="โหมดมืด"
              onClick={() => theme.pick(theme.dark ? 'light' : 'dark')}
              className={`relative h-6 w-10 rounded-full transition-colors ${
                theme.dark ? 'bg-foreground' : 'bg-muted-foreground/40'
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 size-5 rounded-full bg-background shadow transition-[left] duration-200 ${
                  theme.dark ? 'left-[1.125rem]' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          <div className="px-3 pt-2">
            <SessionCard />
          </div>
        </BottomSheet>
      )}
    </header>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const me = useMe();
  const { unread } = useDirectUnread();
  const [sheet, setSheet] = useSheet();
  const profileHref = `/profile/${encodeURIComponent(me.id)}`;

  const tab = (href: string, label: string, Icon: LucideIcon, fill = false) => {
    const active = isActivePath(pathname, href);

    return (
      <Link
        key={href}
        href={href}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className="relative grid flex-1 place-items-center py-3 active:opacity-60"
      >
        <Icon
          aria-hidden
          className={`size-6 ${active && fill ? 'fill-current' : ''}`}
          strokeWidth={active ? 2.6 : 1.9}
        />
      </Link>
    );
  };

  return (
    <>
      <nav
        aria-label="เมนูหลัก"
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="flex items-stretch">
          {tab('/feed', 'หน้าหลัก', House, true)}
          {tab('/search', 'ค้นหา', Search)}
          {tab('/reels', 'Reels', SquarePlay)}

          <button
            type="button"
            onClick={() => setSheet('create')}
            aria-label="สร้าง"
            aria-expanded={sheet === 'create'}
            className="grid flex-1 place-items-center py-3 active:opacity-60"
          >
            <Plus aria-hidden className="size-6" strokeWidth={1.9} />
          </button>

          <Link
            href="/messages"
            aria-label={`ข้อความ${unread > 0 ? ` (${unread} ยังไม่อ่าน)` : ''}`}
            aria-current={isActivePath(pathname, '/messages') ? 'page' : undefined}
            className="relative grid flex-1 place-items-center py-3 active:opacity-60"
          >
            <Send
              aria-hidden
              className="size-6 -rotate-12"
              strokeWidth={isActivePath(pathname, '/messages') ? 2.6 : 1.9}
            />
            {unread > 0 && (
              <span className="absolute left-1/2 top-1.5 ml-1 grid min-w-4.5 place-items-center rounded-full bg-badge px-1 text-[10px] font-bold leading-[1.125rem] text-white ring-2 ring-background">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>

          {tab('/chat', 'ห้อง', Hash)}

          <Link
            href={profileHref}
            aria-label="โปรไฟล์ของฉัน"
            aria-current={isActivePath(pathname, profileHref) ? 'page' : undefined}
            className="grid flex-1 place-items-center py-3 active:opacity-60"
          >
            <span
              className={`grid place-items-center rounded-full ${
                isActivePath(pathname, profileHref) ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : ''
              }`}
            >
              <Avatar coreUserId={me.id} size={24} showOnline={false} />
            </span>
          </Link>
        </div>
      </nav>

      {sheet === 'create' && (
        <BottomSheet title="สร้าง" onClose={() => setSheet(null)}>
          {CREATE_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={SHEET_ROW}>
              <Icon aria-hidden className="size-5" strokeWidth={1.9} />
              {label}
            </Link>
          ))}
        </BottomSheet>
      )}
    </>
  );
}
