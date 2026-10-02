'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, X } from 'lucide-react';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { describeAction, notificationLink } from '@/lib/csmju/notifications';
import { useMe } from '@/lib/csmju/session';
import { igAgo } from '@/lib/csmju/time';
import type { Notification } from '@/lib/csmju/types';

/// แผงการแจ้งเตือนแบบ Instagram — เลื่อนออกจากแถบซ้ายเต็มความสูง
///
///   หัว "การแจ้งเตือน" + ปิด · ชิปตัวกรอง · กลุ่มวันนี้/สัปดาห์นี้/เดือนนี้/ก่อนหน้านี้
///   แถว: รูป · **ชื่อ** ข้อความ เวลา · ปุ่มติดตามสำหรับ "เริ่มติดตามคุณ"
///   ไม่มีรายการ: วงหัวใจ + คำอธิบาย + "แนะนำสำหรับคุณ" (คนจริงจาก /follows/suggestions)
///
/// เปิดแผง = อ่านแล้วทั้งหมด เหมือน Instagram ที่เลขแดงหายทันทีที่เปิดดู

export const NOTIFICATIONS_PANEL_KEY = ['notifications', 'panel'] as const;

type Filter = 'all' | 'following' | 'comments' | 'follows' | 'mentions' | 'reactions' | 'meetings';

const FILTERS: { id: Filter; label: string; kinds?: string[] }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'following', label: 'คนที่คุณติดตาม' },
  { id: 'comments', label: 'ความคิดเห็น', kinds: ['REEL_COMMENT', 'POST_COMMENT', 'THREAD_REPLY'] },
  { id: 'follows', label: 'การติดตาม', kinds: ['FOLLOW'] },
  { id: 'mentions', label: 'การกล่าวถึง', kinds: ['MENTION'] },
  { id: 'reactions', label: 'การถูกใจ', kinds: ['REEL_LIKE', 'REACTION'] },
  { id: 'meetings', label: 'นัดหมายและห้อง', kinds: ['MEETING_INVITE', 'VOICE_INVITE', 'CHANNEL_INVITE'] },
];

const EMPTY_COPY: Record<Filter, { title: string; body: string }> = {
  all: { title: 'กิจกรรมบนโพสต์ของคุณ', body: 'เมื่อมีคนถูกใจหรือแสดงความคิดเห็นต่อโพสต์ใดโพสต์หนึ่งของคุณ คุณจะเห็นได้ที่นี่' },
  following: { title: 'กิจกรรมจากคนที่คุณติดตาม', body: 'เมื่อคนที่คุณติดตามโต้ตอบกับคุณ คุณจะเห็นได้ที่นี่' },
  comments: { title: 'ความคิดเห็น', body: 'เมื่อมีคนแสดงความคิดเห็นหรือตอบกลับคุณ คุณจะเห็นได้ที่นี่' },
  follows: { title: 'การติดตาม', body: 'เมื่อมีคนเริ่มติดตามคุณ คุณจะเห็นได้ที่นี่' },
  mentions: { title: 'การกล่าวถึง', body: 'เมื่อมีคน @ ถึงคุณในห้องแชท คุณจะเห็นได้ที่นี่' },
  reactions: { title: 'การถูกใจ', body: 'เมื่อมีคนถูกใจคลิปหรือรีแอ็กชันข้อความของคุณ คุณจะเห็นได้ที่นี่' },
  meetings: { title: 'นัดหมายและห้อง', body: 'คำเชิญเข้าห้อง ห้องเสียง และนัดประชุมจะอยู่ที่นี่' },
};

/// กลุ่มตามเวลาแบบ Instagram
function bucketOf(iso: string, now: number): string {
  const created = new Date(iso);
  const today = new Date(now);

  today.setHours(0, 0, 0, 0);

  const age = now - created.getTime();

  if (created >= today) return 'วันนี้';
  if (age < 7 * 86_400_000) return 'สัปดาห์นี้';
  if (age < 30 * 86_400_000) return 'เดือนนี้';

  return 'ก่อนหน้านี้';
}

function useFollowing() {
  const me = useMe();

  return useQuery({
    queryKey: ['following', 'mine', me.id],
    queryFn: async () =>
      new Set((await api.list<{ coreUserId: string }>('/follows/following?limit=100')).items.map((row) => row.coreUserId)),
  });
}

function FollowToggle({ coreUserId, following }: { coreUserId: string; following: boolean }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);

    try {
      if (following) await api.del(`/follows/${encodeURIComponent(coreUserId)}`);
      else await api.post('/follows', { coreUserId });

      await queryClient.invalidateQueries({ queryKey: ['following', 'mine', me.id] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        void toggle();
      }}
      className={`h-8 shrink-0 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60 ${
        following ? 'bg-muted text-foreground hover:bg-accent' : 'bg-primary text-primary-foreground hover:opacity-90'
      }`}
    >
      {following ? 'กำลังติดตาม' : 'ติดตาม'}
    </button>
  );
}

function NotificationRow({
  item,
  following,
  onOpen,
}: {
  item: Notification;
  following: Set<string>;
  onOpen: (item: Notification) => void;
}) {
  const actor = item.actorCoreUserId;
  const profile = useProfile(actor ?? '');

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOpen(item);
        }}
        className="flex cursor-pointer items-center gap-3 px-6 py-2 transition-colors hover:bg-accent"
      >
        {actor ? (
          <Link href={`/profile/${encodeURIComponent(actor)}`} onClick={(e) => e.stopPropagation()} aria-label={`โปรไฟล์ของ ${profile.displayName}`}>
            <Avatar coreUserId={actor} size={44} showOnline={false} />
          </Link>
        ) : (
          <span className="grid size-11 place-items-center rounded-full bg-muted">
            <Heart aria-hidden className="size-5" />
          </span>
        )}

        <p className="min-w-0 flex-1 text-sm leading-snug">
          {actor && <span className="font-semibold">{profile.displayName} </span>}
          <span>{describeAction(item)}</span>{' '}
          <time dateTime={item.createdAt} className="text-muted-foreground">
            {igAgo(item.createdAt)}
          </time>
        </p>

        {item.kind === 'FOLLOW' && actor && <FollowToggle coreUserId={actor} following={following.has(actor)} />}
      </div>
    </li>
  );
}

