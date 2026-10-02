'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, MoreHorizontal, Pause, Play, X } from 'lucide-react';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { igAgo } from '@/lib/csmju/time';

/// ตัวเล่นสตอรี่เต็มจอสำหรับไฮไลต์และคลังสตอรี่ — แบบหน้าดูสตอรี่ของ Instagram
///
/// ทำไมไม่ใช้ `StoryViewer` ของแถวสตอรี่บนฟีด: ตัวนั้นเป็นทั้งปุ่มวงกลมและตัวเล่น
/// ในชิ้นเดียว (ปุ่มขนาดตายตัว 72px) และไม่มีเมนู ⋯ — ไฮไลต์ต้องมี "แก้ไข/ลบ"
/// ให้เจ้าของ ส่วนคลังต้องเริ่มเล่นจากชิ้นที่กด ไม่ใช่ชิ้นแรกเสมอ
///
/// พฤติกรรมที่ต้องเหมือนกันทุกที่: แถบความคืบหน้าหนึ่งขีดต่อชิ้น · รูปค้าง 5 วินาที
/// วิดีโอใช้ความยาวจริง · แตะซ้าย/ขวา · กดค้างเพื่อหยุด · ←/→/Space/Esc
///
/// **เมนูและกล่องยืนยันวาดอยู่ข้างในตัวเล่น ไม่ใช่ `<Dialog>`** — `<dialog>`
/// ขึ้นบนชั้น top layer นอกกล่องนี้ แล้วตัวกักโฟกัสของตัวเล่นจะดึงโฟกัสกลับ
/// เข้ามาทุกครั้งที่กด Tab ผู้ใช้คีย์บอร์ดจะกดปุ่มในกล่องยืนยันไม่ได้เลย

export interface PlayerItem {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  src: string;
  caption: string | null;
  createdAt: string;
}

export interface PlayerAction {
  label: string;
  tone?: 'danger';
  /// มีค่า = ถามก่อนทำ (เช่นลบ) ด้วยกล่องยืนยันข้างในตัวเล่น
  confirm?: { title: string; body: string; confirmLabel: string };
  onSelect: () => void | Promise<void>;
}

/// ห้าวินาทีต่อรูปเท่ากับ Instagram — อ่านข้อความบนรูปทันโดยไม่น่าเบื่อ
export const IMAGE_DURATION_MS = 5000;

