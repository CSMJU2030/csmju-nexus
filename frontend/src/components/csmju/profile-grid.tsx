'use client';

import { useState, type ReactNode } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import {
  Bookmark as BookmarkIcon,
  Camera,
  Clapperboard,
  Grid3x3,
  Repeat2,
} from 'lucide-react';
import { CollectionsGrid } from '@/components/csmju/saved-collections';
import {
  EmptyState,
  GridError,
  GridLoading,
  LoadMore,
  PostTile,
  ReelTile,
} from '@/components/csmju/profile-tiles';
import { api, qs, type Page } from '@/lib/csmju/api';
import type { Post, Reel } from '@/lib/csmju/types';

/// ตารางผลงานใต้หัวโปรไฟล์ — แท็บ "โพสต์ · คลิป · บันทึกไว้" แบบ Instagram
///
/// แท็บ "โพสต์" รวมกระทู้กับคลิปเรียงตามเวลาเหมือน Instagram ที่รีลส์ก็โผล่ใน
/// ตารางหลักด้วย — ตัวเลข "โพสต์" บนหัวโปรไฟล์จึงเป็นผลรวมสองอย่าง ถ้านับแค่
/// กระทู้แต่ตารางมีคลิปปน ตัวเลขกับของที่เห็นจะไม่ตรงกัน
///
/// ทุกช่องมาจากหลังบ้านจริง ไม่มีรูปตัวอย่าง — ช่องกระทู้ไม่มีรูปเพราะกระทู้
/// ของระบบนี้เป็นข้อความล้วน จึงแสดงหัวข้อแทนการเดารูปขึ้นมาเอง

export type ProfileTab = 'posts' | 'reels' | 'reposts' | 'saved';

/// 24 = 8 แถว × 3 คอลัมน์ พอดีสองหน้าจอ ไม่ต้องรอโหลดนานก่อนเห็นอะไร
const PAGE_SIZE = 24;

type Tile =
  | { kind: 'post'; createdAt: string; post: Post }
  | { kind: 'reel'; createdAt: string; reel: Reel };

function useAuthorPages<T>(
  resource: 'posts' | 'reels',
  author: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ['profile-grid', resource, author],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<T>(
        `/${resource}${qs({
          authorCoreUserId: author,
          limit: PAGE_SIZE,
          page: pageParam,
        })}`,
      ),
    getNextPageParam: (last: Page<T>) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });
}

