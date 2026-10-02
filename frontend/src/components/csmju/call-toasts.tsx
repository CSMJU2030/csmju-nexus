'use client';

import { Mic, Video, Volume2 } from 'lucide-react';
import type { DeviceKind } from '@/lib/csmju/call-devices';
import { cn } from '@/lib/utils';

/// แจ้งเตือนเรื่องอุปกรณ์มุมขวาบน — "เชื่อมต่อไมโครโฟนแล้ว: …"
///
/// ตัวจัดการเวลา (โผล่ → จาง → หาย) อยู่ใน provider เพราะแจ้งเตือนเกิดได้
/// ทั้งตอนอยู่ห้องรอและในสาย ส่วนตัวนี้แค่วาดตามสถานะที่ได้มา

export interface CallToast {
  id: number;
  kind: DeviceKind;
  text: string;
  /// กำลังจางหาย — ยังอยู่ใน DOM อีกครู่ให้แอนิเมชันเล่นจบ
  leaving: boolean;
}

const ICON = {
  audioinput: Mic,
  audiooutput: Volume2,
  videoinput: Video,
} as const;

export function CallToasts({ toasts }: { toasts: readonly CallToast[] }) {
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-4 top-20 z-20 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-end gap-2"
    >
      {toasts.map((toast) => {
        const Icon = ICON[toast.kind];

        return (
          <p
            key={toast.id}
            className={cn(
              'flex max-w-full items-center gap-2.5 rounded-xl bg-neutral-800/95 px-3.5 py-2.5 text-sm text-white shadow-lg duration-300',
              toast.leaving
                ? 'animate-out fade-out-0 fill-mode-forwards'
                : 'animate-in fade-in-0 slide-in-from-top-2',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{toast.text}</span>
          </p>
        );
      })}
    </div>
  );
}
