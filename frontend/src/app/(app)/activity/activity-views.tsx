'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  Check,
  ChevronRight,
  Clapperboard,
  Grid3x3,
  Hash,
  Heart,
  History,
  ImageIcon,
  Info,
  KeyRound,
  Loader2,
  MessageCircle,
  Globe,
  Pencil,
  Repeat2,
  Reply,
  Sparkles,
  FileText,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { CORE_HOME } from '@/components/csmju/app-rail';
import { HighlightPlayer, highlightsKey } from '@/components/csmju/profile-highlights';
import { ReelThumb } from '@/components/csmju/profile-tiles';
import { MY_FOLLOWING_KEY } from '@/components/csmju/profile-follow-list';
import { BookmarkThumb } from '@/components/csmju/saved-collections';
import { MediaThumb } from '@/components/csmju/story-archive';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError, qs, type Page } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { igAgo } from '@/lib/csmju/time';
import type {
  AccountHistoryItem,
  AccountHistoryKind,
  ActivityOrder,
  FollowEdge,
  HighlightSummary,
  LikedReel,
  MyComment,
  MyStoryReply,
  RepostedReel,
  MyMedia,
  ReactedPost,
  ReactionSummary,
} from '@/lib/csmju/types';
import {
  ActivityToolbar,
  ConfirmDialog,
  DEFAULT_FILTERS,
  filterParams,
  SelectBar,
  type ActivityFilters,
} from './activity-toolbar';

/// เนื้อหาของสามหมวดใน "กิจกรรมของคุณ" — ทุกอย่างมาจาก `/activity/*` ของหลังบ้าน
///
/// ตัวกรองทุกตัวส่งไปให้หลังบ้านกรอง (ดู activity-toolbar.tsx) ยกเว้นไฮไลต์
/// ซึ่งหลังบ้านคืนมาทั้งชุดในคำขอเดียว (ไม่แบ่งหน้า) จึงเรียงและกรองที่นี่ได้
/// โดยไม่ตกหล่น

const PAGE_SIZE = 24;

/// ─── แท็บ ─────────────────────────────────────────────────────────

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  alsoActive?: string[];
}

const INTERACTION_TABS: Tab[] = [
  { href: '/activity/interactions', label: 'การกดถูกใจ', icon: Heart, alsoActive: ['/activity'] },
  { href: '/activity/interactions/comments', label: 'ความคิดเห็น', icon: MessageCircle },
  { href: '/activity/interactions/reposts', label: 'รีโพสต์', icon: Repeat2 },
  { href: '/activity/interactions/story-replies', label: 'การตอบกลับสตอรี่', icon: Reply },
];

const MEDIA_TABS: Tab[] = [
  { href: '/activity/media', label: 'โพสต์', icon: Grid3x3 },
  { href: '/activity/media/reels', label: 'REELS', icon: Clapperboard },
  { href: '/activity/media/highlights', label: 'ไฮไลท์', icon: Sparkles },
];

function Tabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="แท็บ" className="flex shrink-0 gap-6 overflow-x-auto overflow-y-hidden border-b border-border px-4 md:px-6 [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = pathname === tab.href || (tab.alsoActive ?? []).includes(pathname);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex h-12 shrink-0 items-center gap-1.5 border-b text-csmju-caption font-semibold transition-colors ${
              active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon aria-hidden strokeWidth={1.9} className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/// ─── ส่วนประกอบร่วม ───────────────────────────────────────────────

function Frame({
  tabs,
  toolbar,
  footer,
  children,
}: {
  tabs?: Tab[];
  toolbar: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tabs && <Tabs tabs={tabs} />}
      {toolbar}
      {/* เลื่อนเฉพาะเนื้อหาข้างในการ์ด หัวแท็บกับแถบเครื่องมืออยู่กับที่ */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </div>
  );
}

function useSelection() {
  const [selecting, setSelectingState] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  return {
    selecting,
    picked,
    setSelecting(next: boolean) {
      setSelectingState(next);
      if (!next) setPicked(new Set());
    },
    toggle(key: string) {
      setPicked((current) => {
        const next = new Set(current);

        if (next.has(key)) next.delete(key);
        else next.add(key);

        return next;
      });
    },
    clear() {
      setPicked(new Set());
      setSelectingState(false);
    },
  };
}

function useFollowingIds() {
  const { data } = useQuery({
    queryKey: MY_FOLLOWING_KEY,
    queryFn: async () =>
      new Set((await api.list<FollowEdge>('/follows/following?limit=100')).items.map((edge) => edge.coreUserId)),
  });

  return data ?? new Set<string>();
}

function useActivityPages<T>(
  key: readonly unknown[],
  path: string,
  params: { [name: string]: string | number | undefined },
) {
  return useInfiniteQuery({
    queryKey: [...key, params],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.list<T>(`${path}${qs({ ...params, page: pageParam, limit: PAGE_SIZE })}`),
    getNextPageParam: (last: Page<T>) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });
}

