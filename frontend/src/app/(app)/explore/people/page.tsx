'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { LoadMoreSentinel } from '@/components/csmju/explore-grid';
import { FollowToggle, SuggestionCaption, type Suggestion } from '@/components/csmju/explore-suggestions';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError, type Page } from '@/lib/csmju/api';

/// "แนะนำสำหรับคุณ" ทั้งหมด — ปลายทางของ "ดูทั้งหมด" ในคอลัมน์ขวาของฟีด (แบบ IG)
///
/// GET /follows/suggestions แบ่งหน้า เรียงตาม followedByCount มากไปน้อย —
/// เลื่อนถึงท้ายรายการแล้วขอหน้าถัดไปเอง
export default function SuggestedPeoplePage() {
  const query = useInfiniteQuery({
    queryKey: ['suggestions-all'],
    initialPageParam: 1,
    queryFn: ({ pageParam }): Promise<Page<Suggestion>> =>
      api.list<Suggestion>(`/follows/suggestions?page=${pageParam}&limit=20`),
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });

  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return (
    <div className="mx-auto w-full max-w-150 px-4 py-6 lg:py-10">
      <h1 className="mb-4 text-csmju-body font-bold">แนะนำสำหรับคุณ</h1>

      {query.isPending && (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-label="กำลังโหลด" />
        </div>
      )}

      {query.isError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive">
          {query.error instanceof ApiError ? query.error.message : 'โหลดคำแนะนำไม่สำเร็จ'}
        </p>
      )}

      {!query.isPending && !query.isError && rows.length === 0 && (
        <p className="py-16 text-center text-csmju-label text-muted-foreground">
          ยังไม่มีคำแนะนำ — ติดตามเพื่อนสักคนจากหน้าค้นหา แล้วระบบจะแนะนำคนที่เพื่อนติดตามอยู่
        </p>
      )}

      <ul className="space-y-1">
        {rows.map((row) => (
          <SuggestionRow key={row.coreUserId} row={row} />
        ))}
      </ul>

      <LoadMoreSentinel onVisible={loadMore} disabled={!query.hasNextPage || query.isFetchingNextPage} />
      {query.isFetchingNextPage && (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-label="กำลังโหลดเพิ่ม" />
        </div>
      )}
    </div>
  );
}

function SuggestionRow({ row }: { row: Suggestion }) {
  const profile = useProfile(row.coreUserId);

  return (
    <li className="flex items-center gap-3 py-2">
      <Link href={`/profile/${encodeURIComponent(row.coreUserId)}`} className="shrink-0">
        <Avatar coreUserId={row.coreUserId} size={44} showOnline={false} />
      </Link>
      <span className="min-w-0 flex-1 leading-tight">
        <Link
          href={`/profile/${encodeURIComponent(row.coreUserId)}`}
          className="block truncate text-csmju-label font-semibold hover:underline"
        >
          {row.coreUserId}
        </Link>
        <span className="block truncate text-csmju-label text-muted-foreground">{profile.displayName}</span>
        <span className="block truncate text-csmju-caption text-muted-foreground">
          <SuggestionCaption row={row} />
        </span>
      </span>
      <FollowToggle coreUserId={row.coreUserId} />
    </li>
  );
}
