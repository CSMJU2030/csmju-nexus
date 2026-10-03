'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { VideoView } from '@/components/csmju/call-ui';
import type { SharePreviewState } from '@/lib/csmju/call-share';
import { cn } from '@/lib/utils';

/// ภาพตัวอย่างจอที่เรากำลังแชร์ ลอยมุมขวาล่าง — แบบ Instagram
///
/// ผู้แชร์ต้องเห็นเสมอว่ากำลังส่งอะไรออกไป (กันแชร์ผิดจอแล้วแชทส่วนตัวโผล่)
/// แต่ภาพนี้ก็บังหน้าจอของเราเองด้วย จึงย่อไปชิดขอบได้ด้วยที่จับ "›"
/// แล้วดึงกลับด้วย "‹"

export function CallSharePreview({
  stream,
  state,
  onStop,
  onCollapse,
  onExpand,
}: {
  stream: MediaStream | null;
  state: SharePreviewState;
  onStop: () => void;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  if (state === 'hidden' || !stream) return null;

  const collapsed = state === 'collapsed';

  return (
    <section
      aria-label="จอที่กำลังแชร์"
      className={cn(
        'absolute bottom-24 right-0 z-20 flex items-center transition-transform duration-300 ease-csmju sm:bottom-6',
        // ย่อ = เลื่อนตัวภาพออกนอกจอ เหลือแค่ที่จับ (w-7) โผล่ไว้ที่ขอบ
        collapsed ? 'translate-x-[calc(100%-1.75rem)]' : 'translate-x-0 pr-4',
      )}
    >
      <button
        type="button"
        onClick={collapsed ? onExpand : onCollapse}
        aria-label={collapsed ? 'ขยายภาพตัวอย่างจอที่แชร์' : 'ย่อภาพตัวอย่างจอที่แชร์'}
        aria-expanded={!collapsed}
        className="grid h-14 w-7 shrink-0 place-items-center rounded-l-lg bg-neutral-800 text-white shadow-lg transition-colors hover:bg-neutral-700"
      >
        {collapsed ? (
          <ChevronLeft aria-hidden className="size-5" />
        ) : (
          <ChevronRight aria-hidden className="size-5" />
        )}
      </button>

      <div
        aria-hidden={collapsed}
        className="relative aspect-video w-[min(16rem,calc(100vw-5rem))] overflow-hidden rounded-xl bg-neutral-900 shadow-2xl ring-1 ring-white/10"
      >
        <span className="sr-only">คุณกำลังแชร์หน้าจอนี้</span>
        <VideoView stream={stream} fit="contain" label="หน้าจอที่คุณกำลังแชร์" />

        <div className="absolute inset-0 grid place-items-center bg-black/25">
          <button
            type="button"
            onClick={onStop}
            tabIndex={collapsed ? -1 : undefined}
            aria-label="หยุดแชร์หน้าจอ"
            className="rounded-full bg-black/70 px-4 py-1.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-black/85"
          >
            หยุด
          </button>
        </div>
      </div>
    </section>
  );
}
