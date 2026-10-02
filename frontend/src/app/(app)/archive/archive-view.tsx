'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, History, Loader2 } from 'lucide-react';
import { HighlightEditor } from '@/components/csmju/profile-highlights';
import { StoryPlayer } from '@/components/csmju/story-player';
import {
  ArchiveTile,
  archiveToPlayer,
  useStoryArchive,
} from '@/components/csmju/story-archive';
import { ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';

/// /archive — คลังสตอรี่ของฉัน แบบหน้า "คลัง" ของ Instagram
///
/// รวมทุกชิ้นที่เคยลง รวมที่หมดอายุไปแล้ว (หลังบ้านไม่ลบทิ้งแล้ว) เห็นได้เฉพาะ
/// เจ้าของ · กดชิ้นไหนก็เล่นต่อจากชิ้นนั้นไปทางที่เก่ากว่า เหมือนเลื่อนดูคลัง
export function ArchiveView() {
  const me = useMe();
  const archive = useStoryArchive();
  const [playing, setPlaying] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[935px] pb-10 md:px-5">
      <header className="flex items-center gap-2 px-4 pb-4 pt-4 md:px-0 md:pb-6 md:pt-8">
        <Link
          href={`/profile/${encodeURIComponent(me.id)}`}
          aria-label="กลับไปโปรไฟล์"
          className="-ml-2 grid size-9 place-items-center rounded-full hover:bg-accent"
        >
          <ChevronLeft aria-hidden strokeWidth={1.9} className="size-6" />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">คลังสตอรี่</h1>
          <p className="text-csmju-caption text-muted-foreground">
            เห็นได้เฉพาะคุณ · สตอรี่ที่หมดอายุแล้วยังเก็บไว้ที่นี่
          </p>
        </div>

        {archive.items.length > 0 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-8 shrink-0 rounded-lg bg-muted px-3 text-csmju-label font-semibold hover:bg-accent"
          >
            ไฮไลท์ใหม่
          </button>
        )}
      </header>

      {archive.error ? (
        <p role="alert" className="px-4 py-10 text-center text-csmju-label text-destructive">
          {archive.error instanceof ApiError ? archive.error.message : 'โหลดคลังสตอรี่ไม่สำเร็จ'}
        </p>
      ) : archive.isPending ? (
        <p className="flex items-center justify-center gap-2 py-16 text-csmju-label text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          กำลังโหลด…
        </p>
      ) : archive.items.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <span className="grid size-[62px] place-items-center rounded-full border-2 border-foreground">
            <History aria-hidden strokeWidth={1.2} className="size-8" />
          </span>
          <h2 className="mt-4 text-[1.75rem] font-extrabold leading-tight">ยังไม่มีสตอรี่ในคลัง</h2>
          <p className="mt-3 max-w-sm text-csmju-label">
            สตอรี่ที่คุณลงจะถูกเก็บไว้ที่นี่หลังหมดอายุ ไว้ดูย้อนหลังหรือทำเป็นไฮไลต์ได้
          </p>
          <Link href="/feed" className="mt-4 text-csmju-label font-semibold text-link">
            ลงสตอรี่ที่หน้าหลัก
          </Link>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-0.5 md:gap-1">
            {archive.items.map((item, index) => (
              <li key={item.id}>
                <ArchiveTile item={item} onClick={() => setPlaying(index)} />
              </li>
            ))}
          </ul>

          {archive.hasNextPage && (
            <div className="flex justify-center py-6">
              <button
                type="button"
                disabled={archive.isFetchingNextPage}
                onClick={() => void archive.fetchNextPage()}
                className="rounded-lg px-3 py-1.5 text-csmju-label font-semibold text-muted-foreground hover:bg-accent disabled:opacity-60"
              >
                {archive.isFetchingNextPage ? 'กำลังโหลด…' : 'ดูเพิ่มเติม'}
              </button>
            </div>
          )}
        </>
      )}

      {playing !== null && (
        <StoryPlayer
          items={archive.items.map(archiveToPlayer)}
          ownerCoreUserId={me.id}
          startIndex={playing}
          onClose={() => setPlaying(null)}
          // ลิงก์ในคลังอายุ 5 นาที — ดึงหน้าที่โหลดไว้ใหม่ทั้งชุด
          onMediaError={() => void archive.refetch()}
        />
      )}

      {creating && (
        <HighlightEditor open initial={null} ownerCoreUserId={me.id} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