function flatten<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/// รวมสองแหล่งที่แบ่งหน้าแยกกันให้เรียงถูกทั้งสองทิศ
///
/// แหล่งที่ยังมีหน้าถัดไปอาจมีของที่ควรมาก่อนชิ้นสุดท้ายของอีกแหล่งรออยู่ —
/// จึงแสดงถึงแค่ "ชิ้นสุดท้ายที่โหลดแล้วของแหล่งที่ยังไม่หมด" ที่มาก่อนสุด
/// ของที่เลยเส้นนั้นรอจนโหลดหน้าถัดไปมาเทียบ (ไม่งั้นตารางกระโดดใต้มือ)
export function mergeByTime<T>(
  sources: { items: T[]; more: boolean }[],
  at: (item: T) => string,
  order: ActivityOrder,
): T[] {
  const sign = order === 'newest' ? -1 : 1;
  const all = sources
    .flatMap((source) => source.items)
    .sort((a, b) => sign * at(a).localeCompare(at(b)));

  const cutoffs = sources
    .filter((source) => source.more && source.items.length > 0)
    .map((source) => at(source.items[source.items.length - 1]));

  if (cutoffs.length === 0) return all;

  cutoffs.sort((a, b) => sign * a.localeCompare(b));

  const cutoff = cutoffs[0];

  return all.filter((item) => (order === 'newest' ? at(item) >= cutoff : at(item) <= cutoff));
}

function Empty({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="grid size-[62px] place-items-center rounded-full border-2 border-foreground">
        <Icon aria-hidden strokeWidth={1.2} className="size-8" />
      </span>
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      <p className="mt-1 max-w-xs text-csmju-label text-muted-foreground">{body}</p>
    </div>
  );
}

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-16 text-csmju-label text-muted-foreground">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      กำลังโหลด…
    </p>
  );
}

function Failure({ error }: { error: unknown }) {
  return (
    <p role="alert" className="px-6 py-16 text-center text-csmju-label text-destructive">
      {error instanceof ApiError ? error.message : 'โหลดรายการไม่สำเร็จ'}
    </p>
  );
}

function More({ more, fetching, onLoad }: { more: boolean; fetching: boolean; onLoad: () => void }) {
  if (!more) return null;

  return (
    <div className="flex justify-center py-4">
      <button
        type="button"
        disabled={fetching}
        onClick={onLoad}
        className="rounded-lg px-3 py-1.5 text-csmju-label font-semibold text-link hover:bg-accent disabled:opacity-60"
      >
        {fetching ? 'กำลังโหลด…' : 'ดูเพิ่มเติม'}
      </button>
    </div>
  );
}

