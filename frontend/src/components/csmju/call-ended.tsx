'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Star, X } from 'lucide-react';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { CallAvatar, CallBackdrop, CallTitle } from '@/components/csmju/call-ui';
import {
  feedbackBody,
  sendCallFeedback,
  shouldAskRating,
  type CallKind,
} from '@/lib/csmju/call-feedback';
import { cn } from '@/lib/utils';

/// หน้าจอหลังวางสาย แล้วตามด้วยคำถามเรื่องคุณภาพสาย — แบบ Instagram
///
/// สายที่ไม่เคยต่อติด หรือคุยกันไม่ถึง 5 วินาที ไม่ถามคะแนน (ดู
/// `lib/csmju/call-feedback.ts`) แค่แสดงว่าจบสายแล้วปิดเอง

export interface EndedCall {
  channelId: string;
  members: string[];
  connectedAt: number | null;
  endedAt: number;
  kind: CallKind;
}

/// หน้าจอจบสายค้างไว้ให้เห็นนานเท่านี้ก่อนถามคะแนน / ก่อนปิดเอง
const ENDED_HOLD_MS = 1500;
const ENDED_CLOSE_MS = 2500;

export function CallEnded({
  call,
  onDone,
}: {
  call: EndedCall;
  onDone: () => void;
}) {
  const ask = shouldAskRating(call.connectedAt, call.endedAt);
  const [rating, setRating] = useState(false);
  const rootRef = useModalFocus<HTMLDivElement>(!rating, onDone);
  const [first] = call.members;

  useEffect(() => {
    const timer = window.setTimeout(
      () => (ask ? setRating(true) : onDone()),
      ask ? ENDED_HOLD_MS : ENDED_CLOSE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [ask, onDone]);

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="สิ้นสุดการโทรแล้ว"
      className="fixed inset-0 z-95 bg-black text-white outline-none animate-in fade-in-0"
    >
      {first && <CallBackdrop coreUserId={first} />}

      <button
        type="button"
        aria-label="ปิด"
        onClick={onDone}
        className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X aria-hidden className="size-6" />
      </button>

      <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
        {first && <CallAvatar coreUserId={first} size={112} />}
        <p className="mt-4 text-xl font-semibold">
          <CallTitle members={call.members} />
        </p>
        <p className="mt-1 text-sm text-white/70">สิ้นสุดการโทรแล้ว</p>
      </div>

      {rating && <RatingDialog call={call} onDone={onDone} />}
    </div>,
    document.body,
  );
}

function RatingDialog({ call, onDone }: { call: EndedCall; onDone: () => void }) {
  const id = useId();
  const panelRef = useModalFocus<HTMLDivElement>(true, onDone);
  const [hover, setHover] = useState(0);
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rate(value: number) {
    if (sending !== null) return;

    setSending(value);
    setError(null);

    try {
      await sendCallFeedback(
        feedbackBody({
          channelId: call.channelId,
          rating: value,
          connectedAt: call.connectedAt,
          endedAt: call.endedAt,
          kind: call.kind,
        }),
      );
      onDone();
    } catch (caught) {
      setSending(null);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'ส่งคะแนนไม่สำเร็จ — ลองอีกครั้ง',
      );
    }
  }

  const shown = sending ?? hover;

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/50 p-4">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl bg-neutral-900 p-6 text-center text-white shadow-2xl outline-none animate-in fade-in-0 zoom-in-95"
      >
        <h2 id={`${id}-title`} className="text-base font-semibold">
          คุณภาพการโทรของคุณเป็นอย่างไรบ้าง
        </h2>

        <div
          role="group"
          aria-label="ให้คะแนนคุณภาพการโทร"
          className="mt-5 flex justify-center gap-1"
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} ดาว`}
              disabled={sending !== null}
              onMouseEnter={() => setHover(value)}
              onFocus={() => setHover(value)}
              onBlur={() => setHover(0)}
              onClick={() => void rate(value)}
              className="grid size-11 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-default"
            >
              {sending === value ? (
                <Loader2 aria-hidden className="size-7 animate-spin" />
              ) : (
                <Star
                  aria-hidden
                  strokeWidth={1.6}
                  className={cn(
                    'size-8 transition-colors',
                    value <= shown ? 'fill-warning text-warning' : 'text-white/60',
                  )}
                />
              )}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onDone}
          className="mt-5 w-full rounded-lg px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          ไม่ใช่ตอนนี้
        </button>
      </div>
    </div>
  );
}
