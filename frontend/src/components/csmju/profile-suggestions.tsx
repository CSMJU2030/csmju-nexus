'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { useFollowToggle } from '@/components/csmju/profile-follow-list';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';

/// แถว "แนะนำสำหรับคุณ" ใต้หัวโปรไฟล์คนอื่น — แบบการ์ดเลื่อนข้างของ Instagram
///
/// มาจาก `GET /follows/suggestions` (คนที่คนที่เราติดตามติดตามอยู่) เท่านั้น
/// ถ้าหลังบ้านคืนว่าง แถวนี้หายไปทั้งแถว — ไม่เติมคนสุ่มหรือรายชื่อตัวอย่าง
/// ให้ดูเต็ม เพราะคำว่า "แนะนำ" ต้องมีเหตุผลอยู่ข้างหลังจริง
///
/// ปุ่ม X แค่ซ่อนการ์ดในแท็บนี้ — หลังบ้านไม่มีที่เก็บ "ไม่สนใจคนนี้"
/// จึงไม่แกล้งทำเป็นว่าจำได้ถาวร

interface Suggestion {
  coreUserId: string;
  /// คนที่ฉันติดตามซึ่งติดตามเขาอยู่ — หลังบ้านส่งมาทั้งชื่อนี้และ mutualCount (ชื่อเดิม)
  followedByCount: number;
}

export const SUGGESTIONS_KEY = ['follow-suggestions'] as const;

export function useSuggestions(exclude: string, enabled = true) {
  const me = useMe();

  const query = useQuery({
    queryKey: SUGGESTIONS_KEY,
    enabled,
    queryFn: () => api.get<Suggestion[]>('/follows/suggestions'),
  });

  return {
    ...query,
    people: (query.data ?? []).filter(
      (row) => row.coreUserId !== me.id && row.coreUserId !== exclude,
    ),
  };
}

export function ProfileSuggestions({
  exclude,
  onClose,
}: {
  exclude: string;
  onClose: () => void;
}) {
  const { people } = useSuggestions(exclude);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const visible = people.filter((row) => !hidden.has(row.coreUserId));

  if (visible.length === 0) return null;

  return (
    <section aria-label="แนะนำสำหรับคุณ" className="mt-6 md:mt-8">
      <div className="mb-3 flex items-center justify-between px-4 md:px-0">
        <h2 className="text-csmju-label font-semibold">แนะนำสำหรับคุณ</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-csmju-label font-semibold text-link hover:text-foreground"
        >
          ซ่อน
        </button>
      </div>

      <ul className="flex gap-2 overflow-x-auto px-4 pb-2 md:px-0 [&::-webkit-scrollbar]:hidden">
        {visible.map((row) => (
          <SuggestionCard
            key={row.coreUserId}
            suggestion={row}
            onDismiss={() =>
              setHidden((current) => new Set(current).add(row.coreUserId))
            }
          />
        ))}
      </ul>
    </section>
  );
}

function SuggestionCard({
  suggestion,
  onDismiss,
}: {
  suggestion: Suggestion;
  onDismiss: () => void;
}) {
  const profile = useProfile(suggestion.coreUserId);
  const toggle = useFollowToggle();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = `/profile/${encodeURIComponent(suggestion.coreUserId)}`;

  async function flip() {
    setBusy(true);
    setError(null);

    try {
      const relation = await toggle(suggestion.coreUserId, following);

      setFollowing(relation.following);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="relative flex w-[176px] shrink-0 flex-col items-center rounded-lg border border-border px-3 pb-4 pt-5 text-center">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`ซ่อน ${profile.displayName} จากคำแนะนำ`}
        className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X aria-hidden strokeWidth={1.9} className="size-4" />
      </button>

      <Link href={href} tabIndex={-1} aria-hidden>
        <Avatar coreUserId={suggestion.coreUserId} size={96} showOnline={false} />
      </Link>

      <Link
        href={href}
        className="mt-3 block w-full truncate text-csmju-label font-semibold hover:underline"
      >
        {profile.displayName}
      </Link>

      <p className="mt-0.5 line-clamp-2 min-h-[2.4em] w-full text-csmju-caption leading-tight text-muted-foreground">
        {error ??
          (suggestion.followedByCount > 0
            ? `คนที่คุณติดตาม ${suggestion.followedByCount} คนติดตามอยู่`
            : 'แนะนำสำหรับคุณ')}
      </p>

      <button
        type="button"
        onClick={() => void flip()}
        disabled={busy}
        className={`mt-3 flex h-8 w-full items-center justify-center rounded-lg text-csmju-label font-semibold transition-colors disabled:opacity-60 ${
          following
            ? 'bg-muted text-foreground hover:bg-accent'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        }`}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : following ? (
          'กำลังติดตาม'
        ) : (
          'ติดตาม'
        )}
      </button>
    </li>
  );
}
