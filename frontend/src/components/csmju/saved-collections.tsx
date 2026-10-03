'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { Bookmark as BookmarkIcon, Check, ChevronLeft, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ReelThumb } from '@/components/csmju/profile-tiles';
import { api } from '@/lib/csmju/api';
import type { Bookmark, BookmarkCollection, BookmarkTarget, Post, Reel } from '@/lib/csmju/types';

/// ที่บันทึกไว้แบบ Instagram — การ์ด "โพสต์ทั้งหมด" + การ์ดคอลเลกชัน
///
/// ใช้ทั้งหน้า /saved และแท็บ "บันทึกไว้" บนโปรไฟล์ตัวเอง · ทุกอย่างเป็นของ
/// เจ้าของคนเดียว หลังบ้านผูก where กับ coreUserId ทุกคิวรี
///
/// ของที่ใส่คอลเลกชันได้ต้อง **บันทึกไว้ก่อน** (หลังบ้านตอบ 400 ถ้าไม่ใช่)
/// ตัวเลือกจึงดึงจากรายการที่บันทึกไว้เท่านั้น ไม่มีช่องค้นหาของทั้งระบบ

export const BOOKMARKS_KEY = ['bookmarks'] as const;
export const COLLECTIONS_KEY = ['bookmark-collections'] as const;
export const collectionItemsKey = (id: string) => ['bookmark-collection-items', id] as const;

const NAME_MAX = 60;

/// 100 = เพดานต่อหนึ่งคำขอของหลังบ้าน — พอสำหรับภาพปกและตัวเลือก
export function useBookmarks() {
  return useQuery({
    queryKey: BOOKMARKS_KEY,
    queryFn: async () => (await api.list<Bookmark>('/bookmarks?limit=100')).items,
  });
}

export function useCollections() {
  return useQuery({
    queryKey: COLLECTIONS_KEY,
    // แบ่งหน้า (ค่าปริยาย 20) — ขอเต็มเพดาน 100 ให้การ์ดครบทุกคอลเลกชัน
    queryFn: async () => (await api.list<BookmarkCollection>('/bookmark-collections?limit=100')).items,
  });
}

export function useCollectionItems(id: string) {
  return useInfiniteQuery({
    queryKey: collectionItemsKey(id),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<Bookmark>(`/bookmark-collections/${encodeURIComponent(id)}/items?page=${pageParam}&limit=48`),
    getNextPageParam: (last) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });
}

/// หลังแก้อะไรในคอลเลกชัน ล้างทุกแคชที่เกี่ยว — ภาพปกกับจำนวนชิ้นบนการ์ด
/// มาจากหลังบ้าน จึงไม่คำนวณเองที่หน้าบ้าน
export function refreshSaved(queryClient: QueryClient, collectionId?: string) {
  void queryClient.invalidateQueries({ queryKey: COLLECTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: BOOKMARKS_KEY });
  void queryClient.invalidateQueries({ queryKey: ['bookmarks-all'] });

  if (collectionId) {
    void queryClient.invalidateQueries({ queryKey: collectionItemsKey(collectionId) });
  }
}

export const bookmarkKey = (row: { targetKind: BookmarkTarget; targetId: string }) =>
  `${row.targetKind}:${row.targetId}`;

export function bookmarkHref(row: { targetKind: BookmarkTarget; targetId: string }) {
  return row.targetKind === 'REEL' ? `/reels?reel=${encodeURIComponent(row.targetId)}` : '/feed';
}

/// ภาพย่อของของที่บันทึกไว้หนึ่งชิ้น — คลิปใช้เฟรมแรก กระทู้ใช้หัวข้อ
///
/// ภาพปกของคอลเลกชันรู้แค่ `{targetKind, targetId}` จึงต้องหาหัวข้อเอง:
/// ดูจากรายการที่บันทึกไว้ก่อน (มีอยู่ในแคชแล้วแทบทุกครั้ง) ไม่เจอค่อยถามกระทู้
export function BookmarkThumb({
  kind,
  id,
  title,
  compact = false,
}: {
  kind: BookmarkTarget;
  id: string;
  title?: string | null;
  compact?: boolean;
}) {
  return kind === 'REEL' ? (
    <ReelCover id={id} />
  ) : (
    <PostCover id={id} title={title} compact={compact} />
  );
}

