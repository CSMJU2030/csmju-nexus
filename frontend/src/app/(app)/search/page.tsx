'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CircleX, Clapperboard, Loader2, Search } from 'lucide-react';
import {
  ExploreGrid,
  ExploreTile,
  LoadMoreSentinel,
} from '@/components/csmju/explore-grid';
import {
  ExploreResults,
  SEARCH_KINDS,
  SearchKindTabs,
  type SearchKind,
  type SearchResult,
} from '@/components/csmju/explore-results';
import { ExploreFooter } from '@/components/csmju/explore-footer';
import {
  recentFromQuery,
  SearchRecents,
  useSearchRecents,
  type RecentItem,
} from '@/components/csmju/explore-recents';
import { useMe } from '@/lib/csmju/session';
import { api, ApiError, qs } from '@/lib/csmju/api';
import type { Reel, SearchAll, SearchHit } from '@/lib/csmju/types';

/// ค้นหา / สำรวจ แบบ Instagram Explore
///
/// ยังไม่พิมพ์ = กริดคลิปจริงล่าสุดทั้งระบบ · พิมพ์แล้ว = ผลค้นหา คน กระทู้
/// คลิป และข้อความแชท (API เดิม `GET /search`)
///
/// คำค้นอยู่ใน `?q=` (และหมวดใน `?kind=`) เพื่อให้ลิงก์ส่งต่อได้และกดย้อนกลับ
/// จากหน้าโปรไฟล์แล้วยังเห็นผลเดิม — อัปเดตด้วย history.replaceState ไม่ใช่
/// router.replace เพราะไม่ต้องการ navigation ทุกครั้งที่พิมพ์หนึ่งตัวอักษร
/// (Next ผูก replaceState เข้ากับ useSearchParams ให้แล้ว —
/// node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md)

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const EXPLORE_PAGE = 24;

function parseKind(value: string | null): SearchKind {
  return SEARCH_KINDS.some((option) => option.value === value)
    ? (value as SearchKind)
    : 'all';
}

export default function SearchPage() {
  // useSearchParams ต้องอยู่ใต้ Suspense ไม่งั้น build แบบ prerender ล้ม
  return (
    <Suspense fallback={null}>
      <ExploreView />
    </Suspense>
  );
}

