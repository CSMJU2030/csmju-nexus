'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Volume2, VolumeX } from 'lucide-react';
import { useSignedVideoUrl } from '@/components/csmju/reel-media';
import type { Post, PostMedia } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

export type { PostMedia } from '@/lib/csmju/types';

/// โพสต์ที่หน้าฟีดใช้ — ชนิดเดียวกับ Post (media/canComment มาจากหลังบ้านเสมอ)
export type PostView = Post;

/// ภาพหมุนแบบ Instagram — ‹ › บนภาพ จุดบอกตำแหน่งใต้ภาพ ปัดนิ้วได้ (scroll-snap)
///
/// ใช้ scroll-snap แทนการคำนวณ transform เอง: ปัดบนมือถือ/ทัชแพดได้ฟรีและลื่น
/// ปุ่ม ‹ › แค่สั่ง scrollTo ไปช่องถัดไป ตำแหน่งปัจจุบันอ่านจาก scrollLeft
export function MediaCarousel({
  media,
  className,
  fit = 'cover',
}: {
  media: PostMedia[];
  className?: string;
  /// cover = การ์ดฟีด (สี่เหลี่ยมจัตุรัสเต็มกรอบ) · contain = หน้าโพสต์ (เห็นทั้งภาพ)
  fit?: 'cover' | 'contain';
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);

  function go(next: number) {
    const element = track.current;

    if (!element) return;

    const target = Math.max(0, Math.min(media.length - 1, next));

    element.scrollTo({ left: target * element.clientWidth, behavior: 'smooth' });
  }

  if (media.length === 0) return null;

  return (
    <div className={cn('group relative overflow-hidden bg-black', className)}>
      <div
        ref={track}
        onScroll={(event) => {
          const element = event.currentTarget;

          setIndex(Math.round(element.scrollLeft / Math.max(1, element.clientWidth)));
        }}
        className="flex size-full snap-x snap-mandatory overflow-x-auto scrollbar-none"
      >
        {media.map((item, position) => (
          <div key={item.assetId} className="relative size-full shrink-0 snap-center">
            <MediaItem
              item={item}
              active={position === index}
              fit={fit}
              muted={muted}
              label={`สื่อชิ้นที่ ${position + 1} จาก ${media.length}`}
            />
          </div>
        ))}
      </div>

      {media[index]?.kind === 'VIDEO' && (
        <button
          type="button"
          onClick={() => setMuted((value) => !value)}
          aria-label={muted ? 'เปิดเสียง' : 'ปิดเสียง'}
          aria-pressed={!muted}
          className="absolute bottom-3 right-3 grid size-7 place-items-center rounded-full bg-black/60 text-white"
        >
          {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        </button>
      )}

      {media.length > 1 && (
        <>
          {index > 0 && (
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="สื่อก่อนหน้า"
              className="absolute left-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-black shadow transition-opacity hover:bg-white"
            >
              <ChevronLeft className="size-4" strokeWidth={2.4} />
            </button>
          )}
          {index < media.length - 1 && (
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="สื่อถัดไป"
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-black shadow transition-opacity hover:bg-white"
            >
              <ChevronRight className="size-4" strokeWidth={2.4} />
            </button>
          )}
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-csmju-caption font-semibold text-white">
            {index + 1}/{media.length}
          </span>
          <CarouselDots count={media.length} index={index} className="absolute inset-x-0 bottom-3" />
        </>
      )}
    </div>
  );
}

export function CarouselDots({
  count,
  index,
  className,
}: {
  count: number;
  index: number;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn('flex justify-center gap-1', className)}>
      {Array.from({ length: count }, (_, dot) => (
        <span
          key={dot}
          className={cn(
            'size-1.5 rounded-full transition-colors',
            dot === index ? 'bg-link' : 'bg-white/60',
          )}
        />
      ))}
    </span>
  );
}

/// หนึ่งชิ้น — วิดีโอเล่นเองแบบเงียบเมื่ออยู่ในจอ (เกินครึ่ง) และเป็นชิ้นที่เห็น
function MediaItem({
  item,
  active,
  fit,
  muted,
  label,
}: {
  item: PostMedia;
  active: boolean;
  fit: 'cover' | 'contain';
  muted: boolean;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /// โหลดไม่ขึ้นกี่ครั้ง — ครั้งแรกขอลิงก์ใหม่ · ลิงก์ใหม่ยังไม่ขึ้น = ไฟล์เสีย ไม่ขอวน
  const [failures, setFailures] = useState(0);
  const failed = failures > 0;
  const [visible, setVisible] = useState(false);
  // ลิงก์ในโพสต์หมดอายุ → ขอลิงก์ใหม่ของชิ้นนี้ครั้งเดียว
  const fresh = useSignedVideoUrl(item.assetId, failed);
  const src = failed ? fresh.url : item.url;
  const broken =
    failures > 1 || (failed && (fresh.error !== null || (fresh.url !== null && fresh.url === item.url)));

  useEffect(() => {
    const element = videoRef.current;

    if (!element || item.kind !== 'VIDEO' || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.5 },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [item.kind]);

  useEffect(() => {
    const element = videoRef.current;

    if (!element) return;

    element.muted = muted;

    if (visible && active) {
      element.play().catch(() => {
        // เบราว์เซอร์ไม่ยอมเล่นเอง — ผู้ใช้กดเล่นเองได้จาก controls
      });
    } else {
      element.pause();
    }
  }, [visible, active, muted, src]);

  const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain';

  if (broken || !src) {
    return (
      <div role="img" aria-label={`${label} — โหลดไม่ขึ้น`} className="grid size-full place-items-center bg-muted text-muted-foreground">
        {broken ? <ImageOff className="size-8" aria-hidden /> : null}
      </div>
    );
  }

  if (item.kind === 'VIDEO') {
    return (
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={label}
        onError={() => setFailures((count) => count + 1)}
        className={cn('size-full', fitClass)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL จาก storage อายุสั้น ผ่าน next/image ไม่ได้
    <img
      src={src}
      alt={label}
      loading="lazy"
      draggable={false}
      onError={() => setFailures((count) => count + 1)}
      className={cn('size-full select-none', fitClass)}
    />
  );
}