function ReelCover({ id }: { id: string }) {
  const { data, isError } = useQuery({
    queryKey: ['reel', id],
    queryFn: () => api.get<Reel>(`/reels/${encodeURIComponent(id)}`),
  });

  if (isError) return <span className="block size-full bg-muted" aria-hidden />;
  if (!data) return <span className="block size-full animate-pulse bg-muted" aria-hidden />;

  return (
    <span className="relative block size-full">
      <ReelThumb assetId={data.assetId} />
    </span>
  );
}

function PostCover({ id, title, compact }: { id: string; title?: string | null; compact: boolean }) {
  const bookmarks = useBookmarks();
  const known = title ?? bookmarks.data?.find((row) => row.targetKind === 'POST' && row.targetId === id)?.title;

  const { data } = useQuery({
    queryKey: ['post', id],
    enabled: !known && bookmarks.isFetched,
    queryFn: () => api.get<Post>(`/posts/${encodeURIComponent(id)}`),
  });

  const text = known ?? data?.title ?? '';

  return (
    <span className="flex size-full items-center bg-gradient-to-br from-card via-card to-muted p-2">
      <span
        className={`line-clamp-4 break-words font-semibold leading-snug text-foreground ${
          compact ? 'text-[10px]' : 'text-csmju-label'
        }`}
      >
        {text}
      </span>
    </span>
  );
}

/// ─── ตารางการ์ดคอลเลกชัน ─────────────────────────────────────────

