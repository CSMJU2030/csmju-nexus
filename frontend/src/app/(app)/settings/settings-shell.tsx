'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Ban,
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ExternalLink,
  KeyRound,
  MessageCircle,
  MessageCircleMore,
  Search,
  Star,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { CORE_HOME } from '@/components/csmju/profile-settings-form';
import { useMe } from '@/lib/csmju/session';

/// เปลือกหน้าตั้งค่าแบบ Instagram — เมนูซ้าย ~360px · เนื้อหาขวาเลื่อนแยกเอง
///
/// มือถือไม่มีที่วางสองคอลัมน์ จึงทำแบบแอป Instagram: `/settings` เป็นรายการ
/// เต็มจอ กดแล้วเข้าหน้าย่อยที่มีลูกศรย้อนกลับ · จอกว้าง `/settings` เปิด
/// "แก้ไขโปรไฟล์" ไว้เลยเพราะเป็นเหตุผลที่คนส่วนใหญ่เข้ามา
///
/// **มีแต่รายการที่ทำงานจริง** — ไม่มีสวิตช์ความเป็นส่วนตัวหรือการแจ้งเตือน
/// ที่หลังบ้านไม่รู้จัก สวิตช์ที่กดได้แต่ไม่มีผลอะไรแย่กว่าไม่มีสวิตช์เลย
/// เพราะผู้ใช้จะเชื่อว่าตั้งค่าไปแล้ว

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /// คำที่ช่องค้นหาควรเจอด้วย นอกจากชื่อรายการ
  keywords: string;
  /// หน้านี้นับว่า "อยู่ที่รายการนี้" ด้วย
  alsoActive?: string[];
}

/// หมวดตามหน้าตั้งค่าของ Instagram บนเว็บ — เฉพาะรายการที่ระบบนี้ทำได้จริง
///
/// ไม่มี "ภาษา" เพราะหน้าจอทั้งระบบเป็นภาษาไทยอย่างเดียว รายการภาษาที่กดแล้ว
/// ไม่เปลี่ยนอะไรคือการหลอกผู้ใช้ · ไม่มีรหัสผ่าน/อีเมล/กิจกรรมการเข้าสู่ระบบ
/// ในหมวดของเราเอง เพราะเป็นของบัญชีกลาง — อยู่ในหมวดสุดท้ายเป็นลิงก์ออกไป
const SECTIONS: { caption: string; items: Item[] }[] = [
  {
    caption: 'วิธีที่คุณใช้ CS Nexus',
    items: [
      {
        href: '/settings/edit',
        label: 'แก้ไขโปรไฟล์',
        icon: CircleUserRound,
        keywords: 'โปรไฟล์ คำแนะนำตัว bio รูปปก cover เว็บไซต์ website profile',
        alsoActive: ['/settings'],
      },
      {
        href: '/settings/notifications',
        label: 'การแจ้งเตือน',
        icon: Bell,
        keywords: 'แจ้งเตือน พุช หยุดชั่วคราว notification push',
      },
    ],
  },
  {
    caption: 'ใครบ้างที่สามารถดูเนื้อหาของคุณได้',
    items: [
      {
        href: '/settings/close-friends',
        label: 'เพื่อนสนิท',
        icon: Star,
        keywords: 'เพื่อนสนิท close friends สตอรี่',
      },
      {
        href: '/settings/blocked',
        label: 'ถูกบล็อก',
        icon: Ban,
        keywords: 'บล็อก block blocked',
      },
      {
        href: '/settings/activity-status',
        label: 'สถานะกิจกรรม',
        icon: Activity,
        keywords: 'สถานะกิจกรรม ออนไลน์ activity status online คำแนะนำ',
      },
    ],
  },
  {
    caption: 'วิธีที่คนอื่นๆ สามารถโต้ตอบกับคุณได้',
    items: [
      {
        href: '/settings/comments',
        label: 'ความคิดเห็น',
        icon: MessageCircle,
        keywords: 'ความคิดเห็น คอมเมนต์ comments',
      },
      {
        href: '/messages?view=requests',
        label: 'ข้อความ',
        icon: MessageCircleMore,
        keywords: 'ข้อความ คำขอส่งข้อความ messages requests',
      },
    ],
  },
  {
    caption: 'ส่วนตัว',
    items: [
      {
        href: '/settings/theme',
        label: 'ธีม',
        icon: SunMoon,
        keywords: 'ธีม โหมดมืด สว่าง dark light theme',
      },
    ],
  },
];

