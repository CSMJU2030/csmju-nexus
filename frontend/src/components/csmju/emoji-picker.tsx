'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Car,
  Clock,
  Flag,
  Lightbulb,
  Loader2,
  PawPrint,
  Search,
  Shapes,
  Smile,
  Sparkles,
  UtensilsCrossed,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';

/// แผงอิโมจิแบบ Instagram — ครบทั้งชุดมาตรฐาน Unicode พร้อมคำค้นภาษาไทย
///
///   ช่องค้นหา "ค้นหาอีโมจิ" (ค้นได้ทั้งไทยและอังกฤษ จากคำอธิบายของ CLDR)
///   ใช้ล่าสุด / ได้รับความนิยมสูงสุด → หมวดทั้งเก้า → แท็บหมวดด้านล่าง
///
/// ข้อมูล ~1,900 ตัว (250 KB) โหลดแบบ dynamic import ตอนเปิดแผงครั้งแรกเท่านั้น
/// หน้าที่ไม่มีใครเปิดแผงจึงไม่ต้องจ่ายค่าดาวน์โหลดนี้เลย
///
/// วาดผ่าน portal ไปที่ <body> เสมอ — แผงที่อยู่ในกรอบเลื่อน (ห้องแชท แผง
/// ความคิดเห็น) ถูกตัดขอบจนกดไม่ได้ ซึ่งเป็นบั๊กที่เคยเกิดกับแผงรีแอ็กชันมาแล้ว

type EmojiRow = readonly [emoji: string, group: number, keywords: string];

interface EmojiData {
  groups: ReadonlyArray<{ id: string; label: string }>;
  emojis: ReadonlyArray<EmojiRow>;
}

let dataPromise: Promise<EmojiData> | null = null;

function loadEmojiData(): Promise<EmojiData> {
  dataPromise ??= import('@/lib/csmju/emoji-data').then((mod) => ({
    groups: mod.EMOJI_GROUPS,
    emojis: mod.EMOJIS,
  }));

  return dataPromise;
}

/// ชุดที่ Instagram ขึ้นเป็น "ได้รับความนิยมสูงสุด" ในแผงรีแอ็กชัน
export const POPULAR_EMOJI = [
  '😂', '😮', '😍', '😢', '👏', '🔥', '🎉',
  '💯', '❤️', '🤣', '🥰', '😘', '😭', '😊',
] as const;

const RECENT_KEY = 'csmju:emoji-recent';
const RECENT_MAX = 24;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');

    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/// จำอิโมจิที่ใช้ล่าสุดไว้ในเครื่องนี้ — เป็นความสะดวกเฉพาะคน ไม่ต้องเก็บที่หลังบ้าน
export function rememberEmoji(emoji: string): void {
  try {
    const next = [emoji, ...readRecent().filter((x) => x !== emoji)].slice(0, RECENT_MAX);

    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // จำไม่ได้ก็แค่ไม่มีรายการล่าสุด
  }
}

const GROUP_ICON: Record<string, LucideIcon> = {
  people: Smile,
  nature: PawPrint,
  food: UtensilsCrossed,
  activity: Volleyball,
  travel: Car,
  objects: Lightbulb,
  symbols: Shapes,
  flags: Flag,
};

/// ฟอนต์อิโมจิของระบบ — บน Windows คือ Segoe UI Emoji แบบเดียวกับที่ Instagram แสดง
export const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';

interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  emojis: string[];
}