export function StoryPlayer({
  items,
  ownerCoreUserId,
  title,
  startIndex = 0,
  actions = [],
  onClose,
  onMediaError,
}: {
  items: PlayerItem[];
  ownerCoreUserId: string;
  /// ชื่อไฮไลต์ — ไม่ส่ง = ใช้ชื่อเจ้าของ
  title?: string;
  startIndex?: number;
  actions?: PlayerAction[];
  onClose: () => void;
  /// signed URL อายุ 5 นาที — ผู้เรียกดึงลิงก์ใหม่แล้วส่ง items ชุดใหม่เข้ามา
  onMediaError?: () => void;
}) {
  const owner = useProfile(ownerCoreUserId);
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(items.length - 1, 0)));
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<'menu' | PlayerAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // เปิดเมนูอยู่ = หยุดเดิน ไม่งั้นสตอรี่เลื่อนไปชิ้นถัดไประหว่างที่กำลังเลือก "ลบ"
  const paused = held || userPaused || sheet !== null;

  const closeRef = useRef(onClose);
  const errorRef = useRef(onMediaError);

  useEffect(() => {
    closeRef.current = onClose;
    errorRef.current = onMediaError;
  });

  /// Esc ปิดเมนูก่อน แล้วค่อยปิดตัวเล่น — แบบเดียวกับกล่องซ้อนกล่องทั่วไป
  const escape = useCallback(() => {
    if (sheet !== null) {
      setSheet(null);

      return;
    }

    closeRef.current();
  }, [sheet]);

  const ref = useModalFocus<HTMLDivElement>(true, escape);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const duration = useRef(IMAGE_DURATION_MS);
  const elapsed = useRef(0);

  const item = items[index];

  // รีเซ็ตระหว่าง render ตอนเปลี่ยนชิ้น (ไม่ใช่ใน effect) — ไม่งั้นเห็นแถบ
  // ของชิ้นก่อนค้างอยู่หนึ่งเฟรมแล้วกระตุกกลับเป็นศูนย์
  //
  // นับลิงก์ด้วย: ผู้เรียกดึงลิงก์ใหม่หลังลิงก์เดิมหมดอายุ ชิ้นเดิมต้องลองโหลดใหม่
  // ไม่ใช่ค้างข้อความ "โหลดไม่ขึ้น" ทั้งที่ลิงก์ใหม่มาแล้ว
  const showing = `${index}|${item?.src ?? ''}`;
  const [shown, setShown] = useState(showing);

  if (shown !== showing) {
    setShown(showing);
    setProgress(0);
    setFailed(false);
  }

  // ชุดใหม่เข้ามา (เช่นดึงลิงก์ใหม่หลังหมดอายุ) และสั้นกว่าเดิม — ไม่ให้ index หลุดขอบ
  if (items.length > 0 && index >= items.length) {
    setIndex(items.length - 1);
  }

  const next = useCallback(() => {
    if (index + 1 >= items.length) {
      closeRef.current();

      return;
    }

    setIndex(index + 1);
  }, [index, items.length]);

  const prev = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    elapsed.current = 0;
    duration.current = IMAGE_DURATION_MS;
  }, [index]);

  /// เดินด้วย requestAnimationFrame — หยุดเองเมื่อแท็บถูกซ่อน จึงไม่เลื่อนไป
  /// เองตอนผู้ใช้ไม่ได้ดู (setInterval เดินต่อในพื้นหลัง)
  useEffect(() => {
    if (paused || failed || !item) return;

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
  }, [index, paused, failed, next, item]);

  // ←/→/Space — Esc กับการกักโฟกัสอยู่ที่ useModalFocus แล้ว
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheet !== null) return;
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') prev();
      if (event.key === ' ' && event.target === ref.current) {
        event.preventDefault();
        setUserPaused((value) => !value);
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, sheet, ref]);

  // ล็อกการเลื่อนของหน้าเบื้องหลัง
  useEffect(() => {
    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [paused, index]);

  async function run(action: PlayerAction) {
    setBusy(true);
    setActionError(null);

    try {
      await action.onSelect();
      setSheet(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!item || typeof document === 'undefined') return null;

  const label = title ?? owner.displayName;

  const overlay = (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `ไฮไลต์ ${title}` : `สตอรี่ของ ${owner.displayName}`}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/95 outline-none animate-in fade-in-0 zoom-in-95"
    >
      <button
        type="button"
        onClick={() => closeRef.current()}
        aria-label="ปิด"
        className="absolute right-3 top-3 z-20 hidden size-10 place-items-center rounded-full text-white/90 hover:text-white md:grid"
      >
        <X aria-hidden strokeWidth={1.9} className="size-7" />
      </button>

      {/* เวที 9:16 แบบ Instagram บนเดสก์ท็อป · มือถือเต็มจอ */}
      <div className="relative size-full overflow-hidden bg-black md:aspect-[9/16] md:h-[calc(100dvh-48px)] md:w-auto md:rounded-lg">
        {failed ? (
          <div className="grid size-full place-items-center px-6 text-center">
            <p className="text-csmju-label leading-relaxed text-white/70">
              โหลดสื่อไม่ขึ้น — ลิงก์ของสตอรี่มีอายุจำกัด
              <br />
              กำลังขอลิงก์ใหม่ ถ้ายังไม่ขึ้นให้ปิดแล้วเปิดใหม่
            </p>
          </div>
        ) : item.kind === 'VIDEO' ? (
          <video
            key={item.id}
            ref={videoRef}
            src={item.src}
            autoPlay
            playsInline
            className="size-full object-contain"
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration;

              // วิดีโอใช้ความยาวจริง ไม่งั้นคลิป 15 วินาทีถูกตัดที่วินาทีที่ 5
              duration.current =
                Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : IMAGE_DURATION_MS;
            }}
            onError={() => {
              setFailed(true);
              errorRef.current?.();
            }}
          >
            <track kind="captions" label={label} />
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.id}
            src={item.src}
            alt={item.caption ?? label}
            className="size-full object-contain"
            onError={() => {
              setFailed(true);
              errorRef.current?.();
            }}
          />
        )}

        {/* เงาบนเพื่อให้ตัวอักษรสีขาวอ่านออกบนรูปสว่าง */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />

        {/* แตะซ้ายย้อน ขวาไปต่อ กดค้างหยุด — เป็น button เพื่อให้ใช้คีย์บอร์ดได้ */}
        <button
          type="button"
          onClick={prev}
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          aria-label="ย้อนกลับ"
          className="absolute inset-y-0 left-0 z-0 w-1/3 cursor-default"
        />
        <button
          type="button"
          onClick={next}
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          aria-label="ไปต่อ"
          className="absolute inset-y-0 right-0 z-0 w-2/3 cursor-default"
        />

        <div className="absolute inset-x-0 top-0 z-10 px-3 pt-3">
          <div className="flex gap-1" aria-hidden>
            {items.map((row, position) => (
              <div key={row.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                <div
                  className="h-full rounded-full bg-white"
                  style={{
                    width: position < index ? '100%' : position === index ? `${progress * 100}%` : '0%',
                  }}
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2.5">
            <span className="pointer-events-none">
              <Avatar coreUserId={ownerCoreUserId} size={32} showOnline={false} />
            </span>
            <p className="min-w-0 flex-1 truncate text-csmju-label text-white">
              <span className="font-semibold">{label}</span>
              <span className="ml-2 text-white/70">{igAgo(item.createdAt)}</span>
            </p>

            <button
              type="button"
              onClick={() => setUserPaused((value) => !value)}
              aria-label={userPaused ? 'เล่นต่อ' : 'หยุดชั่วคราว'}
              className="grid size-8 place-items-center rounded-full text-white hover:bg-white/10"
            >
              {userPaused ? (
                <Play aria-hidden className="size-5 fill-white" />
              ) : (
                <Pause aria-hidden className="size-5 fill-white" />
              )}
            </button>

            {actions.length > 0 && (
              <button
                type="button"
                onClick={() => setSheet('menu')}
                aria-label="ตัวเลือกเพิ่มเติม"
                aria-haspopup="menu"
                className="grid size-8 place-items-center rounded-full text-white hover:bg-white/10"
              >
                <MoreHorizontal aria-hidden className="size-6" />
              </button>
            )}

            <button
              type="button"
              onClick={() => closeRef.current()}
              aria-label="ปิด"
              className="grid size-8 place-items-center rounded-full text-white hover:bg-white/10 md:hidden"
            >
              <X aria-hidden className="size-6" />
            </button>
          </div>
        </div>

        {item.caption && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 pb-6 pt-10 text-center text-csmju-label text-white">
            {item.caption}
          </p>
        )}

        {index > 0 && (
          <ChevronLeft aria-hidden className="pointer-events-none absolute left-2 top-1/2 z-10 size-7 -translate-y-1/2 text-white/60 md:hidden" />
        )}
        {index < items.length - 1 && (
          <ChevronRight aria-hidden className="pointer-events-none absolute right-2 top-1/2 z-10 size-7 -translate-y-1/2 text-white/60 md:hidden" />
        )}

        {sheet !== null && (
          <div
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-4 md:items-center"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSheet(null);
            }}
          >
            <div
              role={sheet === 'menu' ? 'menu' : 'alertdialog'}
              aria-label={sheet === 'menu' ? 'ตัวเลือก' : sheet.confirm?.title}
              className="w-full max-w-[400px] overflow-hidden rounded-xl bg-card text-card-foreground animate-in fade-in-0 zoom-in-95"
            >
              {sheet === 'menu' ? (
                <>
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() => (action.confirm ? setSheet(action) : void run(action))}
                      className={`flex min-h-12 w-full items-center justify-center border-b border-border px-4 text-csmju-label transition-colors hover:bg-accent disabled:opacity-60 ${
                        action.tone === 'danger' ? 'font-bold text-destructive' : ''
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setSheet(null)}
                    className="flex min-h-12 w-full items-center justify-center px-4 text-csmju-label transition-colors hover:bg-accent"
                  >
                    ยกเลิก
                  </button>
                </>
              ) : (
                <>
                  <div className="px-6 pb-4 pt-7 text-center">
                    <p className="text-lg font-semibold">{sheet.confirm?.title}</p>
                    <p className="mt-1.5 text-csmju-label text-muted-foreground">{sheet.confirm?.body}</p>
                    {actionError && (
                      <p role="alert" className="mt-2 text-csmju-caption text-destructive">
                        {actionError}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(sheet)}
                    className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label font-bold text-destructive hover:bg-accent disabled:opacity-60"
                  >
                    {busy ? 'กำลังทำ…' : sheet.confirm?.confirmLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheet(null)}
                    className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label hover:bg-accent"
                  >
                    ยกเลิก
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // portal ไปที่ body ให้ overflow หรือ z-index ของเลย์เอาต์กดทับไม่ได้
  return createPortal(overlay, document.body);
}
