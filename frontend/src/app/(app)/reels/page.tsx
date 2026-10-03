'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Clapperboard, Loader2 } from 'lucide-react';
import { toast } from '@/components/csmju/feed-toast';
import { ReelSlide, type ReelView } from '@/components/csmju/reel-slide';
import { ReelUploader } from '@/components/csmju/reel-uploader';
import { api, ApiError, qs, type Page } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Bookmark as BookmarkRow, Reel, RepostState } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// ฟีดคลิปสั้นแบบ Instagram Reels บนเว็บ — จอละคลิป เลื่อนแล้วดีดเข้าที่
///
/// ยอดผู้ชมนับ "คนที่เคยดู" ไม่ใช่ "จำนวนครั้งที่เล่น" หลังบ้านมีคีย์
/// (reelId, coreUserId) จึงกดซ้ำไม่เพิ่มยอด — หน้านี้ยิงบันทึกการดูครั้งเดียว
/// ต่อคลิปต่อรอบการโหลด (ตอนเล่นขึ้นจริงครั้งแรก) ไม่ยิงทุกครั้งที่เลื่อนผ่าน
///
/// ลิงก์วิดีโอมีอายุสองนาที จึงขอเฉพาะคลิปที่เห็นอยู่กับคลิปถัดไป — ขอทั้งฟีด
/// ตอนโหลดหน้า คลิปท้าย ๆ จะหมดอายุก่อนผู้ใช้เลื่อนไปถึง

const PAGE_SIZE = 20;

/// คลิปที่ห่างจากคลิปที่เห็นเกินนี้ถอด src ออก — วิดีโอยี่สิบตัวที่ถือ buffer
/// ค้างไว้พร้อมกันทำให้มือถือรุ่นเล็กหน่วงจนเลื่อนสะดุด
const MOUNT_DISTANCE = 2;

/// เหลือกี่คลิปก่อนสุดฟีดแล้วเริ่มโหลดหน้าถัดไป — ให้คลิปใหม่มาทันก่อนเลื่อนถึง
const PREFETCH_DISTANCE = 3;

type Feed = 'all' | 'following';
type ReelPages = InfiniteData<Page<Reel>, number>;

export default function ReelsPage() {
  // useSearchParams ต้องอยู่ใต้ Suspense ไม่งั้น build แบบ prerender ล้ม
  // (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md)
  return (
    <Suspense fallback={null}>
      <ReelsView />
    </Suspense>
  );
}

