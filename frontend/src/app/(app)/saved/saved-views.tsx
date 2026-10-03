'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, MoreHorizontal, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  GridError,
  GridLoading,
  LoadMore,
  SavedPostTile,
  SavedReelTile,
} from '@/components/csmju/profile-tiles';
import {
  AddToCollectionDialog,
  bookmarkKey,
  CollectionsGrid,
  NameForm,
  refreshSaved,
  SavedEmpty,
  useCollectionItems,
  useCollections,
} from '@/components/csmju/saved-collections';
import { api, qs, type Page } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Bookmark, BookmarkCollection } from '@/lib/csmju/types';

/// หน้าที่บันทึกไว้สามหน้า — หน้ารวมคอลเลกชัน · โพสต์ทั้งหมด · คอลเลกชันหนึ่ง
///
/// เห็นได้เฉพาะเจ้าของ หลังบ้านผูก where กับ coreUserId ทุกคิวรี และไม่มี
/// endpoint ให้ดูของคนอื่นเลย เพราะ "สิ่งที่คนหนึ่งเก็บไว้อ่าน" เป็นข้อมูลส่วนตัว
/// พอ ๆ กับประวัติการค้นหา

function Shell({
  back,
  backLabel,
  title,
  action,
  children,
}: {
  back: string;
  backLabel: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[935px] pb-10 md:px-5">
      <header className="flex items-center gap-2 px-4 pb-4 pt-4 md:px-0 md:pb-6 md:pt-8">
        <Link href={back} aria-label={backLabel} className="-ml-2 grid size-9 place-items-center rounded-full hover:bg-accent">
          <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{title}</h1>
        {action}
      </header>
      {children}
    </div>
  );
}

export function SavedHome() {
  const me = useMe();

  return (
    <Shell back={`/profile/${encodeURIComponent(me.id)}`} backLabel="กลับไปโปรไฟล์" title="ที่บันทึกไว้">
      <CollectionsGrid />
    </Shell>
  );
}

/// ปุ่มเอาออกมุมขวาบนของช่อง — มือถือเห็นตลอด (ไม่มีการชี้) จอกว้างเห็นตอนชี้
function RemoveButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="absolute right-1.5 top-1.5 z-10 grid size-7 place-items-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/80 disabled:opacity-60 md:opacity-0 md:group-hover/tile:opacity-100 md:focus-visible:opacity-100"
    >
      {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <X aria-hidden className="size-4" />}
    </button>
  );
}

