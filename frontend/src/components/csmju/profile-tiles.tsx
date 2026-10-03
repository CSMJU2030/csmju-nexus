'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, Eye, Heart, Loader2, MessageCircle, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/csmju/api';
import { useAssetUrl } from '@/lib/csmju/asset-url';
import type { Bookmark, Post, Reel } from '@/lib/csmju/types';

/// ชิ้นส่วนของตาราง 3 คอลัมน์แบบ Instagram — ใช้ร่วมกันทั้งแท็บบนโปรไฟล์
/// หน้าที่บันทึกไว้ และหน้ากิจกรรมของคุณ
///
/// แยกออกมาจาก profile-grid.tsx เพราะหน้าที่บันทึกไว้ต้องใช้ช่องเดียวกัน และ
/// แท็บบนโปรไฟล์ก็ต้องใช้คอลเลกชันของหน้าที่บันทึกไว้ — อยู่ไฟล์เดียวกันจะ
/// import วนกันเอง

/// ─── ช่องในตาราง ────────────────────────────────────────────────

export const TILE =
  'group relative block aspect-[4/5] w-full overflow-hidden bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring';

/// แผ่นทึบตอนชี้ — ตัวเลขจริงของชิ้นนั้น แบบที่ Instagram โชว์ถูกใจ/ความคิดเห็น
export function HoverStats({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 hidden items-center justify-center gap-6 bg-black/40 text-base font-bold text-white group-hover:flex group-focus-visible:flex"
    >
      {children}
    </span>
  );
}

export function Stat({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <span className="flex items-center gap-1.5 [&_svg]:size-5 [&_svg]:fill-white">
      {icon}
      {value.toLocaleString('th-TH')}
    </span>
  );
}

export function ReelTile({ reel }: { reel: Reel }) {
  return (
    <Link
      href={`/reels?reel=${encodeURIComponent(reel.id)}`}
      className={TILE}
      aria-label={`คลิป ${reel.title} · ถูกใจ ${reel.likeCount} · ดู ${reel.viewCount} ครั้ง`}
    >
      <ReelThumb assetId={reel.assetId} />

      <Clapperboard
        aria-hidden
        strokeWidth={1.9}
        className="absolute right-2 top-2 size-5 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
      />

      <HoverStats>
        <Stat icon={<Heart />} value={reel.likeCount} />
        <Stat icon={<Eye className="!fill-none" />} value={reel.viewCount} />
      </HoverStats>
    </Link>
  );
}