const ROW =
  'flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-csmju-label transition-colors hover:bg-accent';

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onIndex = pathname === '/settings';

  return (
    <div className="flex min-h-full md:h-full">
      {/* มือถือ: เห็นเมนูเฉพาะที่ /settings · จอกว้าง: เห็นเสมอ */}
      <aside
        aria-label="การตั้งค่า"
        className={`w-full shrink-0 md:block md:w-[360px] md:overflow-y-auto md:border-r md:border-border ${
          onIndex ? 'block' : 'hidden'
        }`}
      >
        <SettingsMenu pathname={pathname} />
      </aside>

      <div
        className={`min-w-0 flex-1 md:block md:overflow-y-auto ${onIndex ? 'hidden' : 'block'}`}
      >
        <div className="mx-auto w-full max-w-[620px] px-4 pb-16 pt-4 md:px-10 md:pt-9">{children}</div>
      </div>
    </div>
  );
}

function SettingsMenu({ pathname }: { pathname: string }) {
  const me = useMe();
  const [query, setQuery] = useState('');

  const term = query.trim().toLowerCase();
  const matches = (text: string) => !term || text.toLowerCase().includes(term);

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => matches(`${item.label} ${item.keywords}`)),
  })).filter((section) => section.items.length > 0);

  const showCore =
    CORE_HOME !== null &&
    matches('บัญชีกลาง CSMJU2030 รหัสผ่าน อีเมล ชื่อผู้ใช้ กิจกรรมการเข้าสู่ระบบ core hub account password email login');
  const nothing = sections.length === 0 && !showCore;

  return (
    <nav className="px-2 pb-10 pt-4 md:px-4 md:pt-9">
      <div className="flex items-center gap-2 px-2 md:px-3">
        <Link
          href={`/profile/${encodeURIComponent(me.id)}`}
          aria-label="กลับไปโปรไฟล์"
          className="grid size-8 place-items-center rounded-full hover:bg-accent md:hidden"
        >
          <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
        </Link>
        <h1 className="text-xl font-bold">การตั้งค่า</h1>
      </div>

      <label className="mx-2 mt-5 flex h-10 items-center gap-2 rounded-lg bg-muted px-4 md:mx-3">
        <Search aria-hidden strokeWidth={1.9} className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">ค้นหาการตั้งค่า</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ค้นหา"
          className="min-w-0 flex-1 bg-transparent text-csmju-label outline-none placeholder:text-muted-foreground"
        />
      </label>

      {sections.map((section) => (
        <div key={section.caption}>
          <p className="px-4 pb-2 pt-6 text-csmju-caption font-semibold text-muted-foreground md:px-5">
            {section.caption}
          </p>

          <ul>
            {section.items.map((item) => {
              const active =
                pathname === item.href || (item.alsoActive ?? []).includes(pathname);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`${ROW} ${active ? 'md:bg-accent md:font-semibold' : ''}`}
                  >
                    <Icon aria-hidden strokeWidth={1.9} className="size-6 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight
                      aria-hidden
                      strokeWidth={1.9}
                      className="size-4 text-muted-foreground md:hidden"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* บัญชีกลาง — ตำแหน่งเดียวกับ Accounts Center ของ Instagram
          รหัสผ่าน อีเมล ชื่อผู้ใช้ และกิจกรรมการเข้าสู่ระบบเป็นของระบบกลาง ไม่ใช่ที่นี่ */}
      {showCore && CORE_HOME && (
        <div>
          <p className="px-4 pb-2 pt-6 text-csmju-caption font-semibold text-muted-foreground md:px-5">
            บัญชีกลาง CSMJU2030
          </p>
          <a href={CORE_HOME} target="_blank" rel="noreferrer" className={ROW}>
            <KeyRound aria-hidden strokeWidth={1.9} className="size-6 shrink-0" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block">รหัสผ่านและความปลอดภัย</span>
              <span className="mt-0.5 block text-csmju-caption text-muted-foreground">
                รหัสผ่าน อีเมล ชื่อผู้ใช้ และกิจกรรมการเข้าสู่ระบบ
              </span>
            </span>
            <ExternalLink aria-hidden strokeWidth={1.9} className="size-4 shrink-0 text-muted-foreground" />
          </a>
        </div>
      )}

      {nothing && (
        <p className="px-4 pt-8 text-center text-csmju-label text-muted-foreground">
          ไม่พบการตั้งค่าที่ตรงกับ “{query.trim()}”
        </p>
      )}
    </nav>
  );
}

/// หัวของหน้าย่อย — มือถือมีลูกศรกลับไปรายการ จอกว้างเป็นหัวข้อตัวใหญ่เฉย ๆ
///
/// `back` = หน้าย่อยชั้นที่สอง (เช่น การแจ้งเตือนแบบพุช) ที่ Instagram มี ‹ บนจอกว้างด้วย
export function SettingsHeading({
  children,
  back,
}: {
  children: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex items-center gap-2 md:mb-8">
      <Link
        href={back?.href ?? '/settings'}
        aria-label={back?.label ?? 'กลับไปการตั้งค่า'}
        className={`-ml-2 grid size-8 place-items-center rounded-full hover:bg-accent ${back ? '' : 'md:hidden'}`}
      >
        <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
      </Link>
      <h2 className="text-xl font-bold">{children}</h2>
    </div>
  );
}
