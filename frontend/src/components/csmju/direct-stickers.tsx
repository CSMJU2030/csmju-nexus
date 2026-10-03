'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ImagePlay, Loader2 } from 'lucide-react';
import { EMOJI_FONT } from '@/components/csmju/emoji-picker';

/// แผงสติกเกอร์ของช่องพิมพ์ แบบ Instagram — สองแท็บ
///
///   สติกเกอร์  อิโมจิตัวใหญ่ชุดคัดมา ส่งแล้วขึ้นเป็นอิโมจิตัวใหญ่ไม่มีฟอง
///              (ข้อความอิโมจิล้วนที่ทุกฝั่งวาดได้อยู่แล้ว — ไม่ต้องมีคลังรูปแยก)
///   GIF       เลือกไฟล์ .gif จากเครื่อง แล้วส่งเป็นรูปแนบ
///
/// **ไม่มีช่องค้นหา GIPHY และแท็บเพลง** ของ IG เพราะต้องใช้ API และสิทธิ์
/// ภายนอก ซึ่งระบบย่อยนี้ไม่มี (และมาตรฐานห้ามเพิ่ม dependency)
///
/// ชุดสติกเกอร์ถูกกรองกับข้อมูลอิโมจิมาตรฐาน (`EMOJIS`) ตอนเปิดแผง — ตัวที่ไม่อยู่
/// ในชุด RGI จะไม่ขึ้น (หลังบ้านรับได้ทุกตัว แต่ไม่ใช่ทุกเครื่องวาดตัวนอกชุดได้)

/// ชุดคัด — อารมณ์ที่คนใช้แทนสติกเกอร์บ่อย เรียงแบบแผงสติกเกอร์ของ IG
export const STICKER_SET = [
  '😂', '🥹', '😍', '🥰', '😘', '😎', '🤩', '🥳',
  '😭', '😤', '😱', '🤯', '🥺', '😴', '🤔', '🫠',
  '🙈', '🤗', '🫶', '🙏', '👏', '👍', '💪', '🤝',
  '❤️', '🔥', '✨', '🎉', '💯', '🌈', '⭐', '🌸',
  '🐶', '🐱', '🐻', '🐼', '🐧', '🦄', '🐸', '🐥',
  '🍕', '🍩', '🧋', '☕', '📚', '💻', '🎮', '⚽',
] as const;

const PANEL_WIDTH = 336;
const PANEL_HEIGHT = 360;
const GAP = 8;

type Tab = 'stickers' | 'gif';

export function StickerPopover({
  anchorRef,
  open,
  onClose,
  onSticker,
  onGif,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  onSticker: (emoji: string) => void;
  onGif: (file: File) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [tab, setTab] = useState<Tab>('stickers');
  const [available, setAvailable] = useState<Set<string> | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;

    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const up = rect.top > PANEL_HEIGHT + GAP;

    setPos({
      top: up ? rect.top - PANEL_HEIGHT - GAP : rect.bottom + GAP,
      left: Math.min(
        Math.max(GAP, rect.right - PANEL_WIDTH),
        Math.max(GAP, window.innerWidth - PANEL_WIDTH - GAP),
      ),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // ข้อมูลอิโมจิ ~250 KB โหลดตอนเปิดแผงครั้งแรกเท่านั้น (ไฟล์เดียวกับแผงอิโมจิ
  // จึงถูกแคชร่วมกัน) · ระหว่างโหลดยังไม่ขึ้นตาราง ไม่ขึ้นตัวที่ยังไม่ได้ตรวจ
  useEffect(() => {
    if (!open || available) return;

    let cancelled = false;

    void import('@/lib/csmju/emoji-data').then((mod) => {
      if (cancelled) return;

      const known = new Set(mod.EMOJIS.map((row) => row[0]));

      setAvailable(new Set(STICKER_SET.filter((emoji) => known.has(emoji))));
    });

    return () => {
      cancelled = true;
    };
  }, [open, available]);

  useEffect(() => {
    if (!open) return;

    const anchor = anchorRef.current;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;

      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;

      onClose();
    };

    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', place);

    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose, place, anchorRef]);

  if (!open || !pos) return null;

  const stickers = STICKER_SET.filter((emoji) => available?.has(emoji));

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="สติกเกอร์และ GIF"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();

          return;
        }

        // กักโฟกัสไว้ในแผง
        if (event.key !== 'Tab') return;

        const focusable = [
          ...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []),
        ];
        const index = focusable.indexOf(document.activeElement as HTMLElement);

        event.preventDefault();
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
      }}
      style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, height: PANEL_HEIGHT }}
      className="fixed z-[90] flex flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <div role="tablist" aria-label="ชนิด" className="flex shrink-0 border-b border-border">
        {(
          [
            ['stickers', 'สติกเกอร์'],
            ['gif', 'GIF'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px flex-1 border-b py-2.5 text-sm font-semibold transition-colors ${
              tab === value
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'stickers' ? (
        <div role="tabpanel" aria-label="สติกเกอร์" className="min-h-0 flex-1 overflow-y-auto p-2">
          {!available ? (
            <p className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 aria-label="กำลังโหลด" className="size-5 animate-spin" />
            </p>
          ) : (
            <div className="grid grid-cols-6 gap-1">
              {stickers.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onSticker(emoji);
                    onClose();
                  }}
                  aria-label={`ส่งสติกเกอร์ ${emoji}`}
                  style={{ fontFamily: EMOJI_FONT }}
                  className="grid aspect-square place-items-center rounded-xl text-[2.1rem] transition-transform hover:scale-110 hover:bg-accent"
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          aria-label="GIF"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-muted">
            <ImagePlay aria-hidden className="size-7" strokeWidth={1.9} />
          </span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            ส่งไฟล์ .gif จากเครื่องของคุณ — ระบบนี้ไม่มีคลัง GIF ออนไลน์
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-label="เลือกไฟล์ GIF"
            onChange={(event) => {
              const file = event.target.files?.[0];

              event.target.value = '';

              if (file) {
                onGif(file);
                onClose();
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            เลือก GIF จากเครื่อง
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
