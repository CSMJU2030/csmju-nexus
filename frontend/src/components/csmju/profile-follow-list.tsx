'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError, type Page } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { FollowEdge, Relation } from '@/lib/csmju/types';

/// กล่องรายชื่อผู้ติดตาม / กำลังติดตาม — แบบกล่องกลางจอของ Instagram
///
/// ปุ่มข้างแต่ละชื่อบอกความสัมพันธ์ระหว่าง **เรา** กับคนนั้น ไม่ใช่ระหว่าง
/// เจ้าของโปรไฟล์กับคนนั้น จึงต้องรู้ว่าเราติดตามใครอยู่บ้าง — ดึงรายชื่อ
/// ที่เราติดตามมาหนึ่งครั้ง แทนการถามความสัมพันธ์ทีละคน (รายชื่อ 50 คน
/// จะกลายเป็น 50 คำขอ)

export type FollowListKind = 'followers' | 'following';

const TITLES: Record<FollowListKind, string> = {
  followers: 'ผู้ติดตาม',
  following: 'กำลังติดตาม',
};

const PAGE_SIZE = 50;

/// คนที่ **ฉัน** ติดตามอยู่ — 100 คนคือเพดานของหลังบ้านต่อหนึ่งคำขอ
///
/// ถ้าเกิน 100 คน ปุ่มของคนที่ตกขอบจะขึ้น "ติดตาม" ทั้งที่ติดตามอยู่แล้ว
/// ซึ่งกดแล้วก็ไม่พัง (หลังบ้านรับการติดตามซ้ำได้ ไม่แจ้งเตือนซ้ำ)
export const MY_FOLLOWING_KEY = ['my-following'] as const;

export function useMyFollowing() {
  return useQuery({
    queryKey: MY_FOLLOWING_KEY,
    queryFn: async () =>
      new Set(
        (await api.list<FollowEdge>('/follows/following?limit=100')).items.map(
          (edge) => edge.coreUserId,
        ),
      ),
  });
}

/// กดติดตาม/เลิกติดตามจากที่ไหนก็ได้ แล้วให้ทุกส่วนของหน้าเห็นผลเดียวกัน
///
/// เลขผู้ติดตามบนหัวโปรไฟล์ของอีกคน และเลขกำลังติดตามของเราเองเปลี่ยนด้วย
/// จึงล้างแคชโปรไฟล์ทั้งสองฝั่ง แทนการคำนวณเลขเองแล้วเสี่ยงคลาดกับของจริง
export function useFollowToggle() {
  const queryClient = useQueryClient();
  const me = useMe();

  return async function toggle(coreUserId: string, following: boolean): Promise<Relation> {
    const relation = following
      ? await api.del<Relation>(`/follows/${encodeURIComponent(coreUserId)}`)
      : await api.post<Relation>('/follows', { coreUserId });

    queryClient.setQueryData<Set<string>>(MY_FOLLOWING_KEY, (current) => {
      if (!current) return current;

      const next = new Set(current);

      if (relation.following) next.add(coreUserId);
      else next.delete(coreUserId);

      return next;
    });

    void queryClient.invalidateQueries({ queryKey: ['profile', me.id] });
    void queryClient.invalidateQueries({ queryKey: ['profile', coreUserId] });

    return relation;
  };
}

