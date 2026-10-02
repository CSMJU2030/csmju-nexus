'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AboutAccount } from '@/components/csmju/feed-post-menu';
import { SheetButton } from '@/components/csmju/feed-modal';
import { toast } from '@/components/csmju/feed-toast';
import { SharePanel, copyShareLink } from '@/components/csmju/share-sheet';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { api, ApiError, type Page } from '@/lib/csmju/api';
import { igAgo } from '@/lib/csmju/time';
import type { StoryInsights, StoryItem, StoryTray, StoryViewerRow } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// ตัวดูสตอรี่ของแถวสตอรี่บนฟีด แบบ Instagram บนเว็บ
///
///   กลาง  สตอรี่ที่กำลังดู 9:16 — แถบความคืบหน้า · ชื่อ/เวลา · เสียง · หยุด · ⋯
///   ข้าง  สตอรี่ของคนก่อน/คนถัดไปเป็นการ์ดเล็กหรี่แสง กดเพื่อกระโดดไปดู
///   ล่าง  ของคนอื่น: ช่อง "ตอบกลับ…" + รีแอ็กชันทันใจ · ของฉัน: "เห็นแล้ว n คน"
///
/// เมนูและแผงย่อย (ผู้ชม · ข้อมูลเชิงลึก · แชร์) วาดอยู่ **ข้างใน** ตัวดู ไม่ใช่
/// กล่องแยก — ตัวดูกักโฟกัสอยู่ ถ้าแผงไปอยู่นอก DOM ของตัวดู Tab จะถูกดึงกลับ
/// และ Esc ต้องปิดแผงบนสุดก่อนแล้วค่อยปิดตัวดู

/// ห้าวินาทีต่อรูปเท่ากับ Instagram · วิดีโอใช้ความยาวจริง
const IMAGE_MS = 5000;
/// กดค้างนานกว่านี้ = หยุดดู ไม่ใช่แตะเปลี่ยนชิ้น
const HOLD_MS = 250;

/// รีแอ็กชันทันใจ 8 ตัวเดียวกับ Instagram
export const QUICK_REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'] as const;

type Panel = null | 'menu' | 'confirm' | 'viewers' | 'insights' | 'about' | 'share';

type ViewerRow = StoryViewerRow;

/// coreUserId คือชื่อปัจจุบัน · coreUserId คงไว้ให้รุ่นก่อน (deprecated)
const viewerId = (row: ViewerRow) => row.coreUserId ?? row.coreUserId;

/// ชิ้นแรกที่ยังไม่ดูของคนนั้น — IG เปิดต่อจากที่ค้างไว้ ไม่เริ่มใหม่ทุกครั้ง
export function firstUnseen(tray: StoryTray): number {
  const index = tray.stories.findIndex((story) => !story.viewedByMe);

  return index < 0 ? 0 : index;
}

