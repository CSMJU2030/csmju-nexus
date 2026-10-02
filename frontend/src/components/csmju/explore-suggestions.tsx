'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import type { Relation } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// คำแนะนำ "แนะนำสำหรับคุณ" — ใช้ร่วมกันทั้งคอลัมน์ขวาของฟีดและหน้า /explore/people
///
/// หลังบ้านรุ่นใหม่ส่ง `followedBy` (คนที่ฉันติดตามซึ่งติดตามคนนี้อยู่) กับ
/// `followedByCount` มาด้วย — มีแล้วขึ้น "ติดตามโดย ก และอีก n คน" แบบ IG
/// ไม่มี (รุ่นเดิม) ขึ้น "แนะนำสำหรับคุณ" ไม่เดาชื่อเอง

export interface Suggestion {
  coreUserId: string;
  mutualCount?: number;
  followedBy?: string[];
  followedByCount?: number;
}

export function SuggestionCaption({ row }: { row: Suggestion }) {
  const first = row.followedBy?.[0];

  if (!first) return <>แนะนำสำหรับคุณ</>;

  return <FollowedBy first={first} count={row.followedByCount ?? row.followedBy?.length ?? 1} />;
}

/// แยกคอมโพเนนต์เพื่อเรียก useProfile เฉพาะเมื่อมีชื่อให้แปลง
function FollowedBy({ first, count }: { first: string; count: number }) {
  const profile = useProfile(first);
  const others = count - 1;

  return (
    <>
      ติดตามโดย {profile.displayName}
      {others > 0 && ` และอีก ${others.toLocaleString('th-TH')} คน`}
    </>
  );
}

/// ปุ่ม "ติดตาม" ⇄ "กำลังติดตาม" (กดซ้ำเลิกติดตาม) — สถานะจริงจากผลของ API
export function FollowToggle({
  coreUserId,
  size = 'md',
}: {
  coreUserId: string;
  size?: 'sm' | 'md';
}) {
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);

    try {
      const relation = following
        ? await api.del<Relation>(`/follows/${encodeURIComponent(coreUserId)}`)
        : await api.post<Relation>('/follows', { coreUserId });

      setFollowing(relation.following);
      queryClient.setQueryData(['relation', coreUserId], relation);
      // ฟีด "กำลังติดตาม" และหน้าโปรไฟล์ต้องเห็นผลทันที
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', coreUserId] });
      void queryClient.invalidateQueries({ queryKey: ['following', 'mine'] });
    } catch {
      // ปุ่มคงสถานะเดิม กดใหม่ได้ — ไม่ต้องเด้งกล่องเตือนเพราะการติดตามพลาด
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={following}
      className={cn(
        'shrink-0 rounded-lg font-semibold transition-colors disabled:opacity-60',
        size === 'sm' ? 'px-3 py-1 text-csmju-caption' : 'px-4 py-1.5 text-csmju-label',
        following ? 'bg-muted text-foreground hover:bg-accent' : 'bg-primary text-primary-foreground hover:opacity-90',
      )}
    >
      {following ? 'กำลังติดตาม' : 'ติดตาม'}
    </button>
  );
}
