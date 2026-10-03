'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { SuggestionCaption, type Suggestion } from '@/components/csmju/explore-suggestions';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { useMe, useSignOut } from '@/lib/csmju/session';
import type { Meeting } from '@/lib/csmju/types';

/// คอลัมน์ขวาของหน้าหลัก แบบ Instagram — บัญชีของฉัน · แนะนำ · ออนไลน์ · ลิงก์ท้าย
///
/// ทุกแถวเป็นข้อมูลจริงจากหลังบ้าน ไม่มีรายชื่อตัวอย่าง:
///   แนะนำสำหรับคุณ   GET /follows/suggestions (คนที่คนที่เราติดตามติดตามอยู่)
///                    ถ้ายังไม่ได้ติดตามใครเลย หลังบ้านคืนว่างโดยตั้งใจ — จึงแสดง
///                    คนที่ออนไลน์อยู่ที่เรายังไม่ได้ติดตามแทน ซึ่งเป็นคนจริงที่อยู่ตรงนี้
///   ออนไลน์ตอนนี้     GET /presence (แบบรายชื่อเพื่อนของ LINE / Discord)
///   นัดถัดไป          GET /meetings (แบบปฏิทินของ Teams)

const SUGGESTION_LIMIT = 5;

/// รูปคนที่ออนไลน์ — aria-label ใช้ชื่อที่แสดง ไม่ใช่รหัส
///
/// รหัสจาก Core Hub ตัวจริงเป็น UUID เดิมโปรแกรมอ่านหน้าจอจึงอ่าน
/// "โปรไฟล์ของ e2b39ea5-d4ff-…" ทั้งที่ชื่อมีอยู่ในแคชแล้ว
function OnlineAvatar({ coreUserId }: { coreUserId: string }) {
  const profile = useProfile(coreUserId);

  return (
    <Link href={`/profile/${encodeURIComponent(coreUserId)}`} aria-label={`โปรไฟล์ของ ${profile.displayName}`}>
      <Avatar coreUserId={coreUserId} size={36} />
    </Link>
  );
}


function Person({
  coreUserId,
  caption,
  action,
}: {
  coreUserId: string;
  caption: React.ReactNode;
  action?: React.ReactNode;
}) {
  const profile = useProfile(coreUserId);

  return (
    <li className="flex items-center gap-3">
      <Avatar coreUserId={coreUserId} size={44} />

      <span className="min-w-0 flex-1 leading-tight">
        <Link
          href={`/profile/${encodeURIComponent(coreUserId)}`}
          className="block truncate text-csmju-label font-semibold hover:underline"
        >
          {profile.displayName}
        </Link>
        <span className="block truncate text-csmju-caption text-muted-foreground">
          {caption}
        </span>
      </span>

      {action}
    </li>
  );
}

function FollowButton({ coreUserId }: { coreUserId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const queryClient = useQueryClient();

  async function follow() {
    setState('busy');

    try {
      await api.post('/follows', { coreUserId });
      setState('done');
      // ฟีด "คนที่ติดตาม" ต้องเห็นโพสต์ของคนนี้ทันที
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['following', 'mine'] });
    } catch {
      setState('idle');
    }
  }

  return (
    <button
      type="button"
      disabled={state !== 'idle'}
      onClick={() => void follow()}
      className="shrink-0 text-csmju-caption font-semibold text-link transition-opacity hover:opacity-70 disabled:text-muted-foreground disabled:opacity-100"
    >
      {state === 'done' ? 'ติดตามแล้ว' : 'ติดตาม'}
    </button>
  );
}