export function EmojiPanel({
  onPick,
  variant = 'composer',
  autoFocus = true,
}: {
  onPick: (emoji: string) => void;
  /// composer = ช่องพิมพ์ (เริ่มที่ "ใช้ล่าสุด") · reaction = รีแอ็กชัน (เริ่มที่ "ได้รับความนิยมสูงสุด")
  variant?: 'composer' | 'reaction';
  autoFocus?: boolean;
}) {
  const [data, setData] = useState<EmojiData | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  // อ่านตอนสร้าง ไม่ใช่ใน effect — แผงนี้ขึ้นเฉพาะฝั่งเบราว์เซอร์หลังผู้ใช้กดเปิด
  const [recent] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readRecent()));
  const [activeId, setActiveId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;

    loadEmojiData()
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  const sections = useMemo<Section[]>(() => {
    if (!data) return [];

    const byGroup = data.groups.map((group) => ({
      id: group.id,
      label: group.label,
      icon: GROUP_ICON[group.id] ?? Smile,
      emojis: [] as string[],
    }));

    for (const [emoji, group] of data.emojis) byGroup[group]?.emojis.push(emoji);

    const head: Section[] =
      variant === 'reaction'
        ? [{ id: 'popular', label: 'ได้รับความนิยมสูงสุด', icon: Sparkles, emojis: [...POPULAR_EMOJI] }]
        : recent.length > 0
          ? [{ id: 'recent', label: 'ใช้ล่าสุด', icon: Clock, emojis: recent }]
          : [];

    return [...head, ...byGroup];
  }, [data, recent, variant]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q || !data) return null;

    return data.emojis.filter(([, , keywords]) => keywords.toLowerCase().includes(q)).map(([emoji]) => emoji);
  }, [data, query]);

  // แท็บด้านล่างสว่างตามหมวดที่กำลังเห็นอยู่
  const onScroll = useCallback(() => {
    const box = scrollRef.current;

    if (!box) return;

    const top = box.scrollTop + 8;
    let current = sections[0]?.id ?? '';

    for (const section of sections) {
      const el = box.querySelector<HTMLElement>(`[data-section="${section.id}"]`);

      if (el && el.offsetTop <= top) current = section.id;
    }

    setActiveId(current);
  }, [sections]);

  const jump = (id: string) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-section="${id}"]`);

    if (box && el) box.scrollTo({ top: el.offsetTop - 4 });
    setQuery('');
    setActiveId(id);
  };

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
  };

  const grid = (emojis: string[]) => (
    <div className="grid grid-cols-8 gap-0.5 px-2">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => pick(emoji)}
          aria-label={emoji}
          className="grid aspect-square place-items-center rounded-md text-[1.6rem] leading-none transition-transform hover:scale-110 hover:bg-accent"
          style={{ fontFamily: EMOJI_FONT }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-[26rem] w-[21rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-csmju-lg">
      <div className="p-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-muted px-3 text-muted-foreground">
          <Search aria-hidden className="size-4 shrink-0" />
          <input
            // เปิดแผงแล้วพิมพ์ค้นได้ทันที แบบ Instagram
            autoFocus={autoFocus}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาอีโมจิ"
            aria-label="ค้นหาอีโมจิ"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!data && !failed && (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            กำลังโหลดอีโมจิ…
          </p>
        )}

        {failed && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            โหลดอีโมจิไม่สำเร็จ — ลองเปิดใหม่อีกครั้ง
          </p>
        )}

        {results ? (
          results.length > 0 ? (
            <section>
              <h3 className="px-3 pb-1.5 pt-1 text-xs font-semibold text-muted-foreground">
                ผลการค้นหา
              </h3>
              {grid(results)}
            </section>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">ไม่พบอีโมจิ</p>
          )
        ) : (
          sections.map((section) => (
            <section key={section.id} data-section={section.id} className="pb-2 [content-visibility:auto]">
              <h3 className="px-3 pb-1.5 pt-1 text-xs font-semibold text-muted-foreground">
                {section.label}
              </h3>
              {grid(section.emojis)}
            </section>
          ))
        )}
      </div>

      {data && (
        <nav aria-label="หมวดอีโมจิ" className="flex shrink-0 items-center justify-between border-t border-border px-2 py-1.5">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => jump(id)}
              aria-label={label}
              title={label}
              aria-current={activeId === id || (!activeId && id === sections[0]?.id) ? 'true' : undefined}
              className={`grid size-8 place-items-center rounded-md transition-colors ${
                activeId === id || (!activeId && id === sections[0]?.id)
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon aria-hidden className="size-4" strokeWidth={2} />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

const PANEL_WIDTH = 336;
const PANEL_HEIGHT = 416;
const GAP = 8;

/// แผงอิโมจิที่ลอยเกาะปุ่ม — พลิกขึ้น/ลงเองตามที่ว่างจริงบนจอ และตามปุ่มเมื่อหน้าเลื่อน
export function EmojiPopover({
  anchorRef,
  open,
  onClose,
  onPick,
  variant = 'composer',
  /// ปิดแผงหลังเลือก — ช่องพิมพ์ปล่อยให้เลือกต่อได้หลายตัว รีแอ็กชันปิดทันที
  closeOnPick = false,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  variant?: 'composer' | 'reaction';
  closeOnPick?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;

    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const up = below < PANEL_HEIGHT + GAP && rect.top > below;

    setPos({
      top: Math.max(GAP, up ? rect.top - PANEL_HEIGHT - GAP : rect.bottom + GAP),
      left: Math.min(
        Math.max(GAP, rect.right - PANEL_WIDTH),
        Math.max(GAP, window.innerWidth - PANEL_WIDTH - GAP),
      ),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') onClose();
        return;
      }

      const target = event.target as Node;

      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose, place, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="เลือกอีโมจิ"
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[90] animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <EmojiPanel
        variant={variant}
        onPick={(emoji) => {
          onPick(emoji);
          if (closeOnPick) onClose();
        }}
      />
    </div>,
    document.body,
  );
}

/// สร้างตอนรันเพราะ TypeScript ที่ตั้งเป้า ES2022 ไม่ยอมให้เขียน flag `v` ตรง ๆ
/// (Chrome/Edge/Safari/Firefox ปัจจุบันรองรับหมดแล้ว)
///
/// ยอมรับ Extended_Pictographic ที่ไม่มี U+FE0F ต่อท้ายด้วย (เช่น 👁 ที่คีย์บอร์ด
/// หลายตัวส่งมาแบบนี้) — RGI อย่างเดียวจะมองว่า 👁👄👁 ไม่ใช่อิโมจิ
const SINGLE_EMOJI = new RegExp(String.raw`^(?:\p{RGI_Emoji}|\p{Extended_Pictographic}️?)$`, 'v');

/// ข้อความที่มีแต่อิโมจิ 1–3 ตัว — Instagram แสดงตัวใหญ่ไม่มีฟอง
export function isEmojiOnly(text: string | null | undefined): boolean {
  if (!text) return false;

  const trimmed = text.trim();

  if (!trimmed || trimmed.length > 40) return false;

  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)]
    .map((s) => s.segment)
    .filter((s) => s.trim());

  return segments.length >= 1 && segments.length <= 3 && segments.every((s) => SINGLE_EMOJI.test(s));
}
