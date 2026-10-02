'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArchiveTile,
  MediaThumb,
  useStoryArchive,
} from '@/components/csmju/story-archive';
import { StoryPlayer, type PlayerAction, type PlayerItem } from '@/components/csmju/story-player';
import { api, ApiError } from '@/lib/csmju/api';
import type { HighlightDetail, HighlightSummary } from '@/lib/csmju/types';

/// แถวไฮไลต์ใต้หัวโปรไฟล์ — วงกลมปก + ชื่อ แบบ Instagram
///
/// ไฮไลต์คือสตอรี่ที่เจ้าของเลือกเก็บไว้ให้อยู่บนโปรไฟล์ถาวร (สตอรี่ปกติหายจาก
/// แถวหลัง 24 ชั่วโมง แต่หลังบ้านเก็บไว้ในคลัง) · ทุกคนที่ล็อกอินดูได้
/// · แก้ไข/ลบได้เฉพาะเจ้าของ — ปุ่มเหล่านั้นจึงขึ้นเฉพาะบนโปรไฟล์ตัวเอง
///
/// โปรไฟล์คนอื่นที่ไม่มีไฮไลต์ ไม่แสดงแถวนี้เลย (Instagram ก็ไม่เว้นที่ว่างไว้)

export const highlightsKey = (coreUserId: string) => ['highlights', coreUserId] as const;
export const highlightKey = (id: string) => ['highlight', id] as const;

const TITLE_MAX = 40;