function ReelsView() {
  const params = useSearchParams();
  const createRequested = params.get('create') === '1';
  const deepLink = params.get('reel');
  const me = useMe();
  const queryClient = useQueryClient();
  const [feed, setFeed] = useState<Feed>('all');
  const [activeId, setActiveId] = useState<string | null>(deepLink);
  /// เริ่มแบบเงียบเสมอ — เบราว์เซอร์ไม่ยอมเล่นอัตโนมัติแบบมีเสียง
  /// และค่านี้ใช้กับทุกคลิป (เปิดเสียงแล้วเลื่อนไปคลิปถัดไปก็ยังมีเสียง)
  const [muted, setMuted] = useState(true);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const viewed = useRef<Set<string>>(new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrolledToDeepLink = useRef(false);
  const commentsOpenRef = useRef(false);

  useEffect(() => {
    commentsOpenRef.current = commentsFor !== null;
  }, [commentsFor]);

  const feedKey = ['reels-feed', feed] as const;

  const {
    data,
    isPending: loading,
    error: queryError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: feedKey,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<Reel>(
        `/reels${qs({
          limit: PAGE_SIZE,
          page: pageParam,
          feed: feed === 'following' ? 'following' : undefined,
        })}`,
      ),
    getNextPageParam: (last) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });

  const { data: saved = new Set<string>() } = useQuery({
    queryKey: ['reel-bookmarks'],
    queryFn: async () => {
      const page = await api.list<BookmarkRow>('/bookmarks?targetKind=REEL&limit=100');

      return new Set(page.items.map((row) => row.targetId));
    },
  });

  const listed = data?.pages.flatMap((page) => page.items) ?? [];

  // ลิงก์ที่แชร์มาอาจชี้คลิปที่ไม่อยู่ใน 20 คลิปล่าสุด (เช่นกดจากหน้าโปรไฟล์)
  // — ถามตัวคลิปตรง ๆ แล้ววางไว้บนสุด ดีกว่าพาไปฟีดที่ไม่มีคลิปที่ขอ
  const deepMissing =
    Boolean(deepLink) && !loading && !listed.some((reel) => reel.id === deepLink);

  const { data: deepReel } = useQuery({
    queryKey: ['reel', deepLink],
    queryFn: () => api.get<Reel>(`/reels/${encodeURIComponent(deepLink ?? '')}`),
    enabled: deepMissing && feed === 'all',
    retry: false,
  });

  const reels =
    deepMissing && deepReel && feed === 'all' ? [deepReel, ...listed] : listed;
  const found = reels.findIndex((reel) => reel.id === activeId);
  const activeIndex = found < 0 ? 0 : found;
  const reelIds = reels.map((reel) => reel.id).join(',');
  const deepIndex = deepLink ? reels.findIndex((reel) => reel.id === deepLink) : -1;

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดคลิปไม่สำเร็จ — หลังบ้านรันอยู่ไหม'
    : null;
  const empty = !loading && !error && reels.length === 0;

  const showToast = toast;

  // คลิปไหนเห็นเกิน 60% คือคลิปที่เล่น — ดูจากกล่องเลื่อนของหน้านี้ ไม่ใช่ทั้งหน้าต่าง
  useEffect(() => {
    const root = scrollerRef.current;

    if (!root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;

          const id = (entry.target as HTMLElement).dataset.reelId;

          if (!id) continue;

          setActiveId(id);
          // เลื่อนไปคลิปอื่นแล้ว แผงความคิดเห็นของคลิปเก่าต้องปิด
          setCommentsFor((open) => (open === id ? open : null));
        }
      },
      { root, threshold: [0.6] },
    );

    for (const element of root.querySelectorAll('[data-reel-id]')) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [reelIds]);

  // ลิงก์ ?reel=<id> — เลื่อนไปคลิปนั้นทันทีที่อยู่ในรายการ (ครั้งเดียว)
  useEffect(() => {
    const root = scrollerRef.current;

    if (!root || deepIndex < 0 || scrolledToDeepLink.current) return;

    scrolledToDeepLink.current = true;
    root.scrollTo({ top: deepIndex * root.clientHeight });
  }, [deepIndex]);

  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      reels.length > 0 &&
      activeIndex >= reels.length - PREFETCH_DISTANCE
    ) {
      void fetchNextPage();
    }
  }, [activeIndex, reels.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const go = useCallback(
    (delta: number) => {
      const root = scrollerRef.current;

      if (!root || reels.length === 0) return;

      const target = Math.min(reels.length - 1, Math.max(0, activeIndex + delta));

      root.scrollTo({ top: target * root.clientHeight, behavior: 'smooth' });
    },
    [activeIndex, reels.length],
  );

  // ลูกศรขึ้น/ลงเลื่อนทีละคลิป — ยกเว้นตอนพิมพ์คอมเมนต์หรือมีกล่องเปิดอยู่
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      // แผงความคิดเห็นเปิดอยู่ = ลูกศรเป็นของรายการความคิดเห็น ไม่ใช่เลื่อนคลิป
      if (commentsOpenRef.current) return;

      const target = event.target;

      if (
        (target instanceof Element &&
          target.closest('input, textarea, select, [contenteditable="true"]')) ||
        // กล่องของระบบมีสองแบบ: <dialog> และกล่อง portal (aria-modal) ของฟีด/แผ่นแชร์
        document.querySelector('dialog[open], [aria-modal="true"]')
      ) {
        return;
      }

      event.preventDefault();
      go(event.key === 'ArrowDown' ? 1 : -1);
    }

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  /// แก้คลิปหนึ่งตัวทั้งในฟีดและในคลิปที่เปิดจากลิงก์ (ถ้ามี)
  function patchReel(id: string, update: (reel: Reel) => Reel | null) {
    const apply = (items: Reel[]) =>
      items.flatMap((reel) => {
        if (reel.id !== id) return [reel];

        const next = update(reel);

        return next ? [next] : [];
      });

    for (const value of ['all', 'following'] as const) {
      queryClient.setQueryData<ReelPages>(['reels-feed', value], (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({ ...page, items: apply(page.items) })),
            }
          : current,
      );
    }

    queryClient.setQueryData<Reel | null>(['reel', id], (current) =>
      current ? update(current) : current,
    );
  }

  function markViewed(reel: Reel) {
    if (viewed.current.has(reel.id)) return;

    viewed.current.add(reel.id);

    api
      .post<{ viewCount: number }>(`/reels/${reel.id}/views`)
      .then((result) =>
        patchReel(reel.id, (row) => ({ ...row, viewCount: result.viewCount })),
      )
      .catch(() => {
        // นับวิวพลาดไม่ควรรบกวนผู้ดู
      });
  }

  async function toggleLike(reel: Reel) {
    try {
      const result = reel.likedByMe
        ? await api.del<{ likeCount: number }>(`/reels/${reel.id}/likes`)
        : await api.post<{ likeCount: number }>(`/reels/${reel.id}/likes`);

      patchReel(reel.id, (row) => ({
        ...row,
        likeCount: result.likeCount,
        likedByMe: !reel.likedByMe,
      }));
    } catch {
      showToast('กดถูกใจไม่สำเร็จ');
    }
  }

  async function toggleSave(reel: Reel) {
    const wasSaved = saved.has(reel.id);

    try {
      if (wasSaved) {
        await api.del(`/bookmarks${qs({ targetKind: 'REEL', targetId: reel.id })}`);
      } else {
        await api.post('/bookmarks', { targetKind: 'REEL', targetId: reel.id });
      }

      queryClient.setQueryData<Set<string>>(['reel-bookmarks'], (prev) => {
        const next = new Set(prev);

        if (wasSaved) next.delete(reel.id);
        else next.add(reel.id);

        return next;
      });
      // หน้า "ที่บันทึกไว้" กับแท็บบันทึกในโปรไฟล์ต้องตรงกัน
      void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
      showToast(wasSaved ? 'เอาออกจากที่บันทึกไว้แล้ว' : 'บันทึกแล้ว');
    } catch {
      showToast('บันทึกไม่สำเร็จ');
    }
  }

  /// รีโพสต์ — ใช้ตัวเลขจริงจากหลังบ้าน (กดซ้ำไม่นับซ้ำ) ไม่บวกลบเอง
  async function toggleRepost(reel: ReelView) {
    try {
      const result = reel.repostedByMe
        ? await api.del<RepostState>(`/reels/${reel.id}/reposts`)
        : await api.post<RepostState>(`/reels/${reel.id}/reposts`);

      patchReel(reel.id, (row) => ({ ...row, ...result }));
      showToast(result.repostedByMe ? 'รีโพสต์แล้ว' : 'เลิกรีโพสต์แล้ว');
    } catch (caught) {
      showToast(caught instanceof ApiError ? caught.message : 'รีโพสต์ไม่สำเร็จ');
    }
  }

  async function remove(reel: Reel) {
    // ปล่อย error ให้กล่องตัวเลือกแสดงเอง (403/404 มีข้อความภาษาไทยจากหลังบ้าน)
    await api.del(`/reels/${reel.id}`);
    patchReel(reel.id, () => null);
    showToast('ลบคลิปแล้ว');
  }

  function switchFeed(next: Feed) {
    if (next === feed) return;

    setFeed(next);
    setActiveId(null);
    setCommentsFor(null);
    scrollerRef.current?.scrollTo({ top: 0 });
  }

  return (
    // absolute เต็ม <main> แทนการกินความสูงด้วย flow ปกติ — main มี padding ล่าง
    // ไว้หลบแถบล่างของมือถือ ถ้าวาง h-full ตาม flow หน้าจะยาวเกินจอเท่า padding
    // นั้นแล้วเลื่อนได้ · มือถือเว้นล่างเท่าความสูงแถบล่าง (fixed, 3rem + safe area
    // ตรงกับ padding ของ main ใน layout) ไม่ให้แถบทับปุ่มของคลิป
    <div className="absolute inset-x-0 top-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] overflow-hidden bg-background lg:bottom-0">
      <div
        ref={scrollerRef}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain scrollbar-none"
      >
        {reels.map((reel, index) => (
          <section
            key={reel.id}
            data-reel-id={reel.id}
            aria-label={reel.title}
            className="h-full snap-start snap-always sm:px-4"
          >
            <ReelSlide
              reel={reel}
              active={index === activeIndex}
              load={index === activeIndex || index === activeIndex + 1}
              mount={Math.abs(index - activeIndex) <= MOUNT_DISTANCE}
              muted={muted}
              onToggleMute={() => setMuted((value) => !value)}
              saved={saved.has(reel.id)}
              onLike={() => void toggleLike(reel)}
              onSave={() => void toggleSave(reel)}
              commentsOpen={commentsFor === reel.id}
              onToggleComments={() =>
                setCommentsFor((open) => (open === reel.id ? null : reel.id))
              }
              onCommentCountChange={(delta) =>
                patchReel(reel.id, (row) => ({
                  ...row,
                  commentCount: Math.max(0, row.commentCount + delta),
                }))
              }
              onRepost={() => void toggleRepost(reel)}
              canDelete={reel.authorCoreUserId === me.id || me.coreRole === 'admin'}
              onDelete={() => remove(reel)}
              onViewed={() => markViewed(reel)}
            />
          </section>
        ))}

        {isFetchingNextPage && (
          <div className="flex h-16 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-label="กำลังโหลดคลิปเพิ่ม" />
          </div>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="size-8 animate-spin" aria-label="กำลังโหลด" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center px-6">
          <p className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-center text-csmju-label text-destructive">
            {error}
          </p>
        </div>
      )}

      {empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
          <span className="grid size-24 place-items-center rounded-full border-2 border-foreground">
            <Clapperboard className="size-11" strokeWidth={1.3} aria-hidden />
          </span>
          <h1 className="mt-2 text-csmju-title">ยังไม่มีคลิป</h1>
          <p className="text-csmju-label text-muted-foreground">
            {feed === 'following'
              ? 'คนที่คุณติดตามยังไม่ได้ลงคลิป ลองดูแท็บ "ทั้งหมด"'
              : 'คลิปสั้นที่ลงจะแสดงที่นี่ ยาวได้ไม่เกิน 60 วินาที'}
          </p>
        </div>
      )}

      {/* แท็บฟีดซ้อนบนสุด: มือถือ/แท็บเล็ตอยู่กลางบนวิดีโอ · จอกว้างชิดซ้ายนอกวิดีโอ */}
      <nav
        aria-label="เลือกฟีดคลิป"
        className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 gap-5 lg:left-6 lg:top-5 lg:translate-x-0"
      >
        {(['all', 'following'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => switchFeed(value)}
            aria-pressed={feed === value}
            className={cn(
              'relative pb-1 text-csmju-body font-semibold transition-colors',
              'max-lg:drop-shadow-md',
              feed === value
                ? 'text-white after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-current lg:text-foreground'
                : 'text-white/60 hover:text-white lg:text-muted-foreground lg:hover:text-foreground',
            )}
          >
            {value === 'all' ? 'ทั้งหมด' : 'คนที่ติดตาม'}
          </button>
        ))}
      </nav>

      {/* ตัวเดียวทั้งหน้า และอยู่ตำแหน่งเดิมใน tree เสมอ — ย้ายแค่ class
        * ถ้าเรนเดอร์สองที่ (มุมขวาบน + กลางจอตอนว่าง) จะได้กล่องสองใบเปิดซ้อนกัน
        * ตอนมาด้วย ?create=1 และสลับที่แล้ว remount จะเปิดกล่องซ้ำหลังลงคลิปแรกเสร็จ */}
      <div
        className={cn(
          'absolute z-20',
          empty
            ? 'left-1/2 top-[calc(50%+4.5rem)] -translate-x-1/2'
            : 'right-3 top-2.5 lg:right-6 lg:top-5',
        )}
      >
        <ReelUploader
          defaultOpen={createRequested}
          onCreated={(reel) => {
            queryClient.setQueryData<ReelPages>(['reels-feed', 'all'], (current) =>
              current
                ? {
                    ...current,
                    pages: current.pages.map((page, index) =>
                      index === 0 ? { ...page, items: [reel, ...page.items] } : page,
                    ),
                  }
                : current,
            );
            if (feed !== 'all') switchFeed('all');
            setActiveId(reel.id);
            scrollerRef.current?.scrollTo({ top: 0 });
          }}
        />
      </div>

      {/* ปุ่มขึ้น/ลงชิดขอบขวากลางจอ เฉพาะจอกว้าง — มือถือปัดนิ้วอยู่แล้ว */}
      {reels.length > 1 && commentsFor === null && (
        <div className="absolute right-6 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={activeIndex === 0}
            aria-label="คลิปก่อนหน้า"
            className="grid size-12 place-items-center rounded-full bg-card text-foreground shadow-csmju-md transition-colors hover:bg-accent disabled:invisible"
          >
            <ChevronUp className="size-6" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={activeIndex >= reels.length - 1}
            aria-label="คลิปถัดไป"
            className="grid size-12 place-items-center rounded-full bg-card text-foreground shadow-csmju-md transition-colors hover:bg-accent disabled:invisible"
          >
            <ChevronDown className="size-6" strokeWidth={1.9} />
          </button>
        </div>
      )}

    </div>
  );
}
