'use client';

import { use, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  FollowListDialog,
  MY_FOLLOWING_KEY,
  type FollowListKind,
} from '@/components/csmju/profile-follow-list';
import {
  profileKey,
  useProfileData,
  type ProfileData,
} from '@/components/csmju/profile-data';
import { ProfileGrid } from '@/components/csmju/profile-grid';
import { HighlightsRow } from '@/components/csmju/profile-highlights';
import { ProfileHeader } from '@/components/csmju/profile-header';
import {
  ProfileSuggestions,
  useSuggestions,
} from '@/components/csmju/profile-suggestions';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Relation } from '@/lib/csmju/types';

/// หน้าโปรไฟล์แบบ Instagram บนเว็บ — หัวโปรไฟล์ · แถวสตอรี่ใหม่ · แท็บผลงาน
///
/// `params` เป็น Promise ใน Next 16 จึงต้องแกะด้วย React `use()`
/// (เขียนแบบเดิม `params.coreUserId` จะได้ Promise ไม่ใช่ string)
///
/// ติดตามเป็นทิศทางเดียวแบบ Instagram ไม่ใช่ขอเป็นเพื่อนแบบ Facebook
/// ความเป็นเพื่อนสองทาง (`mutual`) คำนวณจากการมีทั้งสองด้าน จึงไม่มี
/// ขั้นตอน "กดตอบรับ" ให้ผู้ใช้ทำ
///
/// การแก้โปรไฟล์ย้ายไปอยู่ที่ /settings แบบ Instagram — หน้านี้มีไว้ดู
export default function ProfilePage({
  params,
}: {
  params: Promise<{ coreUserId: string }>;
}) {
  const { coreUserId } = use(params);
  const target = decodeURIComponent(coreUserId);

  const me = useMe();
  const isMe = target === me.id;
  const queryClient = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [list, setList] = useState<FollowListKind | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  const { data, error: queryError } = useProfileData(target, isMe);

  // คำแนะนำโหลดเฉพาะหน้าคนอื่น — แบบ Instagram ที่แถวนี้ไม่ขึ้นบนโปรไฟล์ตัวเอง
  const { people } = useSuggestions(target, !isMe);
  const hasSuggestions = !isMe && people.length > 0;

  const profile = data?.profile ?? null;
  const mine = data?.mine ?? null;

  const error =
    actionError ??
    (queryError
      ? queryError instanceof ApiError
        ? queryError.message
        : 'โหลดโปรไฟล์ไม่สำเร็จ'
      : null);

  async function toggleFollow() {
    if (!profile) return;

    setBusy(true);
    setActionError(null);

    try {
      const relation = profile.relation.following
        ? await api.del<Relation>(`/follows/${encodeURIComponent(target)}`)
        : await api.post<Relation>('/follows', { coreUserId: target });

      // นับเฉพาะเมื่อสถานะเปลี่ยนจริง — กดติดตามซ้ำ หลังบ้านตอบ following
      // เหมือนเดิม เลขต้องไม่ขยับ
      const delta =
        relation.following === profile.relation.following
          ? 0
          : relation.following
            ? 1
            : -1;

      queryClient.setQueryData<ProfileData>(profileKey(target), (current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                relation,
                stats: {
                  ...current.profile.stats,
                  followerCount: current.profile.stats.followerCount + delta,
                },
              },
            }
          : current,
      );

      // เลข "กำลังติดตาม" ของเราเอง และปุ่มในรายชื่อผู้ติดตามต้องตามทัน
      void queryClient.invalidateQueries({ queryKey: profileKey(me.id) });
      void queryClient.invalidateQueries({ queryKey: MY_FOLLOWING_KEY });
      void queryClient.invalidateQueries({ queryKey: ['follow-list'] });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-[935px] px-4 py-8">
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive">
            {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-csmju-label text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            กำลังโหลด…
          </p>
        )}
      </div>
    );
  }

  // บรรทัดรองใต้ชื่อ — เดิมเป็น coreUserId (UUID) ซึ่งไม่มีความหมายกับคน
  // เจ้าของเห็นอีเมลของตัวเอง (มาจาก token) · คนอื่นเห็นแค่ว่าเป็นบัญชีของระบบนี้
  const handle = isMe && me.email ? me.email : 'บัญชี CS Nexus';

  return (
    <div className="mx-auto w-full max-w-[935px] pb-10 pt-4 md:px-5 md:pt-8">
      {/* รูปปกเป็นของระบบย่อยนี้ ไม่มีใน Instagram — เขียนไว้ให้ชุมชนเห็น
          หลังบ้านจึงส่ง coverUrl มากับโปรไฟล์ของทุกคน */}
      {profile.coverUrl && (
        <div className="mx-4 mb-6 h-32 overflow-hidden rounded-xl md:mx-0 md:mb-8 md:h-48">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.coverUrl} alt="รูปปกโปรไฟล์" className="size-full object-cover" />
        </div>
      )}

      <ProfileHeader
        profile={profile}
        mine={mine}
        isMe={isMe}
        handle={handle}
        busy={busy}
        suggestionsOpen={suggestionsOpen}
        hasSuggestions={hasSuggestions}
        onToggleFollow={() => void toggleFollow()}
        onToggleSuggestions={() => setSuggestionsOpen((open) => !open)}
        onOpenList={setList}
      />

      {actionError && (
        <p role="alert" className="mx-4 mt-3 text-csmju-label text-destructive md:mx-0">
          {actionError}
        </p>
      )}

      {hasSuggestions && suggestionsOpen && (
        <ProfileSuggestions exclude={target} onClose={() => setSuggestionsOpen(false)} />
      )}

      {/* ไฮไลต์ — ของตัวเองมีวง "ใหม่" ต่อท้ายเสมอ ของคนอื่นไม่มีไฮไลต์ = ไม่มีแถว */}
      <HighlightsRow coreUserId={target} isMe={isMe} />

      <div className="mt-6 md:mt-11">
        <ProfileGrid coreUserId={target} isMe={isMe} />
      </div>

      <FollowListDialog coreUserId={target} kind={list} onClose={() => setList(null)} />
    </div>
  );
}