/// วงกลมติ๊กของโหมดเลือก — มุมขวาบนของช่องแบบ Instagram
function CheckMark({ on, className = '' }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid size-6 place-items-center rounded-full border-2 ${
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-white bg-black/30'
      } ${className}`}
    >
      {on && <Check strokeWidth={3} className="size-3.5" />}
    </span>
  );
}

/// ช่องสี่เหลี่ยมจัตุรัสในตาราง — โหมดปกติเป็นลิงก์ไปของชิ้นนั้น
/// โหมดเลือกเป็นปุ่มติ๊ก (ไม่พาออกจากหน้าตอนผู้ใช้กำลังเลือกหลายชิ้น)
function Tile({
  label,
  href,
  kindIcon: KindIcon,
  selecting,
  selected,
  onToggle,
  onOpen,
  children,
}: {
  label: string;
  href?: string;
  kindIcon?: LucideIcon;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      <span aria-hidden className="relative block size-full">
        {children}
      </span>
      {KindIcon && !selecting && (
        <KindIcon
          aria-hidden
          strokeWidth={1.9}
          className="absolute right-2 top-2 size-5 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
        />
      )}
      {selecting && (
        <>
          {selected && <span aria-hidden className="absolute inset-0 bg-white/25" />}
          <CheckMark on={selected} className="absolute right-2 top-2" />
        </>
      )}
    </>
  );

  const className =
    'relative block aspect-square w-full overflow-hidden bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (selecting) {
    return (
      <button type="button" onClick={onToggle} aria-pressed={selected} aria-label={`เลือก ${label}`} className={className}>
        {body}
      </button>
    );
  }

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} aria-label={label} className={className}>
        {body}
      </button>
    );
  }

  return (
    <Link href={href ?? '#'} aria-label={label} className={className}>
      {body}
    </Link>
  );
}

function PostPreview({ title, preview }: { title: string; preview: string | null }) {
  return (
    <span className="flex size-full flex-col justify-center gap-1 bg-gradient-to-br from-card via-card to-muted p-3">
      <span className="line-clamp-3 break-words text-csmju-label font-semibold leading-snug text-foreground">
        {title}
      </span>
      {preview && (
        <span className="line-clamp-3 break-words text-csmju-caption leading-snug text-muted-foreground">
          {preview}
        </span>
      )}
    </span>
  );
}

/// เฟรมแรกของคลิป — หลังบ้านส่งลิงก์วิดีโอมากับแถวแล้ว (`thumbnailUrl`) จึงไม่ต้อง
/// ขอลิงก์แยกทีละช่อง · ถ้าไม่มี (ไฟล์หาย) ค่อยถอยไปขอด้วย assetId
function ReelCoverFrame({ url, assetId }: { url: string | null; assetId?: string }) {
  if (url) {
    return (
      <>
        <span aria-hidden className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Clapperboard strokeWidth={1.2} className="size-8" />
        </span>
        <MediaThumb kind="VIDEO" src={url} alt="" className="relative size-full object-cover" />
      </>
    );
  }

  return assetId ? <ReelThumb assetId={assetId} /> : <span className="block size-full bg-muted" />;
}

function Grid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-3 gap-0.5 md:gap-1">{children}</ul>;
}

/// รันทีละชิ้นตามลำดับ — ถ้าชิ้นหนึ่งพัง ชิ้นก่อนหน้าที่สำเร็จแล้วยังสำเร็จอยู่
/// และบอกผู้ใช้ได้ว่าทำไปกี่ชิ้นแล้ว แทนการยิงพร้อมกันแล้วเดาจากผลที่มาไม่เรียง
async function runEach<T>(items: T[], task: (item: T) => Promise<unknown>) {
  let done = 0;

  for (const item of items) {
    try {
      await task(item);
      done += 1;
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ';

      throw new Error(done > 0 ? `ทำสำเร็จ ${done} รายการ แล้วติดที่: ${reason}` : reason);
    }
  }
}

/// ─── การโต้ตอบ → การกดถูกใจ ─────────────────────────────────────

type LikedItem =
  | { kind: 'REEL'; key: string; at: string; reel: LikedReel }
  | { kind: 'POST'; key: string; at: string; post: ReactedPost };

export function InteractionsLikes() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const selection = useSelection();
  const following = useFollowingIds();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = filterParams(filters);
  const reels = useActivityPages<LikedReel>(['activity-likes', 'REEL'], '/activity/likes', { ...params, target: 'REEL' });
  const posts = useActivityPages<ReactedPost>(['activity-likes', 'POST'], '/activity/likes', { ...params, target: 'POST' });

  const items = mergeByTime<LikedItem>(
    [
      {
        items: flatten(reels.data).map((reel) => ({ kind: 'REEL', key: `REEL:${reel.id}`, at: reel.likedAt, reel })),
        more: reels.hasNextPage,
      },
      {
        items: flatten(posts.data).map((post) => ({ kind: 'POST', key: `POST:${post.id}`, at: post.reactedAt, post })),
        more: posts.hasNextPage,
      },
    ],
    (item) => item.at,
    filters.order,
  );

  const people = [
    ...new Set([
      ...items.map((item) => (item.kind === 'REEL' ? item.reel.authorCoreUserId : item.post.authorCoreUserId)),
      ...following,
    ]),
  ];

  async function unlike() {
    setBusy(true);
    setError(null);

    try {
      await runEach(
        items.filter((item) => selection.picked.has(item.key)),
        async (item) => {
          if (item.kind === 'REEL') {
            await api.del(`/reels/${encodeURIComponent(item.reel.id)}/likes`);

            return;
          }

          // กระทู้ใช้รีแอ็กชัน — ถอนทุกอิโมจิที่ฉันกดไว้ ถึงจะนับว่า "เลิกถูกใจ" จริง
          const summary = await api.get<ReactionSummary>(
            `/reactions${qs({ targetKind: 'POST', targetId: item.post.id })}`,
          );

          for (const total of summary.totals.filter((row) => row.reactedByMe)) {
            await api.del(`/reactions${qs({ targetKind: 'POST', targetId: item.post.id, emoji: total.emoji })}`);
          }
        },
      );
      selection.clear();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เลิกถูกใจไม่สำเร็จ');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['activity-likes'] });
    }
  }

  const error0 = reels.error ?? posts.error;
  const loading = reels.isPending || posts.isPending;

  return (
    <Frame
      tabs={INTERACTION_TABS}
      toolbar={
        <ActivityToolbar
          filters={filters}
          onChange={setFilters}
          people={people}
          showAuthor
          selecting={selection.selecting}
          onSelecting={selection.setSelecting}
          canSelect={items.length > 0}
        />
      }
      footer={
        selection.selecting && (
          <>
            {error && (
              <p role="alert" className="border-t border-border px-6 py-2 text-csmju-caption text-destructive">
                {error}
              </p>
            )}
            <SelectBar
              count={selection.picked.size}
              actionLabel="เลิกถูกใจ"
              busy={busy}
              onAction={() => void unlike()}
              onCancel={() => selection.setSelecting(false)}
            />
          </>
        )
      }
    >
      {error0 ? (
        <Failure error={error0} />
      ) : loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty icon={Heart} title="ยังไม่มีการกดถูกใจ" body="คลิปและกระทู้ที่คุณกดถูกใจจะแสดงที่นี่" />
      ) : (
        <>
          <Grid>
            {items.map((item) => (
              <li key={item.key}>
                {item.kind === 'REEL' ? (
                  <Tile
                    label={`คลิป ${item.reel.title}`}
                    href={`/reels?reel=${encodeURIComponent(item.reel.id)}`}
                    kindIcon={Clapperboard}
                    selecting={selection.selecting}
                    selected={selection.picked.has(item.key)}
                    onToggle={() => selection.toggle(item.key)}
                  >
                    <ReelCoverFrame url={item.reel.thumbnailUrl} assetId={item.reel.assetId} />
                  </Tile>
                ) : (
                  <Tile
                    label={`กระทู้ ${item.post.title}`}
                    href={`/p/${encodeURIComponent(item.post.id)}`}
                    kindIcon={FileText}
                    selecting={selection.selecting}
                    selected={selection.picked.has(item.key)}
                    onToggle={() => selection.toggle(item.key)}
                  >
                    <PostPreview title={item.post.title} preview={item.post.preview} />
                    {/* อิโมจิที่ฉันกดล่าสุด — โพสต์ใช้รีแอ็กชัน ไม่ใช่หัวใจอย่างเดียวแบบคลิป */}
                    <span className="absolute bottom-1.5 left-2 text-lg leading-none" aria-label={`กด ${item.post.emoji}`}>
                      {item.post.emoji}
                    </span>
                  </Tile>
                )}
              </li>
            ))}
          </Grid>
          <More
            more={reels.hasNextPage || posts.hasNextPage}
            fetching={reels.isFetchingNextPage || posts.isFetchingNextPage}
            onLoad={() => {
              if (reels.hasNextPage) void reels.fetchNextPage();
              if (posts.hasNextPage) void posts.fetchNextPage();
            }}
          />
        </>
      )}
    </Frame>
  );
}

/// ─── การโต้ตอบ → ความคิดเห็น ────────────────────────────────────

/// ─── การโต้ตอบ → รีโพสต์ ──────────────────────────────────────────

/// คลิปของคนอื่นที่ฉันรีโพสต์ขึ้นแท็บ "รีโพสต์" บนโปรไฟล์ — เลือกแล้ว "เลิกรีโพสต์" ได้
export function InteractionsReposts() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const selection = useSelection();
  const following = useFollowingIds();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reposts = useActivityPages<RepostedReel>(['activity-reposts'], '/activity/reposts', { ...filterParams(filters) });
  const rows = flatten(reposts.data);
  const people = [...new Set([...rows.map((row) => row.authorCoreUserId), ...following])];

  async function undo() {
    setBusy(true);
    setError(null);

    try {
      await runEach(
        rows.filter((row) => selection.picked.has(row.id)),
        (row) => api.del(`/reels/${encodeURIComponent(row.id)}/reposts`),
      );
      selection.clear();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เลิกรีโพสต์ไม่สำเร็จ');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['activity-reposts'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-grid', 'reposts'] });
    }
  }

  return (
    <Frame
      tabs={INTERACTION_TABS}
      toolbar={
        <ActivityToolbar
          filters={filters}
          onChange={setFilters}
          people={people}
          showAuthor
          selecting={selection.selecting}
          onSelecting={selection.setSelecting}
          canSelect={rows.length > 0}
        />
      }
      footer={
        selection.selecting && (
          <>
            {error && (
              <p role="alert" className="border-t border-border px-6 py-2 text-csmju-caption text-destructive">
                {error}
              </p>
            )}
            <SelectBar
              count={selection.picked.size}
              actionLabel="เลิกรีโพสต์"
              busy={busy}
              onAction={() => void undo()}
              onCancel={() => selection.setSelecting(false)}
            />
          </>
        )
      }
    >
      {reposts.error ? (
        <Failure error={reposts.error} />
      ) : reposts.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={Repeat2} title="ยังไม่มีรีโพสต์" body="คลิปที่คุณรีโพสต์จะแสดงที่นี่และบนแท็บรีโพสต์ของโปรไฟล์คุณ" />
      ) : (
        <>
          <Grid>
            {rows.map((row) => (
              <li key={row.id}>
                <Tile
                  label={`คลิป ${row.title}`}
                  href={`/reels?reel=${encodeURIComponent(row.id)}`}
                  kindIcon={Repeat2}
                  selecting={selection.selecting}
                  selected={selection.picked.has(row.id)}
                  onToggle={() => selection.toggle(row.id)}
                >
                  <ReelCoverFrame url={row.thumbnailUrl} assetId={row.assetId} />
                </Tile>
              </li>
            ))}
          </Grid>
          <More more={reposts.hasNextPage} fetching={reposts.isFetchingNextPage} onLoad={() => void reposts.fetchNextPage()} />
        </>
      )}
    </Frame>
  );
}

/// ─── การโต้ตอบ → การตอบกลับสตอรี่ ────────────────────────────────

/// คำตอบสตอรี่เป็นข้อความในแชทส่วนตัวกับเจ้าของสตอรี่ — กดแล้วเปิดแชทนั้น
/// (ลบที่นี่ไม่ได้ เพราะเป็นข้อความในบทสนทนา ต้องยกเลิกส่งจากในแชทเหมือน Instagram)
export function InteractionsStoryReplies() {
  const me = useMe();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const following = useFollowingIds();
  const replies = useActivityPages<MyStoryReply>(['activity-story-replies'], '/activity/story-replies', {
    ...filterParams(filters),
  });
  const rows = flatten(replies.data);
  const people = [
    ...new Set([
      ...rows.flatMap((row) => (row.storyAuthorCoreUserId ? [row.storyAuthorCoreUserId] : [])),
      ...following,
    ]),
  ];

  return (
    <Frame
      tabs={INTERACTION_TABS}
      toolbar={
        <ActivityToolbar
          filters={filters}
          onChange={setFilters}
          people={people}
          showAuthor
          selecting={false}
          onSelecting={() => undefined}
          canSelect={false}
        />
      }
    >
      {replies.error ? (
        <Failure error={replies.error} />
      ) : replies.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={Reply} title="ยังไม่มีการตอบกลับสตอรี่" body="ข้อความและอิโมจิที่คุณส่งตอบสตอรี่ของคนอื่นจะแสดงที่นี่" />
      ) : (
        <>
          <ul aria-label="การตอบกลับสตอรี่ของคุณ">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/messages?channel=${encodeURIComponent(row.channelId)}`}
                  className="flex w-full items-start gap-3 px-4 py-3 transition-colors hover:bg-accent md:px-6"
                >
                  <span className="shrink-0 pt-0.5 [&_[data-slot=avatar]>span]:!bg-muted">
                    <Avatar coreUserId={me.id} size={44} showOnline={false} />
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block text-csmju-label">
                      คุณ{row.kind === 'REACTION' ? 'แสดงความรู้สึกต่อ' : 'ตอบกลับ'}สตอรี่ของ{' '}
                      {row.storyAuthorCoreUserId ? (
                        <b className="font-semibold">
                          <Named coreUserId={row.storyAuthorCoreUserId} />
                        </b>
                      ) : (
                        'บัญชีที่ไม่มีอยู่แล้ว'
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap break-words text-csmju-label text-foreground/90">
                      {row.kind === 'REACTION' ? <span className="text-2xl leading-none">{row.emoji}</span> : row.content}
                    </span>
                    <time
                      dateTime={row.createdAt}
                      title={new Date(row.createdAt).toLocaleString('th-TH')}
                      className="mt-1 block text-csmju-caption text-muted-foreground"
                    >
                      {igAgo(row.createdAt)}
                    </time>
                  </span>
                  <span aria-hidden className="relative grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-sm bg-muted">
                    {row.story.available !== false && row.story.thumbnailUrl ? (
                      <MediaThumb
                        kind={row.story.thumbnailKind ?? 'IMAGE'}
                        src={row.story.thumbnailUrl}
                        alt=""
                      />
                    ) : (
                      <History strokeWidth={1.7} className="size-4 text-muted-foreground" />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <More more={replies.hasNextPage} fetching={replies.isFetchingNextPage} onLoad={() => void replies.fetchNextPage()} />
        </>
      )}
    </Frame>
  );
}