export function FeedSidebar() {
  const me = useMe();
  const profile = useProfile(me.id);
  const signOut = useSignOut();

  const { data } = useQuery({
    queryKey: ['feed-sidebar', me.id],
    queryFn: async () => {
      const [suggested, following, presence, meetings] = await Promise.all([
        api.get<Suggestion[]>('/follows/suggestions').catch(() => [] as Suggestion[]),
        api
          .list<{ coreUserId: string }>(`/follows/following?limit=100`)
          .then((page) => page.items)
          .catch(() => []),
        api
          .get<{ onlineCoreUserIds: string[]; totalOnline: number }>('/presence')
          .catch(() => ({ onlineCoreUserIds: [], totalOnline: 0 })),
        api
          .list<Meeting>('/meetings?limit=3')
          .then((page) => page.items)
          .catch(() => [] as Meeting[]),
      ]);

      const followed = new Set(following.map((row) => row.coreUserId));
      const online = presence.onlineCoreUserIds.filter((id) => id !== me.id);

      // เติมให้ครบห้าแถวด้วยคนที่ออนไลน์อยู่ที่ยังไม่ได้ติดตาม — คนจริง ไม่ใช่ตัวอย่าง
      const people = suggested
        .filter((row) => row.coreUserId !== me.id && !followed.has(row.coreUserId))
        .map((row): { coreUserId: string; suggestion: Suggestion | null } => ({
          coreUserId: row.coreUserId,
          suggestion: row,
        }));

      for (const id of online) {
        if (people.length >= SUGGESTION_LIMIT) break;
        if (followed.has(id) || people.some((row) => row.coreUserId === id)) continue;

        people.push({ coreUserId: id, suggestion: null });
      }

      return {
        people: people.slice(0, SUGGESTION_LIMIT),
        online,
        meetings: meetings.filter((row) => row.status === 'SCHEDULED' || row.status === 'LIVE').slice(0, 2),
      };
    },
    refetchInterval: 60_000,
  });

  const people = data?.people ?? [];
  const online = data?.online ?? [];
  const meetings = data?.meetings ?? [];

  return (
    <aside aria-label="บัญชีและคำแนะนำ" className="w-[20rem] shrink-0 pt-8 max-xl:hidden">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${encodeURIComponent(me.id)}`} aria-label="โปรไฟล์ของฉัน">
          <Avatar coreUserId={me.id} size={48} showOnline={false} />
        </Link>

        <span className="min-w-0 flex-1 leading-tight">
          <Link
            href={`/profile/${encodeURIComponent(me.id)}`}
            className="block truncate text-csmju-label font-semibold hover:underline"
          >
            {profile.displayName === me.id ? me.email.split('@')[0] : profile.displayName}
          </Link>
          <span className="block truncate text-csmju-caption text-muted-foreground">
            {me.email}
          </span>
        </span>

        {/* สลับบัญชี = ออกจากระบบแล้วเข้าใหม่ที่ Core Hub (ไม่มีการสวมตัวตนในระบบนี้) */}
        <button
          type="button"
          onClick={() => void signOut().catch(() => undefined)}
          className="shrink-0 text-csmju-caption font-semibold text-link transition-opacity hover:opacity-70"
        >
          เปลี่ยน
        </button>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-csmju-label font-semibold text-muted-foreground">
          แนะนำสำหรับคุณ
        </h2>
        <Link href="/explore/people" className="text-csmju-caption font-semibold hover:opacity-70">
          ดูทั้งหมด
        </Link>
      </div>

      {people.length === 0 ? (
        <p className="mt-3 text-csmju-caption leading-relaxed text-muted-foreground">
          ยังไม่มีคำแนะนำ — ติดตามเพื่อนสักคนจากหน้าค้นหา แล้วระบบจะแนะนำคนที่เพื่อนติดตามอยู่
        </p>
      ) : (
        <ul className="mt-3 space-y-3.5">
          {people.map((row) => (
            <Person
              key={row.coreUserId}
              coreUserId={row.coreUserId}
              // ข้อความเดียวกับหน้า /explore/people — "ติดตามโดย ก และอีก n คน"
              caption={row.suggestion ? <SuggestionCaption row={row.suggestion} /> : 'ออนไลน์อยู่ตอนนี้'}
              action={<FollowButton coreUserId={row.coreUserId} />}
            />
          ))}
        </ul>
      )}

      {online.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 text-csmju-label font-semibold text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            ออนไลน์ตอนนี้ {online.length} คน
          </h2>

          <ul className="mt-3 flex flex-wrap gap-2">
            {online.slice(0, 12).map((id) => (
              <li key={id}>
                <OnlineAvatar coreUserId={id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {meetings.length > 0 && (
        <section className="mt-6">
          <h2 className="text-csmju-label font-semibold text-muted-foreground">นัดถัดไป</h2>

          <ul className="mt-3 space-y-2">
            {meetings.map((meeting) => (
              <li key={meeting.id}>
                <Link
                  href="/meetings"
                  className="flex items-start gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-accent"
                >
                  <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-csmju-label font-medium">
                      {meeting.title}
                    </span>
                    <span className="block text-csmju-caption text-muted-foreground">
                      {new Date(meeting.startsAt).toLocaleString('th-TH', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {meeting.joinableNow ? ' · เข้าได้เลย' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 space-y-3 text-[0.75rem] leading-relaxed text-muted-foreground/70">
        <nav aria-label="ลิงก์ของระบบ" className="flex flex-wrap gap-x-1">
          {[
            { href: '/search', label: 'ค้นหา' },
            { href: '/saved', label: 'ที่บันทึกไว้' },
            { href: '/meetings', label: 'นัดประชุม' },
            { href: '/voice', label: 'ห้องเสียง' },
            { href: '/admin', label: 'แผงผู้ดูแล' },
          ].map((link, index, all) => (
            <span key={link.href}>
              <Link href={link.href} className="hover:underline">
                {link.label}
              </Link>
              {index < all.length - 1 ? ' ·' : ''}
            </span>
          ))}
        </nav>
        <p>© 2569 CS NEXUS · สาขาวิทยาการคอมพิวเตอร์ มหาวิทยาลัยแม่โจ้ · CSMJU2030</p>
      </footer>
    </aside>
  );
}