function ExploreView() {
  const params = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [input, setInput] = useState(urlQ);
  const [q, setQ] = useState(urlQ.trim());
  const [kind, setKind] = useState<SearchKind>(parseKind(params.get('kind')));
  const me = useMe();
  const recents = useSearchRecents(me.id);
  /// ช่องค้นหาถูกแตะแล้วยังว่าง → โชว์ "ล่าสุด" แทนกริด (แบบ IG)
  const [recentsOpen, setRecentsOpen] = useState(false);
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // แตะนอกช่องค้นหา/รายการล่าสุด = ปิดรายการ กลับไปกริดสำรวจ
  // (<dialog> ยืนยันล้างทั้งหมดอยู่ใน DOM ของรายการ จึงนับเป็น "ข้างใน")
  useEffect(() => {
    if (!recentsOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!searchAreaRef.current?.contains(event.target as Node)) setRecentsOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);

    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [recentsOpen]);

  // URL เปลี่ยนจากข้างนอก (กดไอคอนค้นหาในแถบซ้ายซ้ำ = /search เปล่า ๆ,
  // หรือกดย้อนกลับ) → ตามให้ทัน · ปรับ state ระหว่าง render แทน effect
  // replaceState ของเราเองเขียน q เดียวกับที่ถืออยู่ จึงไม่วนกลับมาทับ
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);

  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);

    if (urlQ.trim() !== q) {
      setInput(urlQ);
      setQ(urlQ.trim());
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const url = new URL(window.location.href);

    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');

    if (q && kind !== 'all') url.searchParams.set('kind', kind);
    else url.searchParams.delete('kind');

    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [q, kind]);

  const searching = q.length >= MIN_QUERY;

  // ยอดรวมของทุกหมวดบนแท็บ มาจากโหมด all เสมอ — เลือกหมวดเดียวแล้ว
  // ตัวเลขของหมวดอื่นยังอยู่ (คำขอนี้ถูกแคชไว้จากตอนพิมพ์)
  const {
    data: overview,
    isFetching: fetchingAll,
    error: allError,
  } = useQuery({
    queryKey: ['search', q, 'all'],
    enabled: searching,
    placeholderData: keepPreviousData,
    queryFn: () => api.get<SearchAll>(`/search${qs({ q, kind: 'all' })}`),
  });

  const {
    data: single,
    isFetching: fetchingSingle,
    error: singleError,
  } = useQuery({
    queryKey: ['search', q, kind],
    enabled: searching && kind !== 'all',
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const page = await api.list<SearchHit>(
        `/search${qs({ q, kind, limit: 30 })}`,
      );

      return { items: page.items, total: page.meta.total };
    },
  });

  const result: SearchResult | null =
    kind === 'all'
      ? overview
        ? { counts: overview.counts, hits: overview.hits, total: overview.hits.length }
        : null
      : single
        ? { counts: overview?.counts ?? null, hits: single.items, total: single.total }
        : null;

  /// ผลลัพธ์ที่กดเปิดจริง → จำเป็น "ล่าสุด" — คนจำเป็นคน ข้อความจำเป็นห้อง
  /// กระทู้/คลิปไม่มีหน้าของตัวเองให้กลับไป จึงจำคำค้นที่พาไปเจอแทน
  function pickHit(hit: SearchHit) {
    const item: RecentItem =
      hit.kind === 'PERSON'
        ? { kind: 'person', id: hit.id, title: hit.title, subtitle: hit.snippet }
        : hit.kind === 'MESSAGE' && hit.channelId
          ? { kind: 'room', id: hit.channelId, title: hit.title }
          : recentFromQuery(q);

    recents.add(item);
  }

  function searchNow(text: string) {
    setInput(text);
    setQ(text.trim());
    setRecentsOpen(false);

    if (text.trim().length >= MIN_QUERY) recents.add(recentFromQuery(text));
  }

  const showRecents = recentsOpen && input.trim() === '';
  const queryError = kind === 'all' ? allError : singleError;
  const busy = kind === 'all' ? fetchingAll : fetchingSingle;
  const typing = input.trim() !== q;

  return (
    <div className="mx-auto w-full max-w-243.75 pb-10 pt-4 lg:px-5 lg:pt-8">
      <div ref={searchAreaRef}>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            // Enter = ค้นทันที ไม่ต้องรอ debounce และจำคำค้นนี้ไว้ใน "ล่าสุด"
            searchNow(input);
            inputRef.current?.blur();
          }}
          className="px-4 lg:px-0"
        >
          <div className="relative mx-auto w-full max-w-195">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.9}
            />
            <input
              ref={inputRef}
              value={input}
              onFocus={() => setRecentsOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRecentsOpen(false);
              }}
              onChange={(event) => setInput(event.target.value)}
              placeholder="ค้นหา"
              aria-label="ค้นหา"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={100}
              className="h-11 w-full rounded-full bg-muted pl-12 pr-12 text-csmju-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            {busy || (typing && input.trim().length >= MIN_QUERY) ? (
              <Loader2
                aria-label="กำลังค้นหา"
                className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-muted-foreground"
              />
            ) : (
              input && (
                <button
                  type="button"
                  onClick={() => {
                    setInput('');
                    setQ('');
                    // ล้างคำค้นแล้วกลับไปที่ช่องพิมพ์ = เห็นรายการล่าสุดต่อทันทีแบบ IG
                    inputRef.current?.focus();
                  }}
                  aria-label="ล้างคำค้น"
                  className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <CircleX className="size-5" strokeWidth={1.9} />
                </button>
              )
            )}
          </div>
        </form>

        {!searching && input.trim().length > 0 && input.trim().length < MIN_QUERY && (
          <p className="mt-3 text-center text-csmju-label text-muted-foreground">
            พิมพ์อย่างน้อย {MIN_QUERY} ตัวอักษร
          </p>
        )}

        {showRecents && (
          <div className="mt-5">
            <SearchRecents
              items={recents.items}
              onRemove={recents.remove}
              onClear={recents.clear}
              onOpen={recents.add}
              onSearch={searchNow}
            />
          </div>
        )}
      </div>

      {showRecents ? null : searching ? (
        <div className="mx-auto mt-5 max-w-195">
          <div className="px-4 lg:px-0">
            <SearchKindTabs
              kind={kind}
              counts={overview?.counts ?? null}
              onKind={setKind}
            />
          </div>

          <div className="mt-5">
            {queryError ? (
              <p className="mx-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive lg:mx-0">
                {queryError instanceof ApiError ? queryError.message : 'ค้นหาไม่สำเร็จ'}
              </p>
            ) : result ? (
              <ExploreResults result={result} kind={kind} onKind={setKind} onPick={pickHit} />
            ) : (
              <div className="flex justify-center py-12 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" aria-label="กำลังค้นหา" />
              </div>
            )}
          </div>

          <p className="mt-8 px-4 text-center text-csmju-caption text-muted-foreground">
            ข้อความแชทค้นได้เฉพาะห้องที่คุณเป็นสมาชิก
          </p>
        </div>
      ) : (
        <ExploreFeed />
      )}

      <ExploreFooter />
    </div>
  );
}

/// กริดสำรวจตอนยังไม่พิมพ์ — คลิปจริงล่าสุดของทั้งระบบ เลื่อนแล้วโหลดต่อเอง
function ExploreFeed() {
  const { data, isPending, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['explore-reels'],
      initialPageParam: 1,
      queryFn: ({ pageParam }) =>
        api.list<Reel>(`/reels${qs({ limit: EXPLORE_PAGE, page: pageParam })}`),
      getNextPageParam: (last) =>
        last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    });

  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const reels = data?.pages.flatMap((page) => page.items) ?? [];

  if (error) {
    return (
      <p className="mx-4 mt-6 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive lg:mx-0">
        {error instanceof ApiError ? error.message : 'โหลดคลิปไม่สำเร็จ — หลังบ้านรันอยู่ไหม'}
      </p>
    );
  }

  if (!isPending && reels.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center gap-3 text-center">
        <span className="grid size-24 place-items-center rounded-full border-2 border-foreground">
          <Clapperboard className="size-11" strokeWidth={1.3} aria-hidden />
        </span>
        <p className="mt-2 text-csmju-title">ยังไม่มีคลิปให้สำรวจ</p>
        <p className="text-csmju-label text-muted-foreground">
          คลิปสั้นที่ทุกคนลงจะแสดงที่นี่
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="sr-only">สำรวจ</h1>
      <ExploreGrid className="mt-5 lg:mt-8">
        {isPending
          ? Array.from({ length: 12 }, (_, index) => (
              <li key={index}>
                <span className="block aspect-9/16 animate-pulse bg-muted" />
              </li>
            ))
          : reels.map((reel) => <ExploreTile key={reel.id} reel={reel} />)}
      </ExploreGrid>

      <LoadMoreSentinel
        onVisible={loadMore}
        disabled={!hasNextPage || isFetchingNextPage}
      />

      {isFetchingNextPage && (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-label="กำลังโหลดคลิปเพิ่ม" />
        </div>
      )}
    </>
  );
}