function Named({ coreUserId }: { coreUserId: string }) {
  return <>{useProfile(coreUserId).displayName}</>;
}

export function InteractionsComments() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const selection = useSelection();
  const following = useFollowingIds();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comments = useActivityPages<MyComment>(['activity-comments'], '/activity/comments', { ...filterParams(filters) });
  const rows = flatten(comments.data);
  const people = [
    ...new Set([
      ...rows.map((row) => row.targetAuthorCoreUserId),
      ...following,
    ]),
  ];

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      await runEach(
        rows.filter((row) => selection.picked.has(row.id)),
        (row) =>
          api.del(
            row.targetKind === 'REEL'
              ? `/reels/${encodeURIComponent(row.targetId)}/comments/${encodeURIComponent(row.id)}`
              : `/posts/${encodeURIComponent(row.targetId)}/comments/${encodeURIComponent(row.id)}`,
          ),
      );
      selection.clear();
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['activity-comments'] });
    }
  }

  return (
    <Frame
      tabs={INTERACTION_TABS}
      toolbar={
        <ActivityToolbar
          filters={filters}
          onChange={setFilters}
          people={people}
          showAuthor
          selecting={selection.selecting}
          onSelecting={selection.setSelecting}
          canSelect={rows.length > 0}
        />
      }
      footer={
        selection.selecting && (
          <SelectBar
            count={selection.picked.size}
            actionLabel="ลบ"
            busy={busy}
            onAction={() => {
              setError(null);
              setConfirming(true);
            }}
            onCancel={() => selection.setSelecting(false)}
          />
        )
      }
    >
      {comments.error ? (
        <Failure error={comments.error} />
      ) : comments.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={MessageCircle} title="ยังไม่มีความคิดเห็น" body="ความคิดเห็นที่คุณเขียนใต้คลิปและกระทู้จะแสดงที่นี่" />
      ) : (
        <>
          <ul aria-label="ความคิดเห็นของคุณ">
            {rows.map((row) => {
              const on = selection.picked.has(row.id);
              const content = (
                <>
                  {selection.selecting && <CheckMark on={on} className="mt-3 shrink-0 border-muted-foreground" />}
                  <span className="shrink-0 pt-0.5 [&_[data-slot=avatar]>span]:!bg-muted">
                    <Avatar coreUserId={me.id} size={44} showOnline={false} />
                  </span>
                  <span className="min-w-0 flex-1 text-left leading-snug">
                    <span className="block text-csmju-label">
                      คุณแสดงความคิดเห็นใน <span className="font-semibold">{row.targetTitle}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap break-words text-csmju-label text-foreground/90">
                      {row.content}
                    </span>
                    <time
                      dateTime={row.createdAt}
                      title={new Date(row.createdAt).toLocaleString('th-TH')}
                      className="mt-1 block text-csmju-caption text-muted-foreground"
                    >
                      {igAgo(row.createdAt)}
                    </time>
                  </span>
                  {/* คลิปมีเฟรมแรกเป็นภาพย่อ · โพสต์ยังแนบรูปไม่ได้ จึงเป็นไอคอน ไม่ย่อหัวข้อ
                      ลงช่อง 44px ซึ่งอ่านไม่ออกและซ้ำกับหัวข้อทางซ้ายอยู่แล้ว */}
                  <span aria-hidden className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-sm bg-muted">
                    {row.targetKind === 'REEL' ? (
                      <BookmarkThumb kind="REEL" id={row.targetId} />
                    ) : (
                      <FileText strokeWidth={1.7} className="size-5 text-muted-foreground" />
                    )}
                  </span>
                </>
              );
              const rowClass = 'flex w-full items-start gap-3 px-4 py-3 transition-colors hover:bg-accent md:px-6';

              return (
                <li key={row.id}>
                  {selection.selecting ? (
                    <button
                      type="button"
                      onClick={() => selection.toggle(row.id)}
                      aria-pressed={on}
                      aria-label={`เลือกความคิดเห็น "${row.content}"`}
                      className={rowClass}
                    >
                      {content}
                    </button>
                  ) : (
                    <Link
                      href={row.targetKind === 'REEL' ? `/reels?reel=${encodeURIComponent(row.targetId)}` : `/p/${encodeURIComponent(row.targetId)}`}
                      className={rowClass}
                    >
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <More more={comments.hasNextPage} fetching={comments.isFetchingNextPage} onLoad={() => void comments.fetchNextPage()} />
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={`ลบความคิดเห็น ${selection.picked.size} รายการใช่ไหม`}
          body="ความคิดเห็นที่ลบแล้วจะหายจากคลิปและกระทู้ และกู้คืนไม่ได้"
          confirmLabel="ลบ"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onClose={() => setConfirming(false)}
        />
      )}
    </Frame>
  );
}

/// ─── รูปภาพและวิดีโอ → โพสต์ / REELS ────────────────────────────

function MediaGrid({ kind }: { kind: 'POST' | 'REEL' }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const selection = useSelection();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /activity/media ไม่รับ authorCoreUserId (ตอบ 400) — ของในหมวดนี้เป็นของฉันเองทั้งหมดอยู่แล้ว
  const range = { ...filterParams(filters), authorCoreUserId: undefined };
  const media = useActivityPages<MyMedia>(['activity-media', kind], '/activity/media', { ...range, kind });
  const rows = flatten(media.data);
  const noun = kind === 'POST' ? 'โพสต์' : 'คลิป';

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      await runEach(
        rows.filter((row) => selection.picked.has(row.id)),
        (row) => api.del(`/${kind === 'POST' ? 'posts' : 'reels'}/${encodeURIComponent(row.id)}`),
      );
      selection.clear();
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['activity-media', kind] });
      void queryClient.invalidateQueries({ queryKey: ['profile-grid'] });
    }
  }

  return (
    <Frame
      tabs={MEDIA_TABS}
      toolbar={
        <ActivityToolbar
          filters={filters}
          onChange={setFilters}
          selecting={selection.selecting}
          onSelecting={selection.setSelecting}
          canSelect={rows.length > 0}
        />
      }
      footer={
        selection.selecting && (
          <SelectBar
            count={selection.picked.size}
            actionLabel="ลบ"
            busy={busy}
            onAction={() => {
              setError(null);
              setConfirming(true);
            }}
            onCancel={() => selection.setSelecting(false)}
          />
        )
      }
    >
      {media.error ? (
        <Failure error={media.error} />
      ) : media.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          icon={kind === 'POST' ? Grid3x3 : Clapperboard}
          title={`ยังไม่มี${noun}`}
          body={kind === 'POST' ? 'กระทู้ที่คุณตั้งจะแสดงที่นี่' : 'คลิปสั้นที่คุณลงจะแสดงที่นี่'}
        />
      ) : (
        <>
          <Grid>
            {rows.map((row) => (
              <li key={row.id}>
                <Tile
                  label={`${noun} ${row.title}`}
                  href={kind === 'REEL' ? `/reels?reel=${encodeURIComponent(row.id)}` : `/p/${encodeURIComponent(row.id)}`}
                  kindIcon={kind === 'REEL' ? Clapperboard : undefined}
                  selecting={selection.selecting}
                  selected={selection.picked.has(row.id)}
                  onToggle={() => selection.toggle(row.id)}
                >
                  {kind === 'REEL' ? (
                    <ReelCoverFrame url={row.thumbnailUrl} />
                  ) : (
                    <PostPreview title={row.title} preview={row.preview} />
                  )}
                </Tile>
              </li>
            ))}
          </Grid>
          <More more={media.hasNextPage} fetching={media.isFetchingNextPage} onLoad={() => void media.fetchNextPage()} />
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={`ลบ${noun} ${selection.picked.size} รายการใช่ไหม`}
          body={`${noun}ที่ลบแล้วจะหายจากโปรไฟล์และฟีดของทุกคน และกู้คืนไม่ได้`}
          confirmLabel="ลบ"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onClose={() => setConfirming(false)}
        />
      )}
    </Frame>
  );
}