function SavedGrid({
  rows,
  removeLabel,
  onRemove,
}: {
  rows: Bookmark[];
  removeLabel: string;
  onRemove: (row: Bookmark) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(row: Bookmark) {
    setBusy(bookmarkKey(row));
    setError(null);

    try {
      await onRemove(row);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เอาออกไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className="px-4 pb-3 text-csmju-label text-destructive md:px-0">
          {error}
        </p>
      )}
      <ul className="grid grid-cols-3 gap-1">
        {rows.map((row) => (
          <li key={bookmarkKey(row)} className="group/tile relative">
            {row.targetKind === 'REEL' ? <SavedReelTile bookmark={row} /> : <SavedPostTile bookmark={row} />}
            <RemoveButton
              label={`${removeLabel}: ${row.title ?? 'รายการที่ถูกลบแล้ว'}`}
              busy={busy === bookmarkKey(row)}
              onClick={() => void remove(row)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/// /saved/all — ทุกอย่างที่บันทึกไว้ เอาออกได้จากตรงนี้ (เหมือนกดบันทึกซ้ำที่ตัวโพสต์)
export function AllSavedView() {
  const queryClient = useQueryClient();
  const all = useInfiniteQuery({
    queryKey: ['bookmarks-all'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.list<Bookmark>(`/bookmarks?limit=48&page=${pageParam}`),
    getNextPageParam: (last: Page<Bookmark>) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });
  const rows = all.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Shell back="/saved" backLabel="กลับไปที่บันทึกไว้" title="โพสต์ทั้งหมด">
      {all.error ? (
        <GridError error={all.error} />
      ) : all.isPending ? (
        <GridLoading />
      ) : rows.length === 0 ? (
        <SavedEmpty />
      ) : (
        <>
          <SavedGrid
            rows={rows}
            removeLabel="เลิกบันทึก"
            onRemove={async (row) => {
              await api.del(`/bookmarks${qs({ targetKind: row.targetKind, targetId: row.targetId })}`);
              refreshSaved(queryClient);
            }}
          />
          <LoadMore more={all.hasNextPage} fetching={all.isFetchingNextPage} onLoad={() => void all.fetchNextPage()} />
        </>
      )}
    </Shell>
  );
}

/// /saved/:id — คอลเลกชันหนึ่ง พร้อมเมนู ⋯ แก้ชื่อ · เพิ่มจากที่บันทึกไว้ · ลบ
export function CollectionView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const collections = useCollections();
  const items = useCollectionItems(collectionId);
  const [dialog, setDialog] = useState<'menu' | 'rename' | 'add' | 'delete' | null>(null);

  // หลังบ้านไม่มี GET /bookmark-collections/:id — ชื่ออ่านจากรายการคอลเลกชัน
  const collection = collections.data?.find((row) => row.id === collectionId);
  const rows = items.data?.pages.flatMap((page) => page.items) ?? [];
  const existing = new Set(rows.map(bookmarkKey));

  if (collections.isFetched && !collection) {
    return (
      <Shell back="/saved" backLabel="กลับไปที่บันทึกไว้" title="ไม่พบคอลเลกชัน">
        <p className="px-4 py-10 text-center text-csmju-label text-muted-foreground md:px-0">
          คอลเลกชันนี้อาจถูกลบไปแล้ว ·{' '}
          <Link href="/saved" className="font-semibold text-link">
            กลับไปที่บันทึกไว้
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell
      back="/saved"
      backLabel="กลับไปที่บันทึกไว้"
      title={collection?.name ?? 'คอลเลกชัน'}
      action={
        collection && (
          <button
            type="button"
            onClick={() => setDialog('menu')}
            aria-label="ตัวเลือกคอลเลกชัน"
            aria-haspopup="dialog"
            className="grid size-9 place-items-center rounded-full hover:bg-accent"
          >
            <MoreHorizontal aria-hidden strokeWidth={1.9} className="size-6" />
          </button>
        )
      }
    >
      {items.error ? (
        <GridError error={items.error} />
      ) : items.isPending ? (
        <GridLoading />
      ) : rows.length === 0 ? (
        <SavedEmpty
          action={
            <button
              type="button"
              onClick={() => setDialog('add')}
              className="mt-4 text-csmju-label font-semibold text-link hover:text-foreground"
            >
              เพิ่มจากที่บันทึกไว้
            </button>
          }
        />
      ) : (
        <>
          <SavedGrid
            rows={rows}
            removeLabel="เอาออกจากคอลเลกชัน"
            onRemove={async (row) => {
              await api.del(
                `/bookmark-collections/${encodeURIComponent(collectionId)}/items${qs({
                  targetKind: row.targetKind,
                  targetId: row.targetId,
                })}`,
              );
              refreshSaved(queryClient, collectionId);
            }}
          />
          <LoadMore more={items.hasNextPage} fetching={items.isFetchingNextPage} onLoad={() => void items.fetchNextPage()} />
        </>
      )}

      {collection && (
        <>
          <Dialog open={dialog === 'menu'} onOpenChange={(open) => !open && setDialog(null)}>
            <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
              <DialogTitle className="sr-only">ตัวเลือกของ {collection.name}</DialogTitle>
              <DialogDescription className="sr-only">แก้ชื่อ เพิ่มของ หรือลบคอลเลกชันนี้</DialogDescription>
              <MenuRow onClick={() => setDialog('rename')}>แก้ไขคอลเลกชั่น</MenuRow>
              <MenuRow onClick={() => setDialog('add')}>เพิ่มจากที่บันทึกไว้</MenuRow>
              <MenuRow tone="danger" onClick={() => setDialog('delete')}>
                ลบคอลเลกชั่น
              </MenuRow>
              <MenuRow onClick={() => setDialog(null)}>ยกเลิก</MenuRow>
            </DialogContent>
          </Dialog>

          {dialog === 'rename' && <RenameDialog collection={collection} onClose={() => setDialog(null)} />}

          {dialog === 'add' && (
            <AddToCollectionDialog collectionId={collectionId} existing={existing} onClose={() => setDialog(null)} />
          )}

          {dialog === 'delete' && (
            <DeleteDialog
              collection={collection}
              onClose={() => setDialog(null)}
              onDeleted={() => {
                refreshSaved(queryClient);
                queryClient.removeQueries({ queryKey: ['bookmark-collection-items', collectionId] });
                router.push('/saved');
              }}
            />
          )}
        </>
      )}
    </Shell>
  );
}

function MenuRow({
  children,
  onClick,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center justify-center border-b border-border px-4 text-csmju-label transition-colors last:border-b-0 hover:bg-accent ${
        tone === 'danger' ? 'font-bold text-destructive' : ''
      }`}
    >
      {children}
    </button>
  );
}

function RenameDialog({ collection, onClose }: { collection: BookmarkCollection; onClose: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState(collection.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    try {
      await api.patch(`/bookmark-collections/${encodeURIComponent(collection.id)}`, { name: name.trim() });
      refreshSaved(queryClient);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เปลี่ยนชื่อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[400px] rounded-xl border-0 bg-card">
        <DialogTitle className="flex h-[43px] items-center justify-center border-b border-border text-base font-bold">
          แก้ไขคอลเลกชั่น
        </DialogTitle>
        <DialogDescription className="sr-only">เปลี่ยนชื่อคอลเลกชัน</DialogDescription>
        <NameForm
          id={id}
          value={name}
          onChange={setName}
          placeholder="ชื่อคอลเลกชั่น"
          submitLabel="เสร็จ"
          busy={busy}
          error={error}
          onSubmit={() => void save()}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  collection,
  onClose,
  onDeleted,
}: {
  collection: BookmarkCollection;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      await api.del(`/bookmark-collections/${encodeURIComponent(collection.id)}`);
      onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบคอลเลกชันไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
        <div className="px-6 pb-4 pt-7 text-center">
          <DialogTitle className="text-lg font-semibold leading-snug">ลบคอลเลกชั่นนี้ใช่ไหม</DialogTitle>
          <DialogDescription className="mt-1.5">
            &quot;{collection.name}&quot; จะหายไป · ของที่บันทึกไว้ยังอยู่ครบใน &quot;โพสต์ทั้งหมด&quot;
          </DialogDescription>
          {error && (
            <p role="alert" className="mt-2 text-csmju-caption text-destructive">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label font-bold text-destructive hover:bg-accent disabled:opacity-60"
        >
          {busy ? 'กำลังลบ…' : 'ลบ'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label hover:bg-accent"
        >
          ยกเลิก
        </button>
      </DialogContent>
    </Dialog>
  );
}
