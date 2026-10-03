'use client';

import * as React from 'react';
import { useModalFocus } from './use-modal-focus';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProfile } from '@/components/csmju/user-name';

/// สตอรี่หนึ่งชิ้น — รูปหรือวิดีโอ
export interface Story {
  id: string;
  type: 'image' | 'video';
  src: string;
}

/// เวลาที่ค้างต่อรูปหนึ่งใบ · วิดีโอใช้ความยาวจริงของไฟล์
///
/// ห้าวินาทีคือค่าที่ Instagram ใช้ และเป็นจุดที่อ่านข้อความบนรูปทันโดยไม่น่าเบื่อ
const IMAGE_DURATION_MS = 5000;

interface StoryViewerProps {
  stories: Story[];
  coreUserId: string;
  avatar?: string;
  timestamp?: string;
  /// วงแหวนรอบรูปโปรไฟล์ติดสีเมื่อยังมีของไม่ได้ดู
  hasUnseen?: boolean;
  /// ป้ายใต้รูป — ใส่ "สตอรี่ของคุณ" ได้สำหรับของตัวเอง
  label?: string;
  onStoryView?: (story: Story, index: number) => void;
  onAllStoriesViewed?: () => void;
  /// เรียกเมื่อรูปหรือวิดีโอโหลดไม่ขึ้น — ใช้ขอ URL ใหม่เมื่อ signed URL หมดอายุ
  onMediaError?: (story: Story) => void;
  className?: string;
}

/// สตอรี่แบบ Instagram — รูปโปรไฟล์ที่กดแล้วเปิดเต็มหน้าจอ
///
/// component เดียวทำสองอย่างเหมือนของ Instagram: เป็นทั้งปุ่มในแถวด้านบนฟีด
/// และตัวเล่นเต็มหน้าจอ เพราะสองอย่างนี้แชร์สถานะกัน (ดูถึงชิ้นไหนแล้ว)
/// ถ้าแยกเป็นสอง component ต้องยกสถานะขึ้นไปไว้ที่ parent ทุกครั้งที่ใช้
export function StoryViewer({
  stories,
  coreUserId,
  avatar,
  timestamp,
  hasUnseen = true,
  label,
  onStoryView,
  onAllStoriesViewed,
  onMediaError,
  className,
}: StoryViewerProps) {
  const [open, setOpen] = React.useState(false);
  // coreUserId เป็น UUID — ห้ามขึ้นจอ ใช้ชื่อที่แสดงแทนทุกที่
  const name = useProfile(coreUserId).displayName;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={stories.length === 0}
        className={cn(
          'group flex shrink-0 cursor-pointer flex-col items-center gap-2 disabled:cursor-default disabled:opacity-60',
          className,
        )}
        aria-label={`ดูสตอรี่ของ ${name}`}
      >
        <span
          className={cn(
            'grid size-[72px] place-items-center rounded-full p-[3px] transition-transform group-hover:scale-105',
            // วงแหวนไล่สีเมื่อยังไม่ดู · เทาเมื่อดูครบแล้ว (เหมือน Instagram)
            hasUnseen
              ? 'bg-[conic-gradient(from_180deg,var(--csmju-primary),var(--csmju-story-ring-1),var(--csmju-story-ring-2),var(--csmju-story-ring-3),var(--csmju-primary))]'
              : 'bg-border',
          )}
        >
          <span className="grid size-full place-items-center overflow-hidden rounded-full bg-background p-[2px]">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                className="size-full rounded-full object-cover"
              />
            ) : (
              <span className="grid size-full place-items-center rounded-full bg-secondary text-lg font-semibold text-secondary-foreground">
                {name.trim().charAt(0).toUpperCase() || '?'}
              </span>
            )}
          </span>
        </span>

        <span className="max-w-[80px] truncate text-xs text-muted-foreground">
          {label ?? name}
        </span>
      </button>

      {open && (
        <StoryOverlay
          stories={stories}
          coreUserId={coreUserId}
          avatar={avatar}
          timestamp={timestamp}
          onClose={() => setOpen(false)}
          onStoryView={onStoryView}
          onAllStoriesViewed={onAllStoriesViewed}
          onMediaError={onMediaError}
        />
      )}
    </>
  );
}

