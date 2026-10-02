'use client';

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, type Page } from '@/lib/csmju/api';
import type { StoryArchiveItem } from '@/lib/csmju/types';
import type { PlayerItem } from '@/components/csmju/story-player';

/// คลังสตอรี่ของฉัน — ใช้ทั้งหน้า /archive และตัวเลือกสตอรี่ตอนสร้างไฮไลต์
///
/// หลังบ้านไม่ลบสตอรี่ที่หมดอายุแล้ว (หายจากแถวสตอรี่ แต่ยังอยู่ในคลังและใน
/// ไฮไลต์) ทั้งสองที่จึงอ่านแหล่งเดียวกัน ใช้คีย์เดียวกันเพื่อให้เปิดตัวเลือก
/// ไฮไลต์หลังดูคลังแล้วไม่ต้องโหลดใหม่

export const ARCHIVE_KEY = ['story-archive'] as const;

/// 30 = 10 แถว × 3 คอลัมน์ — หน้าจอเดียวเห็นราวสองแถวครึ่งของไทล์ 9:16
const PAGE_SIZE = 30;

export function useStoryArchive() {
  const query = useInfiniteQuery({
    queryKey: ARCHIVE_KEY,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<StoryArchiveItem>(`/stories/archive?page=${pageParam}&limit=${PAGE_SIZE}`),
    getNextPageParam: (last: Page<StoryArchiveItem>) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });

  return { ...query, items: flattenArchive(query.data) };
}

function flattenArchive(data: InfiniteData<Page<StoryArchiveItem>> | undefined) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function archiveToPlayer(item: StoryArchiveItem): PlayerItem {
  return {
    id: item.id,
    kind: item.mediaKind,
    src: item.mediaUrl,
    caption: item.caption,
    createdAt: item.createdAt,
  };
}

/// ป้ายวันที่มุมซ้ายบนแบบคลังของ Instagram — เลขวันตัวใหญ่ เดือนตัวเล็กข้างใต้
export function DateBadge({ iso }: { iso: string }) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return null;

  const day = date.toLocaleDateString('th-TH', { day: 'numeric' });
  const month = date.toLocaleDateString('th-TH', { month: 'short' });
  // ปีต่างจากปีนี้ต้องบอกปีด้วย ไม่งั้น "30 ก.ย." ของปีที่แล้วแยกจากของปีนี้ไม่ออก
  const year =
    date.getFullYear() === new Date().getFullYear()
      ? null
      : date.toLocaleDateString('th-TH', { year: 'numeric' });

  return (
    <span
      className="absolute left-2 top-2 z-10 flex min-w-9 flex-col items-center rounded-md bg-white px-1.5 py-0.5 leading-none text-black shadow-sm"
      aria-label={`${day} ${month}${year ? ` ${year}` : ''}`}
    >
      <span aria-hidden className="text-base font-bold">{day}</span>
      <span aria-hidden className="text-[10px] font-semibold">{month}</span>
      {year && <span aria-hidden className="text-[9px]">{year}</span>}
    </span>
  );
}

/// ภาพของสื่อที่มี signed URL อยู่แล้ว (สตอรี่/ไฮไลต์) — วิดีโอใช้เฟรมที่ 0.1 วินาที
///
/// `preload="metadata"` โหลดแค่หัวไฟล์พอวาดเฟรมเดียว ตารางสามสิบช่องจึงไม่ดูด
/// ทั้งคลิปทุกไฟล์
export function MediaThumb({
  kind,
  src,
  alt,
  className = 'size-full object-cover',
}: {
  kind: 'IMAGE' | 'VIDEO' | null;
  src: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) return <span className="block size-full bg-muted" aria-hidden />;

  if (kind === 'VIDEO') {
    return (
      <video
        src={`${src}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        aria-label={alt}
        tabIndex={-1}
        className={`pointer-events-none block ${className}`}
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/// หนึ่งช่องในตารางคลัง · `selected !== undefined` = โหมดเลือก (มีวงกลมติ๊ก)
export function ArchiveTile({
  item,
  selected,
  onClick,
}: {
  item: StoryArchiveItem;
  selected?: boolean;
  onClick: () => void;
}) {
  const choosing = selected !== undefined;
  const when = new Date(item.createdAt).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={choosing ? selected : undefined}
      aria-label={`${choosing ? 'เลือก' : 'ดู'}สตอรี่วันที่ ${when}${item.isExpired ? '' : ' (ยังอยู่ในแถวสตอรี่)'}`}
      className="group relative block aspect-[9/16] w-full overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MediaThumb kind={item.mediaKind} src={item.mediaUrl} alt="" />

      <DateBadge iso={item.createdAt} />

      {!choosing && <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />}

      {choosing && (
        <>
          {selected && <span aria-hidden className="absolute inset-0 bg-white/25" />}
          <span
            aria-hidden
            className={`absolute bottom-2 right-2 grid size-6 place-items-center rounded-full border-2 ${
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-white bg-black/20'
            }`}
          >
            {selected && <Check strokeWidth={3} className="size-3.5" />}
          </span>
        </>
      )}
    </button>
  );
}