export function CollectionsGrid() {
  const bookmarks = useBookmarks();
  const collections = useCollections();
  const [creating, setCreating] = useState(false);

  const saved = bookmarks.data ?? [];
  const list = collections.data ?? [];
  const loading = bookmarks.isPending || collections.isPending;
  const error = bookmarks.error ?? collections.error;

  return (
    <section aria-label="คอลเลกชันที่บันทึกไว้">
      <div className="mb-3 flex items-center justify-between px-4 md:px-0">
        <p className="text-csmju-caption text-muted-foreground">เห็นได้เฉพาะคุณ</p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-csmju-label font-semibold text-link hover:text-foreground"
        >
          + คอลเลกชั่นใหม่
        </button>
      </div>

      {error ? (
        <p role="alert" className="py-10 text-center text-csmju-label text-destructive">
          {error instanceof Error ? error.message : 'โหลดที่บันทึกไว้ไม่สำเร็จ'}
        </p>
      ) : loading ? (
        <ul aria-label="กำลังโหลด" className="grid grid-cols-2 gap-1 md:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <li key={key} className="aspect-square animate-pulse bg-muted" />
          ))}
        </ul>
      ) : saved.length === 0 && list.length === 0 ? (
        <SavedEmpty />
      ) : (
        <ul className="grid grid-cols-2 gap-1 md:grid-cols-3">
          <li>
            <CollectionCard href="/saved/all" name="โพสต์ทั้งหมด" count={saved.length}>
              <span className="grid size-full grid-cols-2 grid-rows-2 gap-px bg-background">
                {[0, 1, 2, 3].map((slot) => {
                  const row = saved[slot];

                  return (
                    <span key={slot} className="relative block overflow-hidden bg-muted">
                      {row && row.title !== null && (
                        <BookmarkThumb kind={row.targetKind} id={row.targetId} title={row.title} compact />
                      )}
                    </span>
                  );
                })}
              </span>
            </CollectionCard>
          </li>

          {list.map((collection) => (
            <li key={collection.id}>
              <CollectionCard
                href={`/saved/${encodeURIComponent(collection.id)}`}
                name={collection.name}
                count={collection.itemCount}
              >
                {collection.cover ? (
                  <BookmarkThumb kind={collection.cover.targetKind} id={collection.cover.targetId} />
                ) : (
                  <span className="block size-full bg-muted" />
                )}
              </CollectionCard>
            </li>
          ))}
        </ul>
      )}

      {creating && <NewCollectionDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

function CollectionCard({
  href,
  name,
  count,
  children,
}: {
  href: string;
  name: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={`${name} · ${count} รายการ`}
      className="group relative block aspect-square overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className="block size-full transition-transform duration-300 group-hover:scale-[1.02]">
        {children}
      </span>
      {/* เงาไล่ล่างให้ชื่อสีขาวอ่านออกบนภาพปกสว่าง */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent"
      />
      <span aria-hidden className="absolute bottom-3 left-4 right-4 truncate text-lg font-semibold text-white md:text-xl">
        {name}
      </span>
    </Link>
  );
}

export function SavedEmpty({ action }: { action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-[62px] place-items-center rounded-full border-2 border-foreground">
        <BookmarkIcon aria-hidden strokeWidth={1.2} className="size-8" />
      </span>
      <h2 className="mt-4 text-[1.75rem] font-extrabold leading-tight">บันทึก</h2>
      <p className="mt-3 max-w-sm text-csmju-label">
        บันทึกกระทู้และคลิปที่อยากกลับมาดูอีกครั้ง · ไม่มีใครเห็นว่าคุณบันทึกอะไรไว้
      </p>
      {action}
    </div>
  );
}

/// ─── ตัวเลือกของที่บันทึกไว้ ─────────────────────────────────────

export function SavedPicker({
  exclude,
  selected,
  onToggle,
}: {
  exclude?: Set<string>;
  selected: Set<string>;
  onToggle: (row: Bookmark) => void;
}) {
  const bookmarks = useBookmarks();
  // ของที่ถูกลบไปแล้ว (title = null) ใส่คอลเลกชันไปก็ดูไม่ได้ ไม่ต้องเสนอ
  const rows = (bookmarks.data ?? []).filter(
    (row) => row.title !== null && !exclude?.has(bookmarkKey(row)),
  );

  if (bookmarks.isPending) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-csmju-label text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        กำลังโหลด…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="px-6 py-16 text-center text-csmju-label text-muted-foreground">
        {exclude?.size
          ? 'ของที่บันทึกไว้ทุกชิ้นอยู่ในคอลเลกชันนี้แล้ว'
          : 'ยังไม่มีอะไรบันทึกไว้ — กดไอคอนบันทึกที่กระทู้หรือคลิปก่อน'}
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-0.5">
      {rows.map((row) => {
        const on = selected.has(bookmarkKey(row));

        return (
          <li key={bookmarkKey(row)}>
            <button
              type="button"
              onClick={() => onToggle(row)}
              aria-pressed={on}
              aria-label={`${row.targetKind === 'REEL' ? 'คลิป' : 'กระทู้'} ${row.title}`}
              className="relative block aspect-square w-full overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookmarkThumb kind={row.targetKind} id={row.targetId} title={row.title} compact />
              {on && <span aria-hidden className="absolute inset-0 bg-white/25" />}
              <span
                aria-hidden
                className={`absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full border-2 ${
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-white bg-black/20'
                }`}
              >
                {on && <Check strokeWidth={3} className="size-3.5" />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function useToggleSet() {
  const [selected, setSelected] = useState<Map<string, Bookmark>>(() => new Map());

  return {
    selected,
    keys: new Set(selected.keys()),
    toggle(row: Bookmark) {
      setSelected((current) => {
        const next = new Map(current);
        const key = bookmarkKey(row);

        if (next.has(key)) next.delete(key);
        else next.set(key, row);

        return next;
      });
    },
  };
}

/// คอลเลกชันใหม่ สองขั้นแบบ Instagram: ตั้งชื่อ → เลือกจากที่บันทึกไว้
export function NewCollectionDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'name' | 'pick'>('name');
  const [name, setName] = useState('');
  const pick = useToggleSet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);

    try {
      await api.post<BookmarkCollection>('/bookmark-collections', {
        name: name.trim(),
        items: [...pick.selected.values()].map((row) => ({
          targetKind: row.targetKind,
          targetId: row.targetId,
        })),
      });
      refreshSaved(queryClient);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'สร้างคอลเลกชันไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={step === 'name'}
        className={`rounded-xl border-0 bg-card ${step === 'name' ? 'max-w-[400px]' : 'max-w-[560px]'}`}
      >
        <div className="relative flex h-[43px] items-center justify-center border-b border-border px-12">
          {step === 'pick' && (
            <button
              type="button"
              onClick={() => setStep('name')}
              aria-label="ย้อนกลับ"
              className="absolute left-2 grid size-8 place-items-center rounded-full hover:bg-accent"
            >
              <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
            </button>
          )}
          <DialogTitle className="text-base font-bold">
            {step === 'name' ? 'คอลเลกชั่นใหม่' : 'เพิ่มจากที่บันทึกไว้'}
          </DialogTitle>
          {step === 'pick' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="absolute right-3 flex items-center gap-1 text-csmju-label font-semibold text-link hover:text-foreground disabled:opacity-40"
            >
              {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              เสร็จ
            </button>
          )}
        </div>
        <DialogDescription className="sr-only">ตั้งชื่อคอลเลกชัน แล้วเลือกของที่บันทึกไว้มาใส่</DialogDescription>

        {step === 'name' ? (
          <NameForm
            id={id}
            value={name}
            onChange={setName}
            placeholder="ชื่อคอลเลกชั่น"
            submitLabel="ถัดไป"
            onSubmit={() => setStep('pick')}
          />
        ) : (
          <>
            <div className="h-[min(520px,calc(100dvh-12rem))] overflow-y-auto">
              <SavedPicker selected={pick.keys} onToggle={pick.toggle} />
            </div>
            {error && (
              <p role="alert" className="border-t border-border px-4 py-2 text-center text-csmju-label text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/// ช่องชื่อ + ปุ่มเต็มความกว้างด้านล่าง — ใช้ทั้งตั้งชื่อใหม่และเปลี่ยนชื่อ
export function NameForm({
  id,
  value,
  onChange,
  placeholder,
  submitLabel,
  busy = false,
  error,
  onSubmit,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: () => void;
}) {
  const length = [...value.trim()].length;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (length > 0 && !busy) onSubmit();
      }}
    >
      <div className="px-4 py-5">
        <label htmlFor={`${id}-name`} className="sr-only">
          {placeholder}
        </label>
        <input
          id={`${id}-name`}
          value={value}
          onChange={(event) => {
            if ([...event.target.value].length <= NAME_MAX) onChange(event.target.value);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-csmju-label outline-none focus-visible:border-foreground/40"
        />
        <p className="mt-1.5 text-right text-csmju-caption tabular-nums text-muted-foreground">
          {[...value].length} / {NAME_MAX}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-csmju-caption text-destructive">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={length === 0 || busy}
        className="flex h-12 w-full items-center justify-center gap-1.5 border-t border-border text-csmju-label font-semibold text-link hover:bg-accent disabled:text-link/40 disabled:hover:bg-transparent"
      >
        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {submitLabel}
      </button>
    </form>
  );
}

/// เพิ่มของที่บันทึกไว้เข้าคอลเลกชันที่มีอยู่แล้ว
///
/// หลังบ้านรับทีละชิ้น จึงยิงเรียงกันไม่ยิงพร้อมกัน — ถ้าชิ้นหนึ่งพัง ผู้ใช้รู้ว่า
/// ชิ้นไหน และชิ้นก่อนหน้าที่สำเร็จแล้วยังอยู่ ไม่ใช่เดาจากคำตอบที่มาไม่เรียงกัน
export function AddToCollectionDialog({
  collectionId,
  existing,
  onClose,
}: {
  collectionId: string;
  existing: Set<string>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const pick = useToggleSet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);

    try {
      for (const row of pick.selected.values()) {
        await api.post(`/bookmark-collections/${encodeURIComponent(collectionId)}/items`, {
          targetKind: row.targetKind,
          targetId: row.targetId,
        });
      }
      refreshSaved(queryClient, collectionId);
      onClose();
    } catch (caught) {
      refreshSaved(queryClient, collectionId);
      setError(caught instanceof Error ? caught.message : 'เพิ่มไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-[560px] rounded-xl border-0 bg-card">
        <div className="relative flex h-[43px] items-center justify-center border-b border-border px-12">
          <button
            type="button"
            onClick={onClose}
            className="absolute left-3 text-csmju-label hover:text-muted-foreground"
          >
            ยกเลิก
          </button>
          <DialogTitle className="text-base font-bold">เพิ่มจากที่บันทึกไว้</DialogTitle>
          <button
            type="button"
            disabled={busy || pick.selected.size === 0}
            onClick={() => void add()}
            className="absolute right-3 flex items-center gap-1 text-csmju-label font-semibold text-link hover:text-foreground disabled:opacity-40"
          >
            {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            เพิ่ม
          </button>
        </div>
        <DialogDescription className="sr-only">เลือกของที่บันทึกไว้เพื่อใส่คอลเลกชันนี้</DialogDescription>
        <div className="h-[min(520px,calc(100dvh-12rem))] overflow-y-auto">
          <SavedPicker exclude={existing} selected={pick.keys} onToggle={pick.toggle} />
        </div>
        {error && (
          <p role="alert" className="border-t border-border px-4 py-2 text-center text-csmju-label text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