function StoryOverlay({
  stories,
  coreUserId,
  avatar,
  timestamp,
  onClose,
  onStoryView,
  onAllStoriesViewed,
  onMediaError,
}: {
  stories: Story[];
  coreUserId: string;
  avatar?: string;
  timestamp?: string;
  onClose: () => void;
  onStoryView?: (story: Story, index: number) => void;
  onAllStoriesViewed?: () => void;
  onMediaError?: (story: Story) => void;
}) {
  const name = useProfile(coreUserId).displayName;
  const [index, setIndex] = React.useState(0);
  const [progress, setProgress] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  /// ประกาศ aria-modal แล้วต้องทำตามที่ประกาศ
  ///
  /// Escape มีคนดูแลอยู่แล้วในเอฟเฟกต์ปุ่มลัดข้างล่าง จึงไม่ส่ง onClose ซ้ำ
  /// ตรงนี้ — ที่ขาดไปคือการย้ายโฟกัสเข้ามา กัน Tab ไม่ให้เดินออกไปหลังฉาก
  /// และคืนโฟกัสให้ปุ่มเดิมตอนปิด
  const overlayRef = useModalFocus<HTMLDivElement>(true);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const durationRef = React.useRef(IMAGE_DURATION_MS);
  const startedAt = React.useRef(0);
  const elapsed = React.useRef(0);

  const story = stories[index];

  /// รีเซ็ตแถบความคืบหน้าตอน render ไม่ใช่ตอนเอฟเฟกต์
  ///
  /// ทำในเอฟเฟกต์ = วาดหนึ่งรอบด้วยค่าความคืบหน้าของชิ้นก่อนหน้า แล้วค่อย
  /// วาดซ้ำเพื่อรีเซ็ต ผู้ใช้เห็นเป็นแถบกระตุกย้อนกลับตอนกดไปชิ้นถัดไป
  /// นี่คือรูปแบบ "ปรับ state ระหว่าง render" ที่ React แนะนำสำหรับการ
  /// รีเซ็ตค่าเมื่อ input เปลี่ยน
  const [lastIndex, setLastIndex] = React.useState(index);

  if (index !== lastIndex) {
    setLastIndex(index);
    setProgress(0);
    setFailed(false);
  }

  /// callback จากภายนอกเก็บใน ref
  ///
  /// ผู้เรียกส่ง arrow function ใหม่ทุก render (เช่น
  /// `onStoryView={(s) => markViewed(s.id)}`) ถ้าใส่ไว้ใน dependency ของ
  /// effect ตรง ๆ effect จะทำงานใหม่ทุกครั้งที่ component แม่ render —
  /// อาการคือยิงบันทึกการดูซ้ำ ๆ ทั้งที่ผู้ใช้ยังดูสตอรี่ชิ้นเดิมอยู่
  const callbacks = React.useRef({
    onStoryView,
    onAllStoriesViewed,
    onClose,
    onMediaError,
  });

  React.useEffect(() => {
    callbacks.current = {
      onStoryView,
      onAllStoriesViewed,
      onClose,
      onMediaError,
    };
  });

  /// ไปชิ้นถัดไป — ถ้าหมดแล้วให้ปิด
  ///
  /// **ห้ามเรียก onClose() ข้างใน updater ของ setIndex**
  /// updater เป็นฟังก์ชันบริสุทธิ์ที่ React เรียกระหว่าง render การสั่ง
  /// setState ของ component แม่จากตรงนั้นทำให้ React โยน
  /// "Cannot update a component while rendering a different component"
  /// และใน StrictMode ที่ updater ถูกเรียกสองครั้ง ผลข้างเคียงก็เกิดสองรอบ
  ///
  /// อ่านค่า index จาก state ตรง ๆ แล้วตัดสินใจนอก updater แทน
  const next = React.useCallback(() => {
    if (index + 1 >= stories.length) {
      callbacks.current.onAllStoriesViewed?.();
      callbacks.current.onClose();

      return;
    }

    setIndex(index + 1);
  }, [index, stories.length]);

  const prev = React.useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  // รีเซ็ตตัวจับเวลาทุกครั้งที่เปลี่ยนชิ้น แล้วรายงานว่าดูชิ้นนี้แล้ว
  //
  // dependency มีแค่ index — ไม่ใส่ onStoryView เพราะมันเป็น arrow function
  // ใหม่ทุก render ของ component แม่ ซึ่งจะทำให้ effect นี้ทำงานซ้ำและยิง
  // บันทึกการดูรัว ๆ ทั้งที่ผู้ใช้ยังดูชิ้นเดิม
  React.useEffect(() => {
    elapsed.current = 0;
    startedAt.current = performance.now();
    durationRef.current = IMAGE_DURATION_MS;

    const current = stories[index];

    if (current) {
      callbacks.current.onStoryView?.(current, index);
    }
  }, [index, stories]);

  /// เดินความคืบหน้าด้วย requestAnimationFrame ไม่ใช่ setInterval
  ///
  /// เหตุผล: setInterval เดินต่อตอนแท็บอยู่พื้นหลัง (แต่ถูกลดความถี่)
  /// ทำให้สตอรี่เลื่อนไปเองตอนผู้ใช้ไม่ได้ดู แล้วกลับมาเจอว่าดูจบไปแล้ว
  /// rAF หยุดเองเมื่อแท็บถูกซ่อน ซึ่งเป็นพฤติกรรมที่ถูกต้อง
  React.useEffect(() => {
    if (paused || failed) {
      return;
    }

    let frame = 0;

    startedAt.current = performance.now() - elapsed.current;

    const tick = () => {
      const spent = performance.now() - startedAt.current;

      elapsed.current = spent;

      const ratio = Math.min(1, spent / durationRef.current);

      setProgress(ratio);

      if (ratio >= 1) {
        next();

        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [index, paused, failed, next]);

  // ปุ่มลูกศรและ Escape — สตอรี่ที่เดินด้วยเมาส์อย่างเดียวใช้บนเดสก์ท็อปไม่สะดวก
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') callbacks.current.onClose();
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') prev();
      if (event.key === ' ') {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  // ล็อกการเลื่อนของหน้าเบื้องหลังตอนเปิดเต็มจอ
  React.useEffect(() => {
    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  React.useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    if (paused) {
      video.pause();
    } else {
      void video.play().catch(() => undefined);
    }
  }, [paused, index]);

  if (!story || typeof document === 'undefined') {
    return null;
  }

  const overlay = (
    <div
      ref={overlayRef}
      // ให้กล่องเองรับโฟกัสได้ เผื่อกรณีที่ยังไม่มีปุ่มให้โฟกัส
      tabIndex={-1}
      className="fixed inset-0 z-100 flex flex-col bg-black/95 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={`สตอรี่ของ ${name}`}
    >
      {/* แถบความคืบหน้าหนึ่งขีดต่อหนึ่งชิ้น */}
      <div className="flex gap-1 px-3 pt-3">
        {stories.map((item, position) => (
          <div
            key={item.id}
            className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30"
          >
            <div
              className="h-full rounded-full bg-white"
              style={{
                width:
                  position < index
                    ? '100%'
                    : position === index
                      ? `${progress * 100}%`
                      : '0%',
              }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/20">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-white">
              {name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {name}
          </span>
          {timestamp && (
            <span className="block text-[11px] text-white/60">
              {formatAgo(timestamp)}
            </span>
          )}
        </span>

        {paused && (
          <Pause className="size-4 shrink-0 text-white/70" aria-label="หยุดชั่วคราว" />
        )}

        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="ปิด"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {failed ? (
          <div className="grid size-full place-items-center px-6 text-center">
            <p className="text-sm leading-relaxed text-white/70">
              โหลดสื่อไม่ขึ้น — ลิงก์ของสตอรี่มีอายุจำกัด
              <br />
              ปิดแล้วเปิดใหม่เพื่อขอลิงก์ใหม่
            </p>
          </div>
        ) : story.type === 'video' ? (
          <video
            ref={videoRef}
            src={story.src}
            autoPlay
            playsInline
            className="size-full object-contain"
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration;

              // วิดีโอใช้ความยาวจริง ไม่ใช่ 5 วินาทีคงที่ ไม่งั้นคลิป 15 วินาที
              // จะถูกตัดกลางเรื่อง
              durationRef.current =
                Number.isFinite(seconds) && seconds > 0
                  ? seconds * 1000
                  : IMAGE_DURATION_MS;
            }}
            onError={() => {
              setFailed(true);
              callbacks.current.onMediaError?.(story);
            }}
          >
            <track kind="captions" label={`สตอรี่ของ ${name}`} />
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.src}
            alt={`สตอรี่ของ ${name}`}
            className="size-full object-contain"
            onError={() => {
              setFailed(true);
              callbacks.current.onMediaError?.(story);
            }}
          />
        )}

        {/* พื้นที่กดสองข้าง — ซ้ายย้อนกลับ ขวาไปต่อ · กดค้างเพื่อหยุด
            ทำเป็น button เพื่อให้ใช้แป้นพิมพ์ได้ ไม่ใช่ div ที่มี onClick */}
        <button
          type="button"
          onClick={prev}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          className="absolute inset-y-0 left-0 w-1/3 cursor-default"
          aria-label="ย้อนกลับ"
        />

        <button
          type="button"
          onClick={next}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          className="absolute inset-y-0 right-0 w-2/3 cursor-default"
          aria-label="ไปต่อ"
        />

        {index > 0 && (
          <ChevronLeft className="pointer-events-none absolute left-2 top-1/2 size-7 -translate-y-1/2 text-white/50" />
        )}

        {index < stories.length - 1 && (
          <ChevronRight className="pointer-events-none absolute right-2 top-1/2 size-7 -translate-y-1/2 text-white/50" />
        )}
      </div>
    </div>
  );

  // portal ไปที่ body เพื่อไม่ให้ overflow หรือ z-index ของ layout กดทับ
  return createPortal(overlay, document.body);
}

function formatAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'เมื่อครู่';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาที`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชั่วโมง`;

  return `${Math.floor(seconds / 86400)} วัน`;
}
