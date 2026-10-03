'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, Eye, Heart, MessageCircle } from 'lucide-react';
import {
  compactCount,
  scrollParent,
  useNearViewport,
  useSignedVideoUrl,
} from '@/components/csmju/reel-media';
import { api } from '@/lib/csmju/api';
import type { Reel } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// กริดสำรวจแบบ Instagram Explore — ช่องแนวตั้งชิดกัน เห็นเฟรมแรกของคลิปจริง
///
/// ไม่มีรูปปกของคลิปในระบบ (หลังบ้านไม่ได้ทำ thumbnail) จึงใช้ `<video
/// preload="metadata">` กับ `#t=0.1` ให้เบราว์เซอร์วาดเฟรมแรกแทน — โหลดแค่
/// ส่วนหัวของไฟล์ ไม่ใช่ทั้งคลิป และขอลิงก์เฉพาะช่องที่ใกล้จอ

export function ExploreGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn('grid grid-cols-3 gap-1 lg:grid-cols-4', className)}>{children}</ul>
  );
}

export function ExploreTile({
  reel,
  onOpen,
}: {
  reel: Reel;
  /// กดเปิดช่องนี้ — หน้าค้นหาใช้บันทึก "ค้นหาล่าสุด"
  onOpen?: () => void;
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const near = useNearViewport(ref);
  const { url, refresh } = useSignedVideoUrl(reel.assetId, near);
  const [shown, setShown] = useState(false);
  const [broken, setBroken] = useState(false);
  /// ขอลิงก์ใหม่ไปแล้วหรือยังตั้งแต่เปิดได้ครั้งล่าสุด — กันขอวนไม่รู้จบกับไฟล์เสีย
  const retried = useRef(false);

  return (
    <li>
      <Link
        ref={ref}
        href={`/reels?reel=${encodeURIComponent(reel.id)}`}
        aria-label={`คลิป ${reel.title}`}
        onClick={onOpen}
        className="group relative block aspect-9/16 overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {url && (
          <video
            src={`${url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            aria-hidden
            tabIndex={-1}
            onLoadedMetadata={() => {
              retried.current = false;
              setShown(true);
            }}
            onError={() => {
              // ลิงก์หมดอายุก่อนเฟรมแรกมา — ขอใหม่รอบเดียว ไม่วน
              // ขอใหม่แล้วยังเปิดไม่ได้ = ไฟล์เสีย/ถอดรหัสไม่ได้ → แสดงชื่อคลิปแทน
              if (retried.current) {
                setBroken(true);

                return;
              }
              retried.current = true;
              void refresh().then((fresh) => {
                if (!fresh || fresh === url) setBroken(true);
              });
            }}
            className={cn(
              'pointer-events-none size-full object-cover transition-opacity duration-300',
              shown ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}

        {broken && (
          <span className="absolute inset-x-0 bottom-0 line-clamp-2 p-2 text-csmju-caption text-muted-foreground">
            {reel.title}
          </span>
        )}

        <Clapperboard
          aria-hidden
          className="absolute right-2 top-2 size-5 text-white drop-shadow-md"
          strokeWidth={2}
        />

        <span
          aria-hidden
          className="absolute inset-0 hidden flex-wrap content-center items-center justify-center gap-x-5 gap-y-1 bg-black/40 text-csmju-label font-bold text-white group-hover:flex group-focus-visible:flex"
        >
          <Stat icon={<Heart className="size-5 fill-current" />} value={reel.likeCount} />
          <Stat
            icon={<MessageCircle className="size-5 -scale-x-100 fill-current" />}
            value={reel.commentCount}
          />
          <Stat icon={<Eye className="size-5" strokeWidth={2.2} />} value={reel.viewCount} />
        </span>
      </Link>
    </li>
  );
}

function Stat({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      {icon}
      {compactCount(value)}
    </span>
  );
}

/// ช่องคลิปจากผลค้นหา — ผลค้นหาไม่มี assetId จึงต้องถามตัวคลิปก่อน
///
/// ใช้คีย์ `['reel', id]` เดียวกับหน้าโปรไฟล์และหน้าดูคลิป — กดเข้าไปดูแล้ว
/// ไม่ต้องขอข้อมูลคลิปซ้ำ
export function ExploreTileById({
  reelId,
  onOpen,
}: {
  reelId: string;
  onOpen?: () => void;
}) {
  const { data: reel, isError } = useQuery({
    queryKey: ['reel', reelId],
    queryFn: () => api.get<Reel>(`/reels/${encodeURIComponent(reelId)}`),
    retry: false,
  });

  if (isError) return null;

  if (!reel) {
    return (
      <li>
        <span className="block aspect-9/16 animate-pulse bg-muted" />
      </li>
    );
  }

  return <ExploreTile reel={reel} onOpen={onOpen} />;
}

/// จุดท้ายกริด — เลื่อนถึงแล้วโหลดหน้าถัดไป (ไม่มีปุ่ม "โหลดเพิ่ม" แบบ IG)
export function LoadMoreSentinel({
  onVisible,
  disabled,
}: {
  onVisible: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element || disabled || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { root: scrollParent(element), rootMargin: '600px' },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [onVisible, disabled]);

  return <div ref={ref} aria-hidden className="h-px" />;
}