export function MediaPosts() {
  return <MediaGrid kind="POST" />;
}

export function MediaReels() {
  return <MediaGrid kind="REEL" />;
}

/// ─── รูปภาพและวิดีโอ → ไฮไลท์ ─────────────────────────────────────

/// หลังบ้านคืนไฮไลต์ทั้งชุดในคำขอเดียว — เรียงและกรองช่วงวันที่ที่นี่จึงไม่ตกหล่น
///
/// เทียบเป็น "วันตามเวลากรุงเทพฯ" แบบเดียวกับที่หลังบ้านทำกับหมวดอื่น
/// ไม่ใช่เทียบสตริง ISO ตรง ๆ ซึ่ง "2026-09-01T05:00Z" จะมากกว่า "2026-09-01"
/// แล้วของวันที่ 1 หลุดจากช่วง "ถึง 1 ก.ย." ไป
const bangkokDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function filterHighlights(rows: HighlightSummary[], filters: ActivityFilters) {
  const { from, to } = filters;

  return rows
    .filter((row) => {
      const day = bangkokDay.format(new Date(row.createdAt));

      return (!from || day >= from) && (!to || day <= to);
    })
    .sort((a, b) => (filters.order === 'newest' ? -1 : 1) * a.createdAt.localeCompare(b.createdAt));
}