function flatten<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/// รวมสองแหล่งที่แบ่งหน้าแยกกันให้เรียงถูกเสมอ
///
/// แหล่งที่ยังมีหน้าถัดไป อาจมีของที่ใหม่กว่าชิ้นสุดท้ายของอีกแหล่งรออยู่
/// ถ้าแสดงทุกอย่างที่โหลดมาแล้วทันที ของเก่าจะโผล่ก่อน แล้วพอเลื่อนลงไป
/// ของที่ใหม่กว่าจะแทรกขึ้นมาเหนือมัน — ตารางกระโดดใต้มือผู้ใช้
///
/// จึงตัดที่ "ชิ้นสุดท้ายที่โหลดแล้วของแหล่งที่ยังไม่หมด" ที่ใหม่ที่สุด
/// ของที่เก่ากว่าเส้นนั้นรอไว้จนกว่าจะโหลดหน้าถัดไปมาเทียบ
export function mergeTiles(
  posts: Post[],
  reels: Reel[],
  more: { posts: boolean; reels: boolean },
): Tile[] {
  const tiles: Tile[] = [
    ...posts.map((post) => ({ kind: 'post' as const, createdAt: post.createdAt, post })),
    ...reels.map((reel) => ({ kind: 'reel' as const, createdAt: reel.createdAt, reel })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const cutoffs = [
    more.posts ? posts.at(-1)?.createdAt : undefined,
    more.reels ? reels.at(-1)?.createdAt : undefined,
  ].filter((value): value is string => Boolean(value));

  if (cutoffs.length === 0) return tiles;

  const cutoff = cutoffs.sort().at(-1)!;

  return tiles.filter((tile) => tile.createdAt >= cutoff);
}

export function ProfileGrid({
  coreUserId,
  isMe,
}: {
  coreUserId: string;
  isMe: boolean;
}) {
  const [tab, setTab] = useState<ProfileTab>('posts');

  // แท็บ "บันทึกไว้" เป็นของส่วนตัว — ถ้าเปิดค้างไว้แล้วกดไปโปรไฟล์คนอื่น
  // ต้องไม่ค้างอยู่ที่แท็บที่ไม่มีให้เขา
  const active: ProfileTab = !isMe && tab === 'saved' ? 'posts' : tab;

  const tabs: { id: ProfileTab; label: string; icon: ReactNode }[] = [
    { id: 'posts', label: 'โพสต์', icon: <Grid3x3 strokeWidth={1.9} /> },
    { id: 'reels', label: 'คลิป', icon: <Clapperboard strokeWidth={1.9} /> },
    { id: 'reposts', label: 'รีโพสต์', icon: <Repeat2 strokeWidth={1.9} /> },
    ...(isMe
      ? [{ id: 'saved' as const, label: 'บันทึกไว้', icon: <BookmarkIcon strokeWidth={1.9} /> }]
      : []),
  ];

  return (
    <section aria-label="ผลงาน">
      <div
        role="tablist"
        aria-label="ประเภทผลงาน"
        className="flex justify-around border-t border-border md:justify-center md:gap-14"
      >
        {tabs.map((item) => {
          const selected = item.id === active;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={item.label}
              onClick={() => setTab(item.id)}
              className={`-mt-px flex h-12 flex-1 items-center justify-center gap-1.5 border-t text-csmju-caption font-semibold tracking-wider transition-colors md:h-[52px] md:flex-none [&_svg]:size-6 md:[&_svg]:size-3 ${
                selected
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.icon}
              <span className="hidden md:inline">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={tabs.find((t) => t.id === active)?.label}>
        {active === 'posts' && <AllTab coreUserId={coreUserId} isMe={isMe} />}
        {active === 'reels' && <ReelsTab coreUserId={coreUserId} isMe={isMe} />}
        {active === 'reposts' && <RepostsTab coreUserId={coreUserId} isMe={isMe} />}
        {active === 'saved' && isMe && (
          <div className="pt-4">
            <CollectionsGrid />
          </div>
        )}
      </div>
    </section>
  );
}

function AllTab({ coreUserId, isMe }: { coreUserId: string; isMe: boolean }) {
  const posts = useAuthorPages<Post>('posts', coreUserId, true);
  const reels = useAuthorPages<Reel>('reels', coreUserId, true);

  const tiles = mergeTiles(flatten(posts.data), flatten(reels.data), {
    posts: posts.hasNextPage,
    reels: reels.hasNextPage,
  });

  const error = posts.error ?? reels.error;
  const loading = posts.isPending || reels.isPending;
  const more = posts.hasNextPage || reels.hasNextPage;
  const fetching = posts.isFetchingNextPage || reels.isFetchingNextPage;

  function loadMore() {
    if (posts.hasNextPage && !posts.isFetchingNextPage) void posts.fetchNextPage();
    if (reels.hasNextPage && !reels.isFetchingNextPage) void reels.fetchNextPage();
  }

  if (error) return <GridError error={error} />;
  if (loading) return <GridLoading />;

  if (tiles.length === 0 && !more) {
    return (
      <EmptyState
        icon={<Camera strokeWidth={1.2} className="size-8" />}
        title={isMe ? 'แชร์เรื่องแรกของคุณ' : 'ยังไม่มีโพสต์'}
        body={
          isMe
            ? 'กระทู้และคลิปที่คุณลงจะมาอยู่ในโปรไฟล์ของคุณ'
            : 'เมื่อเขาตั้งกระทู้หรือลงคลิป จะเห็นที่นี่'
        }
        action={
          isMe ? { href: '/feed?create=post', label: 'ตั้งกระทู้แรกของคุณ' } : undefined
        }
      />
    );
  }

  return (
    <>
      <ul className="grid grid-cols-3 gap-1">
        {tiles.map((tile) => (
          <li key={`${tile.kind}-${tile.kind === 'post' ? tile.post.id : tile.reel.id}`}>
            {tile.kind === 'post' ? <PostTile post={tile.post} /> : <ReelTile reel={tile.reel} />}
          </li>
        ))}
      </ul>

      <LoadMore more={more} fetching={fetching} onLoad={loadMore} />
    </>
  );
}

/// คลิปของคนอื่นที่เจ้าของโปรไฟล์รีโพสต์ไว้ — ชี้ไปคลิปเดิม (ลบต้นทางแล้วหายตาม)
function RepostsTab({ coreUserId, isMe }: { coreUserId: string; isMe: boolean }) {
  const reposts = useInfiniteQuery({
    queryKey: ['profile-grid', 'reposts', coreUserId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<Reel>(`/profiles/${encodeURIComponent(coreUserId)}/reposts${qs({ limit: PAGE_SIZE, page: pageParam })}`),
    getNextPageParam: (last: Page<Reel>) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });
  const items = flatten(reposts.data);

  if (reposts.error) return <GridError error={reposts.error} />;
  if (reposts.isPending) return <GridLoading />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Repeat2 strokeWidth={1.2} className="size-8" />}
        title="ยังไม่มีรีโพสต์"
        body={
          isMe
            ? 'คลิปที่คุณรีโพสต์จะแสดงที่นี่ให้ผู้ติดตามเห็น'
            : 'เมื่อเขารีโพสต์คลิป จะเห็นที่นี่'
        }
      />
    );
  }

  return (
    <>
      <ul className="grid grid-cols-3 gap-1">
        {items.map((reel) => (
          <li key={reel.id}>
            <ReelTile reel={reel} />
          </li>
        ))}
      </ul>

      <LoadMore
        more={reposts.hasNextPage}
        fetching={reposts.isFetchingNextPage}
        onLoad={() => void reposts.fetchNextPage()}
      />
    </>
  );
}

function ReelsTab({ coreUserId, isMe }: { coreUserId: string; isMe: boolean }) {
  const reels = useAuthorPages<Reel>('reels', coreUserId, true);
  const items = flatten(reels.data);

  if (reels.error) return <GridError error={reels.error} />;
  if (reels.isPending) return <GridLoading />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Clapperboard strokeWidth={1.2} className="size-8" />}
        title={isMe ? 'ลงคลิปสั้นคลิปแรก' : 'ยังไม่มีคลิป'}
        body={
          isMe
            ? 'คลิปแนวตั้งไม่เกิน 60 วินาทีของคุณจะมาอยู่ที่นี่'
            : 'เมื่อเขาลงคลิปสั้น จะเห็นที่นี่'
        }
        action={isMe ? { href: '/reels?create=1', label: 'ลงคลิปสั้น' } : undefined}
      />
    );
  }

  return (
    <>
      <ul className="grid grid-cols-3 gap-1">
        {items.map((reel) => (
          <li key={reel.id}>
            <ReelTile reel={reel} />
          </li>
        ))}
      </ul>

      <LoadMore
        more={reels.hasNextPage}
        fetching={reels.isFetchingNextPage}
        onLoad={() => void reels.fetchNextPage()}
      />
    </>
  );
}