export function FollowListDialog({
  coreUserId,
  kind,
  onClose,
}: {
  coreUserId: string;
  kind: FollowListKind | null;
  onClose: () => void;
}) {
  const owner = useProfile(coreUserId);

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[400px] rounded-xl border-0 bg-card">
        <DialogTitle className="flex h-[43px] items-center justify-center border-b border-border text-base font-bold">
          {kind ? TITLES[kind] : ''}
        </DialogTitle>

        <DialogDescription className="sr-only">
          รายชื่อ{kind ? TITLES[kind] : ''}ของ {owner.displayName}
        </DialogDescription>

        {kind && <FollowList coreUserId={coreUserId} kind={kind} onNavigate={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function FollowList({
  coreUserId,
  kind,
  onNavigate,
}: {
  coreUserId: string;
  kind: FollowListKind;
  onNavigate: () => void;
}) {
  const edges = useInfiniteQuery({
    queryKey: ['follow-list', kind, coreUserId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<FollowEdge>(
        `/profiles/${encodeURIComponent(coreUserId)}/${kind}?limit=${PAGE_SIZE}&page=${pageParam}`,
      ),
    getNextPageParam: (last: Page<FollowEdge>) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });

  const mine = useMyFollowing();
  const rows = edges.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="h-[min(400px,calc(100dvh-8rem))] overflow-y-auto py-2">
      {edges.isPending && (
        <p className="flex items-center justify-center gap-2 py-10 text-csmju-label text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          กำลังโหลด…
        </p>
      )}

      {edges.error && (
        <p role="alert" className="px-4 py-10 text-center text-csmju-label text-destructive">
          {edges.error instanceof ApiError ? edges.error.message : 'โหลดรายชื่อไม่สำเร็จ'}
        </p>
      )}

      {!edges.isPending && !edges.error && rows.length === 0 && (
        <p className="px-4 py-10 text-center text-csmju-label text-muted-foreground">
          {kind === 'followers' ? 'ยังไม่มีผู้ติดตาม' : 'ยังไม่ได้ติดตามใคร'}
        </p>
      )}

      <ul>
        {rows.map((edge) => (
          <PersonRow
            key={edge.coreUserId}
            coreUserId={edge.coreUserId}
            following={mine.data?.has(edge.coreUserId) ?? null}
            onNavigate={onNavigate}
          />
        ))}
      </ul>

      {edges.hasNextPage && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={() => void edges.fetchNextPage()}
            disabled={edges.isFetchingNextPage}
            className="rounded-lg px-3 py-1.5 text-csmju-label font-semibold text-link hover:bg-accent disabled:opacity-60"
          >
            {edges.isFetchingNextPage ? 'กำลังโหลด…' : 'ดูเพิ่มเติม'}
          </button>
        </div>
      )}
    </div>
  );
}

/// หนึ่งแถว · `following === null` = ยังไม่รู้ว่าเราติดตามเขาไหม จึงยังไม่วาดปุ่ม
/// (วาดเป็น "ติดตาม" ไปก่อนแล้วเปลี่ยนเป็น "กำลังติดตาม" จะดูเหมือนกดเองได้)
export function PersonRow({
  coreUserId,
  following,
  caption,
  onNavigate,
}: {
  coreUserId: string;
  following: boolean | null;
  caption?: string;
  onNavigate?: () => void;
}) {
  const me = useMe();
  const profile = useProfile(coreUserId);
  const toggle = useFollowToggle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = `/profile/${encodeURIComponent(coreUserId)}`;

  async function flip() {
    if (following === null) return;

    setBusy(true);
    setError(null);

    try {
      await toggle(coreUserId, following);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      {/* กล่องนี้พื้นสีเดียวกับวงกลมตัวอักษรสำรองของรูป — เปลี่ยนพื้นวงกลมให้ยังมองเห็น */}
      <Link
        href={href}
        onClick={onNavigate}
        className="shrink-0 [&_[data-slot=avatar]>span]:!bg-background"
        tabIndex={-1}
        aria-hidden
      >
        <Avatar coreUserId={coreUserId} size={44} showOnline={false} />
      </Link>

      <span className="min-w-0 flex-1 leading-tight">
        <Link
          href={href}
          onClick={onNavigate}
          className="block truncate text-csmju-label font-semibold hover:underline"
        >
          {profile.displayName}
        </Link>
        {(error ?? caption) && (
          <span className="block truncate text-csmju-label font-normal text-muted-foreground">
            {error ?? caption}
          </span>
        )}
      </span>

      {coreUserId !== me.id && following !== null && (
        <button
          type="button"
          onClick={() => void flip()}
          disabled={busy}
          className={`h-8 shrink-0 rounded-lg px-4 text-csmju-label font-semibold transition-colors disabled:opacity-60 ${
            following
              ? 'bg-muted text-foreground hover:bg-accent'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : following ? 'กำลังติดตาม' : 'ติดตาม'}
        </button>
      )}
    </li>
  );
}