function Suggestions({ following }: { following: Set<string> }) {
  const me = useMe();
  const { data = [] } = useQuery({
    queryKey: ['follows', 'suggestions', me.id],
    queryFn: () => api.get<{ coreUserId: string; mutualCount: number }[]>('/follows/suggestions'),
  });

  const rows = data.filter((row) => row.coreUserId !== me.id).slice(0, 8);

  if (rows.length === 0) return null;

  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="px-6 pb-2 text-base font-bold">แนะนำสำหรับคุณ</h3>
      <ul>
        {rows.map((row) => (
          <SuggestionRow key={row.coreUserId} coreUserId={row.coreUserId} mutual={row.mutualCount} following={following.has(row.coreUserId)} />
        ))}
      </ul>
    </section>
  );
}

function SuggestionRow({ coreUserId, mutual, following }: { coreUserId: string; mutual: number; following: boolean }) {
  const profile = useProfile(coreUserId);

  return (
    <li className="flex items-center gap-3 px-6 py-2">
      <Link href={`/profile/${encodeURIComponent(coreUserId)}`}>
        <Avatar coreUserId={coreUserId} size={44} showOnline={false} />
      </Link>
      <span className="min-w-0 flex-1 leading-tight">
        <Link href={`/profile/${encodeURIComponent(coreUserId)}`} className="block truncate text-sm font-semibold hover:underline">
          {profile.displayName}
        </Link>
        <span className="block truncate text-xs text-muted-foreground">
          {mutual > 0 ? `คนที่คุณติดตาม ${mutual} คนติดตามอยู่` : coreUserId}
        </span>
      </span>
      <FollowToggle coreUserId={coreUserId} following={following} />
    </li>
  );
}

export function NotificationsPanel({ onClose, unread }: { onClose: () => void; unread: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  // จับเวลาตอนเปิดแผงครั้งเดียว — ใช้แบ่งกลุ่มวันนี้/สัปดาห์นี้ ไม่ต้องแม่นระดับวินาที
  const [now] = useState(() => Date.now());
  const { data: following = new Set<string>() } = useFollowing();

  const { data: items = [], isPending } = useQuery({
    queryKey: NOTIFICATIONS_PANEL_KEY,
    queryFn: async () => (await api.list<Notification>('/notifications?limit=100')).items,
  });

  // เปิดแผงแล้วถือว่าอ่านแล้ว — เลขแดงบนหัวใจหายทันทีแบบ Instagram
  useEffect(() => {
    if (unread === 0) return;

    void api
      .patch('/notifications/read-all')
      .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => undefined);
  }, [unread, queryClient]);

  const visible = useMemo(() => {
    const spec = FILTERS.find((f) => f.id === filter);

    return items.filter((item) => {
      if (filter === 'following') return item.actorCoreUserId ? following.has(item.actorCoreUserId) : false;

      return spec?.kinds ? spec.kinds.includes(item.kind) : true;
    });
  }, [items, filter, following]);

  const groups = useMemo(() => {
    const out: { label: string; rows: Notification[] }[] = [];

    for (const item of visible) {
      const label = bucketOf(item.createdAt, now);
      const last = out[out.length - 1];

      if (last?.label === label) last.rows.push(item);
      else out.push({ label, rows: [item] });
    }

    return out;
  }, [visible, now]);

  function open(item: Notification) {
    const href = notificationLink(item);

    if (href) {
      onClose();
      router.push(href);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between px-6 pb-3 pt-6">
        <h2 className="text-2xl font-bold">การแจ้งเตือน</h2>
        <button type="button" onClick={onClose} aria-label="ปิดการแจ้งเตือน" className="-mr-2 -mt-1 grid size-9 place-items-center rounded-full hover:bg-accent">
          <X aria-hidden className="size-6" strokeWidth={1.9} />
        </button>
      </div>

      <div role="tablist" aria-label="ตัวกรองการแจ้งเตือน" className="flex shrink-0 gap-2 overflow-x-auto px-6 pb-3 [scrollbar-width:none]">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
            className={`h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
              filter === id ? 'border-transparent bg-muted text-foreground' : 'border-border text-foreground hover:bg-accent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {isPending ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : groups.length === 0 ? (
          <>
            <div className="flex flex-col items-center px-8 pt-8 text-center">
              <span className="grid size-20 place-items-center rounded-full border-2 border-foreground">
                <Heart aria-hidden className="size-10" strokeWidth={1.6} />
              </span>
              <p className="mt-4 text-lg font-bold">{EMPTY_COPY[filter].title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{EMPTY_COPY[filter].body}</p>
            </div>
            <Suggestions following={following} />
          </>
        ) : (
          groups.map((group, index) => (
            <section key={group.label} className={index > 0 ? 'mt-3 border-t border-border pt-4' : ''}>
              <h3 className="px-6 pb-2 text-base font-bold">{group.label}</h3>
              <ul>
                {group.rows.map((item) => (
                  <NotificationRow key={item.id} item={item} following={following} onOpen={open} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