export function HighlightsRow({ coreUserId, isMe }: { coreUserId: string; isMe: boolean }) {
  const { data: highlights = [], isPending } = useQuery({
    queryKey: highlightsKey(coreUserId),
    queryFn: () =>
      api.get<HighlightSummary[]>(`/profiles/${encodeURIComponent(coreUserId)}/highlights`),
  });

  const [playing, setPlaying] = useState<string | null>(null);
  const [editing, setEditing] = useState<HighlightDetail | 'new' | null>(null);

  if (!isMe && (isPending || highlights.length === 0)) return null;

  return (
    <>
      <ul
        aria-label="ไฮไลต์"
        className="flex gap-4 overflow-x-auto px-4 pt-6 md:gap-8 md:px-0 md:pt-10 lg:pl-14 [&::-webkit-scrollbar]:hidden"
      >
        {highlights.map((highlight) => (
          <li key={highlight.id}>
            <HighlightCircle
              label={highlight.title}
              onClick={() => setPlaying(highlight.id)}
              ariaLabel={`ดูไฮไลต์ ${highlight.title} (${highlight.itemCount} สตอรี่)`}
            >
              <MediaThumb
                kind={highlight.coverMediaKind}
                src={highlight.coverMediaUrl}
                alt=""
                className="size-full rounded-full object-cover"
              />
            </HighlightCircle>
          </li>
        ))}

        {isMe && (
          <li>
            <HighlightCircle label="ใหม่" onClick={() => setEditing('new')} ariaLabel="สร้างไฮไลต์ใหม่">
              <span className="grid size-full place-items-center rounded-full bg-muted/60">
                <Plus aria-hidden strokeWidth={1.4} className="size-9 text-muted-foreground md:size-11" />
              </span>
            </HighlightCircle>
          </li>
        )}
      </ul>

      {playing && (
        <HighlightPlayer
          id={playing}
          ownerCoreUserId={coreUserId}
          isMe={isMe}
          onClose={() => setPlaying(null)}
          onEdit={(detail) => {
            setPlaying(null);
            setEditing(detail);
          }}
        />
      )}

      {/* วาดเฉพาะตอนเปิด — ตัวแก้ไขดึงคลังสตอรี่ ไม่ควรยิงทุกครั้งที่เปิดโปรไฟล์ */}
      {isMe && editing !== null && (
        <HighlightEditor
          key={editing === 'new' ? 'new' : editing.id}
          open
          initial={editing === 'new' ? null : editing}
          ownerCoreUserId={coreUserId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function HighlightCircle({
  label,
  ariaLabel,
  onClick,
  children,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group flex w-16 shrink-0 flex-col items-center gap-2 md:w-[115px]"
    >
      <span className="block size-16 rounded-full border border-border bg-background p-[3px] transition-transform group-active:scale-95 md:size-[87px]">
        {children}
      </span>
      <span className="w-full truncate text-center text-csmju-caption font-semibold">{label}</span>
    </button>
  );
}

/// ตัวเล่นไฮไลต์ — ดึงรายละเอียดตอนกดเท่านั้น (แถวโปรไฟล์มีแค่ปก)
///
/// ลิงก์สื่ออายุ 5 นาที ถ้าดูค้างไว้นานแล้วเจอสื่อโหลดไม่ขึ้น ให้ดึงใหม่ครั้งเดียว
export function HighlightPlayer({
  id,
  ownerCoreUserId,
  isMe,
  onClose,
  onEdit,
}: {
  id: string;
  ownerCoreUserId: string;
  isMe: boolean;
  onClose: () => void;
  onEdit: (detail: HighlightDetail) => void;
}) {
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: highlightKey(id),
    queryFn: () => api.get<HighlightDetail>(`/highlights/${encodeURIComponent(id)}`),
    // ลิงก์ในแคชอาจหมดอายุแล้ว — เปิดใหม่ทุกครั้งต้องได้ลิงก์ใหม่
    staleTime: 0,
  });

  // ไฮไลต์ว่าง (สตอรี่ทุกชิ้นถูกลบไปแล้ว) แสดงเป็นข้อความเดียวกับเปิดไม่ได้
  // — ห้ามเรียก onClose() ระหว่าง render เพราะเป็นการ setState ของ component แม่
  const empty = data !== undefined && data.items.length === 0;

  if (error || empty) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-[400px] rounded-xl border-0 bg-card p-6">
          <DialogTitle className="text-base">เปิดไฮไลต์ไม่ได้</DialogTitle>
          <DialogDescription className="mt-2">
            {empty
              ? 'ไฮไลต์นี้ไม่มีสตอรี่เหลืออยู่แล้ว'
              : error instanceof ApiError
                ? error.message
                : 'ลองใหม่อีกครั้ง'}
          </DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }

  if (!data) {
    return (
      <div className="fixed inset-0 z-100 grid place-items-center bg-black/80" role="status" aria-label="กำลังโหลดไฮไลต์">
        <Loader2 aria-hidden className="size-8 animate-spin text-white" />
      </div>
    );
  }

  const items: PlayerItem[] = data.items.map((item) => ({
    id: item.storyId,
    kind: item.mediaKind,
    src: item.mediaUrl,
    caption: item.caption,
    createdAt: item.createdAt,
  }));

  const actions: PlayerAction[] = isMe
    ? [
        { label: 'แก้ไขไฮไลท์', onSelect: () => onEdit(data) },
        {
          label: 'ลบไฮไลท์',
          tone: 'danger',
          confirm: {
            title: 'ลบไฮไลท์นี้ใช่ไหม',
            body: `"${data.title}" จะหายจากโปรไฟล์ของคุณ · สตอรี่ในคลังยังอยู่ครบ`,
            confirmLabel: 'ลบ',
          },
          onSelect: async () => {
            await api.del(`/highlights/${encodeURIComponent(id)}`);
            queryClient.setQueryData<HighlightSummary[]>(highlightsKey(ownerCoreUserId), (current) =>
              current?.filter((row) => row.id !== id),
            );
            queryClient.removeQueries({ queryKey: highlightKey(id) });
            onClose();
          },
        },
      ]
    : [];

  return (
    <StoryPlayer
      items={items}
      ownerCoreUserId={ownerCoreUserId}
      title={data.title}
      actions={actions}
      onClose={onClose}
      onMediaError={() => void refetch()}
    />
  );
}

/// ตัวเก็บสตอรี่ที่รู้จักแล้ว — ตอนแก้ไขไฮไลต์ ชิ้นในไฮไลต์อาจอยู่ลึกกว่าหน้าที่
/// โหลดคลังมา จึงต้องจำจากรายละเอียดไฮไลต์ด้วย ไม่ใช่จากคลังอย่างเดียว
interface Picked {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  src: string;
  createdAt: string;
}

/// สร้าง/แก้ไขไฮไลต์ สามขั้นแบบ Instagram: ตั้งชื่อ → เลือกสตอรี่ → เลือกหน้าปก
export function HighlightEditor({
  open,
  initial,
  ownerCoreUserId,
  onClose,
}: {
  open: boolean;
  initial: HighlightDetail | null;
  ownerCoreUserId: string;
  onClose: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const archive = useStoryArchive();

  const [step, setStep] = useState<'name' | 'stories' | 'cover'>('name');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [picked, setPicked] = useState<Map<string, Picked>>(
    () =>
      new Map(
        (initial?.items ?? []).map((item) => [
          item.storyId,
          { id: item.storyId, kind: item.mediaKind, src: item.mediaUrl, createdAt: item.createdAt },
        ]),
      ),
  );
  const [cover, setCover] = useState<string | null>(initial?.coverStoryId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleLength = [...title.trim()].length;
  /// ไฮไลต์เล่นจากเก่าไปใหม่แบบ Instagram ไม่ว่าจะเลือกลำดับไหน
  const ordered = [...picked.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const coverId = cover && picked.has(cover) ? cover : (ordered[0]?.id ?? null);
  const coverItem = coverId ? picked.get(coverId) : undefined;

  function toggle(item: Picked) {
    setPicked((current) => {
      const next = new Map(current);

      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);

      return next;
    });
  }

  async function finish() {
    setBusy(true);
    setError(null);

    try {
      const body = {
        title: title.trim(),
        storyIds: ordered.map((item) => item.id),
        ...(coverId ? { coverStoryId: coverId } : {}),
      };

      const saved = initial
        ? await api.patch<HighlightDetail>(`/highlights/${encodeURIComponent(initial.id)}`, body)
        : await api.post<HighlightDetail>('/highlights', body);

      queryClient.setQueryData(highlightKey(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: highlightsKey(ownerCoreUserId) });
      onClose();
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น "ชื่อไฮไลต์ต้องยาว 1-40 ตัวอักษร"
      setError(caught instanceof Error ? caught.message : 'บันทึกไฮไลต์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const heading =
    step === 'name'
      ? initial
        ? 'แก้ไขไฮไลท์'
        : 'ไฮไลท์ใหม่'
      : step === 'stories'
        ? 'เลือกสตอรี่'
        : 'เลือกหน้าปก';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={step === 'name'}
        className={`rounded-xl border-0 bg-card ${step === 'name' ? 'max-w-[400px]' : 'max-w-[560px]'}`}
      >
        <div className="relative flex h-[43px] items-center justify-center border-b border-border px-12">
          {step !== 'name' && (
            <button
              type="button"
              onClick={() => setStep(step === 'cover' ? 'stories' : 'name')}
              aria-label="ย้อนกลับ"
              className="absolute left-2 grid size-8 place-items-center rounded-full hover:bg-accent"
            >
              <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
            </button>
          )}

          <DialogTitle className="text-base font-bold">{heading}</DialogTitle>

          {step === 'stories' && (
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() => setStep('cover')}
              className="absolute right-3 text-csmju-label font-semibold text-link hover:text-foreground disabled:opacity-40"
            >
              ถัดไป
            </button>
          )}

          {step === 'cover' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="absolute right-3 flex items-center gap-1 text-csmju-label font-semibold text-link hover:text-foreground disabled:opacity-40"
            >
              {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              เสร็จ
            </button>
          )}
        </div>

        <DialogDescription className="sr-only">
          ตั้งชื่อ เลือกสตอรี่จากคลัง แล้วเลือกหน้าปกของไฮไลต์
        </DialogDescription>

        {step === 'name' && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (titleLength > 0) setStep('stories');
            }}
          >
            <div className="px-4 py-5">
              <label htmlFor={`${id}-title`} className="sr-only">
                ชื่อไฮไลท์
              </label>
              <input
                id={`${id}-title`}
                value={title}
                onChange={(event) => {
                  if ([...event.target.value].length <= TITLE_MAX) setTitle(event.target.value);
                }}
                placeholder="ชื่อไฮไลท์"
                autoComplete="off"
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-csmju-label outline-none focus-visible:border-foreground/40"
              />
              <p className="mt-1.5 text-right text-csmju-caption tabular-nums text-muted-foreground">
                {[...title].length} / {TITLE_MAX}
              </p>
            </div>
            <button
              type="submit"
              disabled={titleLength === 0}
              className="flex h-12 w-full items-center justify-center border-t border-border text-csmju-label font-semibold text-link hover:bg-accent disabled:text-link/40 disabled:hover:bg-transparent"
            >
              ถัดไป
            </button>
          </form>
        )}

        {step === 'stories' && (
          <div className="h-[min(560px,calc(100dvh-10rem))] overflow-y-auto">
            {archive.isPending ? (
              <p className="flex items-center justify-center gap-2 py-16 text-csmju-label text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                กำลังโหลดคลังสตอรี่…
              </p>
            ) : archive.items.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-base font-semibold">ยังไม่มีสตอรี่ในคลัง</p>
                <p className="mt-1 text-csmju-label text-muted-foreground">
                  ไฮไลต์สร้างจากสตอรี่ที่คุณเคยลง — ลงสตอรี่ก่อนแล้วกลับมาที่นี่
                </p>
                <Link href="/feed" className="mt-3 inline-block text-csmju-label font-semibold text-link">
                  ลงสตอรี่ที่หน้าหลัก
                </Link>
              </div>
            ) : (
              <>
                <ul className="grid grid-cols-3 gap-0.5">
                  {archive.items.map((item) => (
                    <li key={item.id}>
                      <ArchiveTile
                        item={item}
                        selected={picked.has(item.id)}
                        onClick={() =>
                          toggle({ id: item.id, kind: item.mediaKind, src: item.mediaUrl, createdAt: item.createdAt })
                        }
                      />
                    </li>
                  ))}
                </ul>
                {archive.hasNextPage && (
                  <div className="flex justify-center py-3">
                    <button
                      type="button"
                      disabled={archive.isFetchingNextPage}
                      onClick={() => void archive.fetchNextPage()}
                      className="rounded-lg px-3 py-1.5 text-csmju-label font-semibold text-link hover:bg-accent disabled:opacity-60"
                    >
                      {archive.isFetchingNextPage ? 'กำลังโหลด…' : 'ดูเพิ่มเติม'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 'cover' && (
          <div className="px-4 pb-5 pt-6">
            <div className="mx-auto size-[180px] overflow-hidden rounded-full border border-border p-1">
              {coverItem && (
                <MediaThumb
                  kind={coverItem.kind}
                  src={coverItem.src}
                  alt="หน้าปกที่เลือก"
                  className="size-full rounded-full object-cover"
                />
              )}
            </div>
            <p className="mt-3 text-center text-base font-semibold">{title.trim()}</p>
            <p className="mt-1 text-center text-csmju-caption text-muted-foreground">
              {picked.size} สตอรี่ · แตะรูปด้านล่างเพื่อตั้งเป็นหน้าปก
            </p>

            <ul aria-label="เลือกหน้าปก" className="mt-5 flex gap-1 overflow-x-auto pb-2">
              {ordered.map((item) => (
                <li key={item.id} className="w-16 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCover(item.id)}
                    aria-pressed={item.id === coverId}
                    aria-label={`ตั้งสตอรี่วันที่ ${new Date(item.createdAt).toLocaleDateString('th-TH')} เป็นหน้าปก`}
                    className={`relative block aspect-[9/16] w-full overflow-hidden rounded-sm ${
                      item.id === coverId ? 'ring-2 ring-foreground' : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    <MediaThumb kind={item.kind} src={item.src} alt="" />
                  </button>
                </li>
              ))}
            </ul>

            {error && (
              <p role="alert" className="mt-3 text-center text-csmju-label text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
