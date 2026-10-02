'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Images,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react';
import { CORE_HOME } from '@/components/csmju/app-rail';
import { useMe } from '@/lib/csmju/session';

/// เปลือกหน้า "กิจกรรมของคุณ" — ตามหน้า Your activity ของ Instagram บนเว็บ
///
///   จอกว้าง  การ์ดกรอบเดียวกลางจอ ~935×745 · เมนูซ้าย 240px · ขวาเป็นแท็บ →
///            แถบเครื่องมือ → เนื้อหาที่เลื่อนได้ข้างในการ์ดเท่านั้น · ส่วนท้ายใต้การ์ด
///   มือถือ   `/activity` เป็นรายการเมนูเต็มจอ · กดแล้วเข้าหน้าหมวดที่มีปุ่มย้อนกลับ
///
/// มีสามหมวดเท่าที่ระบบนี้มีข้อมูลจริง — Instagram มี "รีโพสต์ / การตอบกลับสตอรี่ /
/// รีวิว" ด้วย แต่ระบบเราไม่มีสามอย่างนั้น จึงไม่วาดแท็บที่กดแล้วว่างเปล่าตลอดกาล

export interface ActivitySection {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const SECTIONS: ActivitySection[] = [
  {
    href: '/activity/interactions',
    title: 'การโต้ตอบ',
    description: 'ตรวจสอบและลบการกดถูกใจ ความคิดเห็น และการโต้ตอบอื่นๆ ของคุณ',
    icon: MessagesSquare,
  },
  {
    href: '/activity/media',
    title: 'รูปภาพและวิดีโอ',
    description: 'ดู จัดเก็บ หรือลบรูปภาพและวิดีโอที่คุณแชร์',
    icon: Images,
  },
  {
    href: '/activity/account-history',
    title: 'ประวัติบัญชี',
    description: 'ตรวจสอบการเปลี่ยนแปลงที่คุณทำไว้กับบัญชีของคุณตั้งแต่สร้างบัญชี',
    icon: History,
  },
];

/// `/activity` เฉย ๆ นับว่าอยู่หมวด "การโต้ตอบ" (จอกว้างเปิดหมวดนี้ไว้เลย)
export function activeSection(pathname: string): ActivitySection {
  return (
    SECTIONS.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`)) ??
    SECTIONS[0]
  );
}

export function ActivityShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onIndex = pathname === '/activity';
  const current = activeSection(pathname);

  return (
    <div className="mx-auto w-full max-w-[975px] md:px-5 md:pt-8">
      <div className="md:flex md:h-[745px] md:max-h-[calc(100dvh-7rem)] md:overflow-hidden md:rounded-sm md:border md:border-border">
        <aside
          aria-label="กิจกรรมของคุณ"
          className={`w-full shrink-0 md:flex md:w-[240px] md:flex-col md:border-r md:border-border ${
            onIndex ? 'block' : 'hidden'
          }`}
        >
          <ActivityMenu pathname={pathname} />
        </aside>

        <section
          aria-label={current.title}
          className={`min-w-0 flex-1 flex-col md:flex ${onIndex ? 'hidden' : 'flex'}`}
        >
          <MobileBack title={current.title} />
          {children}
        </section>
      </div>

      <ActivityFooter />
    </div>
  );
}

function ActivityMenu({ pathname }: { pathname: string }) {
  const me = useMe();
  const current = activeSection(pathname);

  return (
    <nav>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-6 md:py-4">
        <Link
          href={`/profile/${encodeURIComponent(me.id)}`}
          aria-label="กลับไปโปรไฟล์"
          className="-ml-1 grid size-8 place-items-center rounded-full hover:bg-accent md:hidden"
        >
          <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
        </Link>
        <h1 className="text-[17px] font-bold">กิจกรรมของคุณ</h1>
      </div>

      <ul>
        {SECTIONS.map((section) => {
          // มือถือที่ /activity ไม่มีหมวดไหน "ถูกเลือก" — ยังไม่ได้เข้าไปดูหมวดใด
          const active = section === current && pathname !== '/activity';
          const activeDesktop = section === current;
          const Icon = section.icon;

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active || activeDesktop ? 'page' : undefined}
                className={`relative flex items-start gap-4 px-4 py-4 transition-colors hover:bg-accent md:px-6 ${
                  activeDesktop
                    ? 'md:before:absolute md:before:inset-y-0 md:before:left-0 md:before:w-0.5 md:before:bg-foreground'
                    : ''
                }`}
              >
                <Icon aria-hidden strokeWidth={1.7} className="mt-0.5 size-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-csmju-label font-semibold">{section.title}</span>
                  <span className="mt-0.5 line-clamp-3 block text-csmju-caption leading-snug text-muted-foreground">
                    {section.description}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  strokeWidth={1.9}
                  className="mt-3 size-4 shrink-0 text-muted-foreground md:hidden"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/// มือถือไม่มีเมนูซ้าย — หัวหน้าหมวดต้องมีทางกลับไปรายการ
function MobileBack({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
      <Link
        href="/activity"
        aria-label="กลับไปกิจกรรมของคุณ"
        className="-ml-1 grid size-8 place-items-center rounded-full hover:bg-accent"
      >
        <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
      </Link>
      <p className="text-base font-bold">{title}</p>
    </div>
  );
}

/// ส่วนท้ายแบบ Instagram — **ลิงก์เฉพาะหน้าที่มีอยู่จริง** ที่เหลือเป็นข้อความเฉย ๆ
///
/// Instagram มี "เกี่ยวกับ · ความช่วยเหลือ · API · งาน" แต่ระบบเราไม่มีหน้าเหล่านั้น
/// ลิงก์ที่พาไปหน้า 404 แย่กว่าไม่มีลิงก์
const FOOTER_LINKS: { href: string; label: string }[] = [
  { href: '/feed', label: 'หน้าหลัก' },
  { href: '/reels', label: 'คลิปสั้น' },
  { href: '/search', label: 'ค้นหา' },
  { href: '/saved', label: 'ที่บันทึกไว้' },
  { href: '/archive', label: 'คลังสตอรี่' },
  { href: '/settings', label: 'การตั้งค่า' },
];

export function ActivityFooter() {
  return (
    <footer className="hidden px-4 pb-8 pt-10 text-center text-csmju-caption text-muted-foreground md:block">
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2">
        {FOOTER_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
        {CORE_HOME && (
          <li>
            <a href={CORE_HOME} className="hover:underline">
              บัญชีกลาง CSMJU2030
            </a>
          </li>
        )}
      </ul>
      <p className="mt-4 flex items-center justify-center gap-1">
        <span className="inline-flex items-center gap-0.5">
          ภาษาไทย
          <ChevronDown aria-hidden className="size-3" />
        </span>
        <span aria-hidden>·</span>
        <span>© 2026 CS Nexus</span>
        <span aria-hidden>·</span>
        <span>CSMJU2030</span>
      </p>
    </footer>
  );
}