/// เฟรมแรกของคลิปเป็นรูปปก — หลังบ้านไม่ได้ทำภาพย่อไว้ให้
///
/// `#t=0.1` บอกเบราว์เซอร์ให้วาดเฟรมที่ 0.1 วินาที เพราะเฟรมที่ 0 ของคลิปจาก
/// มือถือมักเป็นสีดำ · `preload="metadata"` โหลดแค่หัวไฟล์พอให้วาดเฟรมนั้น
/// ไม่ใช่ทั้งคลิป — ตาราง 24 ช่องจะไม่ดูดเน็ตเป็นร้อยเมกะไบต์
export function ReelThumb({ assetId }: { assetId: string }) {
  const { url, error } = useAssetUrl(assetId);

  if (error) {
    return (
      <span className="grid size-full place-items-center p-2 text-center text-csmju-caption text-muted-foreground">
        เปิดคลิปไม่ได้
      </span>
    );
  }

  if (!url) return <span className="block size-full animate-pulse bg-muted" />;

  // ไอคอนรองอยู่ข้างหลัง — ไฟล์ที่เบราว์เซอร์ถอดเฟรมไม่ได้ (เช่น .mov แบบ HEVC
  // บน Chrome) จะไม่ยิง error แต่ก็ไม่วาดอะไร ช่องจะว่างเปล่าถ้าไม่มีตัวนี้
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 grid place-items-center text-muted-foreground group-hover:opacity-0 group-focus-visible:opacity-0"
      >
        <Clapperboard strokeWidth={1.2} className="size-10" />
      </span>
      <video
        src={`${url}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none relative block size-full object-cover"
      />
    </>
  );
}

export function PostTile({ post }: { post: Post }) {
  return (
    <Link
      href="/feed"
      className={TILE}
      aria-label={`กระทู้ ${post.title} · ${post.commentCount} ความคิดเห็น`}
    >
      <TextTileBody title={post.title} body={post.content} tag={post.courseTag} />

      <HoverStats>
        <Stat icon={<Heart />} value={post.reactions?.totalCount ?? 0} />
        <Stat icon={<MessageCircle />} value={post.commentCount} />
      </HoverStats>
    </Link>
  );
}

/// หน้าตาช่องกระทู้ — พื้นยกไล่เฉดอ่อน ๆ ไม่ใช่สีสด เพื่อไม่ให้ข้อความแย่ง
/// ความสนใจจากเฟรมคลิปในตารางเดียวกัน
///
/// จัดข้อความไว้กลางช่องแบบโพสต์ข้อความของ Instagram/Threads ไม่ใช่ชิดบน —
/// ชิดบนแล้วช่อง 4:5 เหลือที่ว่างครึ่งล่าง ดูเหมือนโหลดรูปไม่ขึ้น
export function TextTileBody({
  title,
  body,
  tag,
}: {
  title: string;
  body?: string | null;
  tag: string | null;
}) {
  return (
    <span className="flex size-full flex-col bg-gradient-to-br from-card via-card to-muted p-3 md:p-6">
      <span className="flex min-h-0 flex-1 flex-col justify-center gap-2">
        <span className="line-clamp-4 whitespace-pre-wrap break-words text-csmju-label font-semibold leading-snug text-foreground md:text-lg md:leading-snug">
          {title}
        </span>

        {body && (
          <span className="hidden whitespace-pre-wrap break-words text-csmju-label leading-relaxed text-muted-foreground md:line-clamp-4">
            {body}
          </span>
        )}
      </span>

      {tag && (
        <span className="w-fit max-w-full shrink-0 truncate rounded-md bg-background/60 px-1.5 py-0.5 font-mono text-csmju-caption text-muted-foreground">
          #{tag}
        </span>
      )}
    </span>
  );
}

/// ของที่ถูกลบไปแล้ว — หลังบ้านคืน title = null แทนการตัดทิ้งเงียบ ๆ
export function DeletedTile({ kind }: { kind: 'POST' | 'REEL' }) {
  return (
    <Link href="/saved" className={TILE} aria-label="รายการที่ถูกลบไปแล้ว — ไปจัดการที่หน้าที่บันทึกไว้">
      <span className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-csmju-caption text-muted-foreground">
        <Trash2 aria-hidden strokeWidth={1.9} className="size-5" />
        {kind === 'REEL' ? 'คลิปนี้ถูกลบแล้ว' : 'กระทู้นี้ถูกลบแล้ว'}
      </span>
    </Link>
  );
}

export function SavedPostTile({ bookmark }: { bookmark: Bookmark }) {
  if (bookmark.title === null) return <DeletedTile kind="POST" />;

  return (
    <Link href="/feed" className={TILE} aria-label={`กระทู้ที่บันทึกไว้ ${bookmark.title}`}>
      <TextTileBody title={bookmark.title} tag={null} />
    </Link>
  );
}

/// ที่คั่นหน้าไม่มี assetId ของคลิป จึงต้องถามตัวคลิปอีกครั้งเพื่อได้เฟรมปก
/// และตัวเลขถูกใจ/ยอดดูจริง
export function SavedReelTile({ bookmark }: { bookmark: Bookmark }) {
  const { data: reel, error } = useQuery({
    queryKey: ['reel', bookmark.targetId],
    enabled: bookmark.title !== null,
    queryFn: () => api.get<Reel>(`/reels/${encodeURIComponent(bookmark.targetId)}`),
  });

  if (bookmark.title === null || (error instanceof ApiError && error.status === 404)) {
    return <DeletedTile kind="REEL" />;
  }

  if (reel) return <ReelTile reel={reel} />;

  return <span className={`${TILE} animate-pulse bg-muted`} />;
}

/// ─── สถานะของตาราง ──────────────────────────────────────────────

/// เลื่อนถึงก้นตารางแล้วโหลดต่อเอง แบบ Instagram · ปุ่มยังอยู่สำหรับคนที่ใช้
/// คีย์บอร์ด และสำหรับเบราว์เซอร์ที่ไม่มี IntersectionObserver
export function LoadMore({
  more,
  fetching,
  onLoad,
}: {
  more: boolean;
  fetching: boolean;
  onLoad: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const load = useRef(onLoad);

  useEffect(() => {
    load.current = onLoad;
  });

  useEffect(() => {
    const node = ref.current;

    if (!more || !node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load.current();
    }, { rootMargin: '400px' });

    observer.observe(node);

    return () => observer.disconnect();
  }, [more]);

  if (!more) return null;

  return (
    <div ref={ref} className="flex justify-center py-6">
      <button
        type="button"
        onClick={onLoad}
        disabled={fetching}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-csmju-label font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
      >
        {fetching && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {fetching ? 'กำลังโหลด…' : 'ดูเพิ่มเติม'}
      </button>
    </div>
  );
}

export function GridLoading() {
  return (
    <ul aria-label="กำลังโหลด" className="grid grid-cols-3 gap-1">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="aspect-[4/5] animate-pulse bg-muted" />
      ))}
    </ul>
  );
}

export function GridError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="py-10 text-center text-csmju-label text-destructive">
      {error instanceof ApiError ? error.message : 'โหลดผลงานไม่สำเร็จ'}
    </p>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center md:py-16">
      <span className="grid size-[62px] place-items-center rounded-full border-2 border-foreground text-foreground">
        {icon}
      </span>

      <h2 className="mt-4 text-[1.75rem] font-extrabold leading-tight md:text-[1.875rem]">{title}</h2>
      <p className="mt-3 max-w-sm text-csmju-label text-foreground/90">{body}</p>

      {action && (
        <Link
          href={action.href}
          className="mt-4 text-csmju-label font-semibold text-link hover:text-foreground"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