export function MediaHighlights() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const selection = useSelection();
  const [playing, setPlaying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const highlights = useQuery({
    queryKey: highlightsKey(me.id),
    queryFn: () => api.get<HighlightSummary[]>(`/profiles/${encodeURIComponent(me.id)}/highlights`),
  });
  const rows = filterHighlights(highlights.data ?? [], filters);

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      await runEach(
        rows.filter((row) => selection.picked.has(row.id)),
        (row) => api.del(`/highlights/${encodeURIComponent(row.id)}`),
      );
      selection.clear();
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: highlightsKey(me.id) });
    }
  }

  return (
    <Frame
      tabs={MEDIA_TABS}
      toolbar={
        <ActivityToolbar
          filters={filters}
          onChange={setFilters}
          selecting={selection.selecting}
          onSelecting={selection.setSelecting}
          canSelect={rows.length > 0}
        />
      }
      footer={
        selection.selecting && (
          <SelectBar
            count={selection.picked.size}
            actionLabel="ลบ"
            busy={busy}
            onAction={() => {
              setError(null);
              setConfirming(true);
            }}
            onCancel={() => selection.setSelecting(false)}
          />
        )
      }
    >
      {highlights.error ? (
        <Failure error={highlights.error} />
      ) : highlights.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={Sparkles} title="ยังไม่มีไฮไลท์" body="สร้างไฮไลท์จากสตอรี่ในคลังได้ที่หน้าโปรไฟล์ของคุณ" />
      ) : (
        <Grid>
          {rows.map((row) => (
            <li key={row.id}>
              <Tile
                label={`ไฮไลท์ ${row.title} (${row.itemCount} สตอรี่)`}
                onOpen={() => setPlaying(row.id)}
                selecting={selection.selecting}
                selected={selection.picked.has(row.id)}
                onToggle={() => selection.toggle(row.id)}
              >
                <MediaThumb kind={row.coverMediaKind} src={row.coverMediaUrl} alt="" />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-8 text-csmju-label font-semibold text-white">
                  <span className="block truncate">{row.title}</span>
                </span>
              </Tile>
            </li>
          ))}
        </Grid>
      )}

      {playing && (
        <HighlightPlayer id={playing} ownerCoreUserId={me.id} isMe={false} onClose={() => setPlaying(null)} onEdit={() => undefined} />
      )}

      {confirming && (
        <ConfirmDialog
          title={`ลบไฮไลท์ ${selection.picked.size} รายการใช่ไหม`}
          body="ไฮไลท์จะหายจากโปรไฟล์ของคุณ · สตอรี่ในคลังยังอยู่ครบ"
          confirmLabel="ลบ"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onClose={() => setConfirming(false)}
        />
      )}
    </Frame>
  );
}