export function StoryTrayViewer({
  trays,
  startTray,
  startStoryId,
  onClose,
  onViewed,
  onMediaError,
  onDeleted,
}: {
  trays: StoryTray[];
  startTray: number;
  /// เปิดจากลิงก์ ?story=<id> — เริ่มที่ชิ้นนั้นแทนชิ้นแรกที่ยังไม่ดู
  startStoryId?: string | null;
  onClose: () => void;
  onViewed: (story: StoryItem) => void;
  /// signed URL หมดอายุ — ผู้เรียกดึงแถวใหม่ แล้วส่ง trays ชุดใหม่เข้ามา
  onMediaError: () => void;
  onDeleted: (story: StoryItem) => void;
}) {
  const [trayIndex, setTrayIndex] = useState(() => Math.min(Math.max(startTray, 0), trays.length - 1));
  const [itemIndex, setItemIndex] = useState(() => {
    const tray = trays[startTray];

    if (!tray) return 0;

    const wanted = startStoryId ? tray.stories.findIndex((story) => story.id === startStoryId) : -1;

    return wanted >= 0 ? wanted : firstUnseen(tray);
  });
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [typing, setTyping] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [flying, setFlying] = useState<Array<{ key: number; emoji: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const duration = useRef(IMAGE_MS);
  const elapsed = useRef(0);
  const closeRef = useRef(onClose);
  const viewedRef = useRef(onViewed);
  const errorRef = useRef(onMediaError);
  const flyKey = useRef(0);
  const pressedAt = useRef(0);

  useEffect(() => {
    closeRef.current = onClose;
    viewedRef.current = onViewed;
    errorRef.current = onMediaError;
  });

  const tray = trays[trayIndex];
  const story = tray?.stories[Math.min(itemIndex, (tray?.stories.length ?? 1) - 1)];
  const isMine = Boolean(tray?.isMe);
  const owner = useProfile(tray?.authorCoreUserId ?? '');
  // พิมพ์ตอบกลับ · เปิดแผง · กดค้าง · กดหยุดเอง = หยุดเดิน แบบ IG
  const paused = held || userPaused || typing || panel !== null;

  // เปลี่ยนชิ้น (หรือได้ลิงก์ใหม่) → รีเซ็ตระหว่าง render ไม่ให้เห็นแถบของชิ้นก่อนค้างเฟรมหนึ่ง
  const showing = `${trayIndex}|${story?.id ?? ''}|${story?.mediaUrl ?? ''}`;
  const [shown, setShown] = useState(showing);

  if (shown !== showing) {
    setShown(showing);
    setProgress(0);
    setFailed(false);
  }

  const escape = useCallback(() => {
    if (panel !== null) {
      setPanel(null);
      setPanelError(null);

      return;
    }

    closeRef.current();
  }, [panel]);

  const ref = useModalFocus<HTMLDivElement>(true, escape);

  const goTray = useCallback(
    (index: number) => {
      const target = trays[index];

      if (!target) {
        closeRef.current();

        return;
      }

      setTrayIndex(index);
      setItemIndex(firstUnseen(target));
      setReply('');
      setTyping(false);
    },
    [trays],
  );

  const next = useCallback(() => {
    if (!tray) return;

    if (itemIndex + 1 < tray.stories.length) setItemIndex(itemIndex + 1);
    else goTray(trayIndex + 1);
  }, [tray, itemIndex, trayIndex, goTray]);

  const prev = useCallback(() => {
    if (itemIndex > 0) {
      setItemIndex(itemIndex - 1);

      return;
    }

    if (trayIndex > 0) {
      setTrayIndex(trayIndex - 1);
      setItemIndex(0);
    }
  }, [itemIndex, trayIndex]);

  // นับว่าดูแล้วทุกชิ้นที่ขึ้นจอ (หลังบ้านกันนับซ้ำเอง)
  useEffect(() => {
    if (story) viewedRef.current(story);
  }, [story]);

  useEffect(() => {
    elapsed.current = 0;
    duration.current = IMAGE_MS;
  }, [showing]);

  // เดินด้วย requestAnimationFrame — แท็บถูกซ่อนแล้วหยุดเอง ไม่เลื่อนไปตอนไม่มีคนดู
  useEffect(() => {
    if (paused || failed || !story) return;

    let frame = 0;
    const startedAt = performance.now() - elapsed.current;

    const tick = () => {
      elapsed.current = performance.now() - startedAt;

      const ratio = Math.min(1, elapsed.current / duration.current);

      setProgress(ratio);

      if (ratio >= 1) {
        next();

        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [showing, paused, failed, next, story]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    video.muted = muted;

    if (paused) video.pause();
    else video.play().catch(() => undefined);
  }, [paused, muted, showing]);

  // ←/→/Space — ไม่แย่งปุ่มตอนพิมพ์ตอบกลับหรือเปิดแผงอยู่
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (panel !== null) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') prev();
      if (event.key === ' ') {
        event.preventDefault();
        setUserPaused((value) => !value);
      }
    }

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, panel]);

  // ล็อกการเลื่อนของหน้าเบื้องหลัง
  useEffect(() => {
    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const viewers = useQuery({
    queryKey: ['story-viewers', story?.id],
    enabled: isMine && Boolean(story),
    queryFn: () => api.list<ViewerRow>(`/stories/${story?.id}/viewers`),
  });

  async function send(body: { content: string } | { emoji: string }) {
    if (!story) return;

    setSending(true);

    try {
      await api.post(`/stories/${story.id}/replies`, body);
      toast('ส่งแล้ว');

      if ('content' in body) {
        setReply('');
        inputRef.current?.blur();
      }
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'ส่งไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  function react(emoji: string) {
    const key = ++flyKey.current;

    setFlying((list) => [...list, { key, emoji }]);
    setTimeout(() => setFlying((list) => list.filter((item) => item.key !== key)), 1100);
    inputRef.current?.blur();
    setTyping(false);
    void send({ emoji });
  }

  async function removeStory() {
    if (!story) return;

    setBusy(true);
    setPanelError(null);

    try {
      await api.del(`/stories/${story.id}`);
      setPanel(null);
      toast('ลบสตอรี่แล้ว');
      onDeleted(story);

      if (tray && tray.stories.length <= 1) closeRef.current();
      else if (itemIndex >= (tray?.stories.length ?? 1) - 1) setItemIndex(Math.max(0, itemIndex - 1));
    } catch (caught) {
      setPanelError(caught instanceof ApiError ? caught.message : 'ลบสตอรี่ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!tray || !story || typeof document === 'undefined') return null;

  const viewerRows = viewers.data?.items ?? [];
  const viewCount = viewers.data ? viewers.data.meta.total : story.viewCount;

  // การ์ดข้าง: ก่อนหน้าสองคน ถัดไปสองคน (จอเล็กลงเหลือฝั่งละคน)
  const before = trays.slice(Math.max(0, trayIndex - 2), trayIndex).map((row, i, all) => ({
    tray: row,
    index: trayIndex - all.length + i,
  }));
  const after = trays.slice(trayIndex + 1, trayIndex + 3).map((row, i) => ({ tray: row, index: trayIndex + 1 + i }));

  const overlay = (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`สตอรี่ของ ${owner.displayName}`}
      className="fixed inset-0 z-100 flex items-center justify-center gap-6 bg-black/95 outline-none animate-in fade-in-0 zoom-in-95"
    >
      <button
        type="button"
        onClick={() => closeRef.current()}
        aria-label="ปิด"
        className="absolute right-3 top-3 z-30 hidden size-10 place-items-center rounded-full text-white/90 hover:text-white md:grid"
      >
        <X aria-hidden strokeWidth={1.9} className="size-7" />
      </button>

      <div className="hidden items-center gap-6 lg:flex">
        {before.map(({ tray: row, index }, position) => (
          <SideCard
            key={row.authorCoreUserId}
            tray={row}
            onClick={() => goTray(index)}
            className={position === 0 && before.length === 2 ? 'hidden 2xl:flex' : undefined}
          />
        ))}
      </div>

      {trayIndex > 0 || itemIndex > 0 ? (
        <button
          type="button"
          onClick={prev}
          aria-label="สตอรี่ก่อนหน้า"
          className="z-20 hidden size-8 shrink-0 place-items-center rounded-full bg-white/85 text-black hover:bg-white md:grid"
        >
          <ChevronLeft className="size-5" strokeWidth={2.4} />
        </button>
      ) : (
        <span aria-hidden className="hidden size-8 md:block" />
      )}

      {/* เวที 9:16 แบบ Instagram บนเดสก์ท็อป · มือถือเต็มจอ */}
      <div className="relative size-full overflow-hidden bg-black md:aspect-9/16 md:h-[calc(100dvh-48px)] md:w-auto md:rounded-lg">
        <Media
          story={story}
          failed={failed}
          videoRef={videoRef}
          onDuration={(ms) => {
            duration.current = ms;
          }}
          onError={() => {
            setFailed(true);
            errorRef.current();
          }}
        />

        {/* แตะซ้าย = ก่อนหน้า · ขวา = ถัดไป · กดค้าง = หยุด */}
        <div className="absolute inset-0 z-10 flex" aria-hidden>
          {(['prev', 'next'] as const).map((side) => (
            <div
              key={side}
              className={side === 'prev' ? 'w-1/3' : 'w-2/3'}
              onPointerDown={() => {
                pressedAt.current = performance.now();
                setHeld(true);
              }}
              onPointerUp={() => {
                setHeld(false);

                // แตะสั้น = เปลี่ยนชิ้น · กดค้างแล้วปล่อย = แค่เล่นต่อ (แบบ IG)
                if (performance.now() - pressedAt.current < HOLD_MS) {
                  if (side === 'prev') prev();
                  else next();
                }
              }}
              onPointerLeave={() => setHeld(false)}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-linear-to-b from-black/60 to-transparent px-3 pb-8 pt-3">
          <div className="flex gap-1" aria-hidden>
            {tray.stories.map((item, position) => (
              <span key={item.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                <span
                  className="block h-full bg-white"
                  style={{
                    width: `${position < itemIndex ? 100 : position === itemIndex ? progress * 100 : 0}%`,
                  }}
                />
              </span>
            ))}
          </div>

          <div className="pointer-events-auto mt-3 flex items-center gap-2 text-white">
            <Avatar coreUserId={tray.authorCoreUserId} size={32} showOnline={false} />
            <span className="truncate text-csmju-label font-semibold">{owner.displayName}</span>
            <time dateTime={story.createdAt} className="shrink-0 text-csmju-label text-white/70">
              {igAgo(story.createdAt)}
            </time>
            <span className="flex-1" />
            {story.kind === 'VIDEO' && (
              <IconButton label={muted ? 'เปิดเสียง' : 'ปิดเสียง'} onClick={() => setMuted((value) => !value)}>
                {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </IconButton>
            )}
            <IconButton
              label={userPaused ? 'เล่นต่อ' : 'หยุดชั่วคราว'}
              onClick={() => setUserPaused((value) => !value)}
            >
              {userPaused ? <Play className="size-5 fill-current" /> : <Pause className="size-5 fill-current" />}
            </IconButton>
            <IconButton label="ตัวเลือกสตอรี่" onClick={() => setPanel('menu')}>
              <MoreHorizontal className="size-6" />
            </IconButton>
            <IconButton label="ปิด" onClick={() => closeRef.current()} className="md:hidden">
              <X className="size-6" />
            </IconButton>
          </div>
        </div>

        {story.caption && (
          <p className="pointer-events-none absolute inset-x-0 bottom-20 z-20 px-4 text-center text-csmju-body font-medium text-white drop-shadow-md">
            {story.caption}
          </p>
        )}

        {/* อีโมจิที่ส่งแล้วลอยขึ้นแบบ IG */}
        {flying.map((item) => (
          <span
            key={item.key}
            aria-hidden
            className="pointer-events-none absolute bottom-24 left-1/2 z-40 -translate-x-1/2 text-6xl animate-out fade-out-0 slide-out-to-top-80 duration-1000 fill-mode-forwards"
          >
            {item.emoji}
          </span>
        ))}

        {isMine ? (
          <button
            type="button"
            onClick={() => setPanel('viewers')}
            className="absolute bottom-4 left-4 z-20 flex items-center gap-2 text-csmju-label font-semibold text-white"
          >
            <span className="flex -space-x-2">
              {viewerRows.slice(0, 3).map((row) => (
                <span key={viewerId(row)} className="rounded-full ring-2 ring-black">
                  <Avatar coreUserId={viewerId(row)} size={24} showOnline={false} />
                </span>
              ))}
            </span>
            เห็นแล้ว {viewCount.toLocaleString('th-TH')} คน
          </button>
        ) : (
          <>
            {typing && (
              <div className="absolute inset-x-0 bottom-16 top-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/60 animate-in fade-in-0">
                <p className="text-csmju-label font-semibold text-white">การแสดงความรู้สึกทันใจ</p>
                <div className="grid grid-cols-4 gap-x-6 gap-y-5">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      // pointerdown ก่อน blur ของช่องพิมพ์ — ไม่งั้นแผงหายก่อนคลิกถึง
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => react(emoji)}
                      disabled={sending}
                      aria-label={`ส่งรีแอ็กชัน ${emoji}`}
                      className="text-4xl transition-transform hover:scale-125 active:scale-90"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (reply.trim()) void send({ content: reply.trim() });
              }}
              className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
            >
              <input
                ref={inputRef}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                placeholder={`ตอบกลับ ${owner.displayName}…`}
                aria-label={`ตอบกลับ ${owner.displayName}`}
                maxLength={1000}
                className="min-w-0 flex-1 rounded-full border border-white/60 bg-transparent px-4 py-2.5 text-csmju-label text-white outline-none placeholder:text-white/80 focus:border-white"
              />
              {reply.trim() ? (
                <button type="submit" disabled={sending} className="text-csmju-label font-semibold text-white">
                  ส่ง
                </button>
              ) : (
                <>
                  <IconButton label="ส่งรีแอ็กชัน ❤️" onClick={() => react('❤️')}>
                    <Heart className="size-6" strokeWidth={1.9} />
                  </IconButton>
                  <IconButton label="แชร์" onClick={() => setPanel('share')}>
                    <Send className="size-6" strokeWidth={1.9} />
                  </IconButton>
                </>
              )}
            </form>
          </>
        )}

        {panel !== null && (
          <div
            className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 animate-in fade-in-0 md:items-center md:p-4"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setPanel(null);
            }}
          >
            <div className="flex max-h-[85%] w-full max-w-100 flex-col overflow-hidden rounded-t-2xl bg-card text-card-foreground shadow-xl animate-in fade-in-0 zoom-in-95 md:rounded-xl">
              {panel === 'menu' && (
                <>
                  {isMine ? (
                    <>
                      <SheetButton tone="danger" onClick={() => setPanel('confirm')}>
                        ลบ
                      </SheetButton>
                      <SheetButton onClick={() => setPanel('insights')}>ดูข้อมูลเชิงลึก</SheetButton>
                    </>
                  ) : (
                    <>
                      <SheetButton onClick={() => setPanel('share')}>แชร์ไปยัง…</SheetButton>
                      <SheetButton
                        onClick={() => {
                          void copyShareLink({ kind: 'STORY', id: story.id });
                          setPanel(null);
                        }}
                      >
                        คัดลอกลิงก์
                      </SheetButton>
                    </>
                  )}
                  <SheetButton onClick={() => setPanel('about')}>เกี่ยวกับบัญชีนี้</SheetButton>
                  <SheetButton onClick={() => setPanel(null)}>ยกเลิก</SheetButton>
                </>
              )}

              {panel === 'confirm' && (
                <>
                  <div className="px-6 pb-4 pt-7 text-center">
                    <h2 className="text-csmju-body font-semibold">ลบสตอรี่ใช่ไหม</h2>
                    <p className="mt-1.5 text-csmju-label text-muted-foreground">
                      สตอรี่นี้จะหายจากแถวสตอรี่ คลังสตอรี่ และไฮไลต์ที่มีสตอรี่นี้
                    </p>
                    {panelError && (
                      <p role="alert" className="mt-2 text-csmju-caption text-destructive">
                        {panelError}
                      </p>
                    )}
                  </div>
                  <SheetButton tone="danger" onClick={() => void removeStory()} disabled={busy}>
                    ลบ
                  </SheetButton>
                  <SheetButton onClick={() => setPanel('menu')} disabled={busy}>
                    ยกเลิก
                  </SheetButton>
                </>
              )}

              {panel === 'viewers' && <ViewersPanel storyId={story.id} onClose={() => setPanel(null)} />}
              {panel === 'insights' && <InsightsPanel storyId={story.id} onClose={() => setPanel(null)} />}
              {panel === 'about' && (
                <AboutAccount coreUserId={tray.authorCoreUserId} onClose={() => setPanel(null)} />
              )}
              {panel === 'share' && (
                <SharePanel target={{ kind: 'STORY', id: story.id }} onClose={() => setPanel(null)} />
              )}
            </div>
          </div>
        )}
      </div>

      {trayIndex < trays.length - 1 || itemIndex < tray.stories.length - 1 ? (
        <button
          type="button"
          onClick={next}
          aria-label="สตอรี่ถัดไป"
          className="z-20 hidden size-8 shrink-0 place-items-center rounded-full bg-white/85 text-black hover:bg-white md:grid"
        >
          <ChevronRight className="size-5" strokeWidth={2.4} />
        </button>
      ) : (
        <span aria-hidden className="hidden size-8 md:block" />
      )}

      <div className="hidden items-center gap-6 lg:flex">
        {after.map(({ tray: row, index }, position) => (
          <SideCard
            key={row.authorCoreUserId}
            tray={row}
            onClick={() => goTray(index)}
            className={position === 1 ? 'hidden 2xl:flex' : undefined}
          />
        ))}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn('grid size-8 shrink-0 place-items-center rounded-full text-white hover:opacity-70', className)}
    >
      {children}
    </button>
  );
}

function Media({
  story,
  failed,
  videoRef,
  onDuration,
  onError,
}: {
  story: StoryItem;
  failed: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onDuration: (ms: number) => void;
  onError: () => void;
}) {
  if (failed) {
    return (
      <div className="grid size-full place-items-center px-6 text-center">
        <p className="text-csmju-label leading-relaxed text-white/70">
          โหลดสื่อไม่ขึ้น — ลิงก์ของสตอรี่มีอายุจำกัด
          <br />
          กำลังขอลิงก์ใหม่ ถ้ายังไม่ขึ้นให้ปิดแล้วเปิดใหม่
        </p>
      </div>
    );
  }

  if (story.kind === 'VIDEO') {
    return (
      <video
        key={story.id}
        ref={videoRef}
        src={story.mediaUrl}
        autoPlay
        muted
        playsInline
        aria-label={story.caption ?? 'สตอรี่วิดีโอ'}
        className="size-full object-contain"
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;

          if (Number.isFinite(seconds) && seconds > 0) onDuration(seconds * 1000);
        }}
        onError={onError}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL อายุ 5 นาที ผ่าน next/image ไม่ได้
    <img
      key={story.id}
      src={story.mediaUrl}
      alt={story.caption ?? 'สตอรี่'}
      className="size-full object-contain"
      onError={onError}
    />
  );
}

/// การ์ดของคนก่อน/ถัดไป — ภาพชิ้นที่จะเปิดหรี่แสง ชื่อและเวลาตรงกลาง แบบ IG
function SideCard({
  tray,
  onClick,
  className,
}: {
  tray: StoryTray;
  onClick: () => void;
  className?: string;
}) {
  const profile = useProfile(tray.authorCoreUserId);
  const preview = tray.stories[firstUnseen(tray)];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`ดูสตอรี่ของ ${profile.displayName}`}
      className={cn(
        'relative flex aspect-9/16 h-[38dvh] shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-muted text-white transition-transform hover:scale-[1.02]',
        className,
      )}
    >
      {preview && preview.kind === 'IMAGE' && (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL อายุสั้น
        <img src={preview.mediaUrl} alt="" aria-hidden className="absolute inset-0 size-full object-cover opacity-40" />
      )}
      {preview && preview.kind === 'VIDEO' && (
        <video
          src={`${preview.mediaUrl}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          tabIndex={-1}
          className="absolute inset-0 size-full object-cover opacity-40"
        />
      )}
      <span className={cn('relative rounded-full p-0.5', tray.hasUnseen ? 'csmju-story-ring' : 'bg-white/40')}>
        <span className="block rounded-full bg-black p-0.5">
          <Avatar coreUserId={tray.authorCoreUserId} size={56} showOnline={false} />
        </span>
      </span>
      <span className="relative max-w-[90%] truncate text-csmju-label font-semibold">{profile.displayName}</span>
      {preview && (
        <span className="relative text-csmju-caption text-white/80">{igAgo(preview.createdAt)}</span>
      )}
    </button>
  );
}

/// "ผู้ชม" — รายชื่อคนที่ดูแล้ว (เจ้าของเท่านั้น) · GET /stories/:id/viewers แบ่งหน้า
function ViewersPanel({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const query = useInfiniteQuery({
    queryKey: ['story-viewers-all', storyId],
    initialPageParam: 1,
    queryFn: ({ pageParam }): Promise<Page<ViewerRow>> =>
      api.list<ViewerRow>(
        `/stories/${storyId}/viewers?page=${pageParam}&limit=50`,
      ),
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.meta.total ?? 0;

  return (
    <>
      <PanelHeader title="ผู้ชม" onClose={onClose} />
      <div className="min-h-40 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 text-csmju-label font-semibold">เห็นแล้ว {total.toLocaleString('th-TH')} คน</p>
        {query.isPending && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="กำลังโหลด" />}
        {query.isError && (
          <p className="text-csmju-label text-destructive">
            {query.error instanceof ApiError ? query.error.message : 'โหลดรายชื่อผู้ชมไม่สำเร็จ'}
          </p>
        )}
        {!query.isPending && rows.length === 0 && !query.isError && (
          <p className="py-8 text-center text-csmju-label text-muted-foreground">ยังไม่มีใครดูสตอรี่นี้</p>
        )}
        <ul className="space-y-3">
          {rows.map((row) => (
            <ViewerItem key={viewerId(row)} row={row} />
          ))}
        </ul>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="mt-3 w-full text-center text-csmju-label font-semibold text-link"
          >
            {query.isFetchingNextPage ? 'กำลังโหลด…' : 'ดูเพิ่มเติม'}
          </button>
        )}
      </div>
    </>
  );
}

function ViewerItem({ row }: { row: ViewerRow }) {
  const id = viewerId(row);
  const profile = useProfile(id);

  return (
    <li className="flex items-center gap-3">
      <Avatar coreUserId={id} size={44} showOnline={false} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-csmju-label font-semibold">{id}</span>
        <span className="block truncate text-csmju-label text-muted-foreground">{profile.displayName}</span>
      </span>
      <time dateTime={row.viewedAt} className="shrink-0 text-csmju-caption text-muted-foreground">
        {igAgo(row.viewedAt)}
      </time>
    </li>
  );
}

/// ข้อมูลเชิงลึก — ยอดดู ยอดตอบกลับ และรีแอ็กชันแยกตามอีโมจิ (เจ้าของเท่านั้น)
function InsightsPanel({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['story-insights', storyId],
    queryFn: () => api.get<StoryInsights>(`/stories/${storyId}/insights`),
    retry: false,
  });

  // มากไปน้อย แบบหน้าข้อมูลเชิงลึกของ IG
  const reactions = data
    ? Object.entries(data.reactionCounts)
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((a, b) => b.count - a.count)
    : [];

  return (
    <>
      <PanelHeader title="ข้อมูลเชิงลึก" onClose={onClose} />
      <div className="px-4 py-4">
        {isPending && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="กำลังโหลด" />}
        {error && (
          <p className="text-center text-csmju-label text-destructive">
            {error instanceof ApiError ? error.message : 'โหลดข้อมูลเชิงลึกไม่สำเร็จ'}
          </p>
        )}
        {data && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-center">
              <Stat label="ยอดดู" value={data.viewCount} />
              <Stat label="การตอบกลับ" value={data.replyCount} />
            </dl>
            <h3 className="mt-5 text-csmju-label font-semibold">รีแอ็กชัน</h3>
            {reactions.length === 0 ? (
              <p className="mt-2 text-csmju-label text-muted-foreground">ยังไม่มีรีแอ็กชัน</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {reactions.map((row) => (
                  <li key={row.emoji} className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-csmju-label">
                    <span aria-hidden>{row.emoji}</span>
                    <span className="tabular-nums">{row.count.toLocaleString('th-TH')}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-3">
      <dd className="text-csmju-title font-bold tabular-nums">{value.toLocaleString('th-TH')}</dd>
      <dt className="text-csmju-caption text-muted-foreground">{label}</dt>
    </div>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="relative flex shrink-0 items-center justify-center border-b border-border px-4 py-3">
      <h2 className="text-csmju-body font-bold">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิด"
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full hover:bg-accent"
      >
        <X className="size-5" strokeWidth={1.9} />
      </button>
    </header>
  );
}