/// ─── ประวัติบัญชี ───────────────────────────────────────────────

/// detail ของ CONTENT_DELETED เป็นชนิดของที่ถูกลบ (POST | REEL | STORY)
const DELETED_NOUN: Record<string, string> = { POST: 'โพสต์', REEL: 'คลิป', STORY: 'สตอรี่' };

const HISTORY: Record<
  AccountHistoryKind,
  { icon: LucideIcon; title: string; body: (detail: string | null, at: string) => ReactNode; href?: (me: string) => string }
> = {
  BIO_CHANGED: {
    icon: Pencil,
    title: 'คำอธิบายตัวเอง',
    body: (detail) => (
      <>
        คุณเปลี่ยนคำอธิบายตัวเองเป็น <b className="font-semibold text-foreground">{detail}</b>
      </>
    ),
    href: () => '/settings/edit',
  },
  BIO_REMOVED: {
    icon: Pencil,
    title: 'คำอธิบายตัวเอง',
    body: () => 'คุณลบคำอธิบายตัวเองออกจากโปรไฟล์ของคุณ',
    href: () => '/settings/edit',
  },
  WEBSITE_CHANGED: {
    icon: Globe,
    title: 'เว็บไซต์',
    body: (detail) =>
      detail ? (
        <>
          คุณเปลี่ยนเว็บไซต์เป็น <b className="break-all font-semibold text-foreground">{detail}</b>
        </>
      ) : (
        'คุณลบเว็บไซต์ออกจากโปรไฟล์ของคุณ'
      ),
    href: () => '/settings/edit',
  },
  COVER_CHANGED: {
    icon: ImageIcon,
    title: 'รูปปก',
    body: () => 'คุณเปลี่ยนรูปปกโปรไฟล์ของคุณ',
    href: () => '/settings/edit',
  },
  COVER_REMOVED: {
    icon: ImageIcon,
    title: 'รูปปก',
    body: () => 'คุณลบรูปปกออกจากโปรไฟล์ของคุณ',
    href: () => '/settings/edit',
  },
  JOINED: {
    icon: Info,
    title: 'สร้างบัญชีแล้ว',
    body: (_detail, at) => (
      <>
        คุณเข้าร่วม CS Nexus เมื่อ{' '}
        <b className="font-semibold text-foreground">
          {new Date(at).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
        </b>
      </>
    ),
    href: (me) => `/profile/${encodeURIComponent(me)}`,
  },
  CONTENT_DELETED: {
    icon: Trash2,
    title: 'ลบเนื้อหา',
    body: (detail) => `คุณลบ${DELETED_NOUN[detail ?? ''] ?? 'เนื้อหา'}หนึ่งรายการ`,
  },
  ROOM_CREATED: {
    icon: Hash,
    title: 'สร้างห้อง',
    body: (detail) =>
      detail ? (
        <>
          คุณสร้างห้อง <b className="font-semibold text-foreground">{detail}</b>
        </>
      ) : (
        'คุณสร้างห้องใหม่'
      ),
    href: () => '/chat',
  },
};

export function AccountHistory() {
  const me = useMe();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const history = useActivityPages<AccountHistoryItem>(['activity-account-history'], '/activity/account-history', {
    order: filterParams(filters).order,
  });
  const rows = flatten(history.data);

  return (
    <Frame
      toolbar={
        <>
          <div className="shrink-0 px-6 pb-1 pt-6 text-center">
            <h2 className="text-base font-bold">เกี่ยวกับประวัติบัญชี</h2>
            <p className="mx-auto mt-1 max-w-sm text-csmju-caption text-muted-foreground">
              ตรวจสอบการเปลี่ยนแปลงที่คุณทำไว้กับบัญชีของคุณตั้งแต่สร้างบัญชี
            </p>
          </div>
          <ActivityToolbar
            filters={filters}
            onChange={setFilters}
            showDates={false}
            selecting={false}
            onSelecting={() => undefined}
            canSelect={false}
          />
        </>
      }
    >
      {history.error ? (
        <Failure error={history.error} />
      ) : history.isPending ? (
        <Loading />
      ) : (
        <>
          {rows.length === 0 && (
            <Empty icon={History} title="ยังไม่มีประวัติบัญชี" body="การเปลี่ยนแปลงที่คุณทำกับบัญชีจะแสดงที่นี่" />
          )}
          <ul aria-label="ประวัติบัญชี">
            {rows.map((row) => {
              const spec = HISTORY[row.kind];

              if (!spec) return null;

              return (
                <li key={row.id}>
                  <HistoryRow
                    icon={spec.icon}
                    title={spec.title}
                    href={spec.href?.(me.id)}
                    body={spec.body(row.detail, row.createdAt)}
                    at={row.createdAt}
                  />
                </li>
              );
            })}

            {/* รหัสผ่าน อีเมล และชื่อผู้ใช้เป็นของระบบกลาง — ประวัติของมันอยู่ที่นั่น */}
            {CORE_HOME && (
              <li>
                <HistoryRow
                  icon={KeyRound}
                  title="รหัสผ่าน อีเมล และชื่อผู้ใช้"
                  body="จัดการที่บัญชีกลาง CSMJU2030"
                  href={CORE_HOME}
                  external
                />
              </li>
            )}
          </ul>
          <More more={history.hasNextPage} fetching={history.isFetchingNextPage} onLoad={() => void history.fetchNextPage()} />
        </>
      )}
    </Frame>
  );
}

function HistoryRow({
  icon: Icon,
  title,
  body,
  at,
  href,
  external = false,
}: {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  at?: string;
  href?: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <Icon aria-hidden strokeWidth={1.7} className="mt-0.5 size-6 shrink-0" />
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block text-csmju-label font-semibold">{title}</span>
        <span className="mt-0.5 block break-words text-csmju-label text-muted-foreground">
          {body}
          {at && (
            <>
              {' '}
              <time dateTime={at} title={new Date(at).toLocaleString('th-TH')}>
                {igAgo(at)}
              </time>
            </>
          )}
        </span>
      </span>
      {href && <ChevronRight aria-hidden strokeWidth={1.9} className="mt-2 size-5 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = 'flex items-start gap-4 px-4 py-3.5 md:px-6';

  if (!href) return <div className={className}>{inner}</div>;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${className} transition-colors hover:bg-accent`}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className={`${className} transition-colors hover:bg-accent`}>
      {inner}
    </Link>
  );
}
