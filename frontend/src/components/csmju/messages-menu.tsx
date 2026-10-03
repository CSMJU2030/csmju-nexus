'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/// เมนูเล็กที่เด้งจากปุ่ม ⋯ แบบ Instagram (เมนูของแถวแชท ฯลฯ)
///
/// กติกาเดียวกับทุก popup ของหน้าข้อความ:
///   - วาดผ่าน portal ไปที่ <body> ด้วย `fixed` — แถวอยู่ในกรอบเลื่อน ถ้าวาง
///     `absolute` ในแถว เมนูของแถวล่าง ๆ จะถูกกรอบตัดจนกดไม่ได้
///   - เด้งด้วย `animate-in fade-in-0 zoom-in-95` ของ tw-animate-css
///   - Esc ปิด · กดนอกเมนูปิด · Tab วนอยู่ในเมนู (กักโฟกัส) · ปิดแล้วคืนโฟกัส
///     ให้ปุ่มที่เปิด คนใช้คีย์บอร์ดจะได้ไม่ต้องไล่ Tab ใหม่ตั้งแต่ต้นหน้า
///   - ลูกศรขึ้น/ลงเลื่อนระหว่างรายการ ตามแบบ role="menu" ของ WAI-ARIA

const GAP = 6;

export function PopMenu({
  anchorRef,
  open,
  onClose,
  label,
  width = 240,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;

    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const height = panel?.offsetHeight ?? 200;
    const below = window.innerHeight - rect.bottom;
    const up = below < height + GAP && rect.top > below;

    setPos({
      top: Math.max(GAP, up ? rect.top - height - GAP : rect.bottom + GAP),
      left: Math.min(
        Math.max(GAP, rect.right - width),
        Math.max(GAP, window.innerWidth - width - GAP),
      ),
    });
  }, [anchorRef, width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // วัดความสูงจริงอีกรอบหลังวาดแล้ว — รอบแรกยังไม่รู้ว่าเมนูสูงเท่าไร
  // จึงอาจพลิกผิดทางหนึ่งเฟรม
  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      place();
      panelRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
        ?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const anchor = anchorRef.current;
    const panel = panelRef.current;

    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;

      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;

      onClose();
    };

    // Esc ต้องปิดได้ทันทีที่เมนูโผล่ — โฟกัสย้ายเข้าเมนูช้าไปหนึ่งเฟรม (requestAnimationFrame
    // ด้านบน) ถ้าฟังแค่ onKeyDown ของตัวเมนู การกด Esc ในเฟรมนั้นจะหายไปเฉย ๆ
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      onClose();
    };

    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      // คืนโฟกัสให้ปุ่มที่เปิดเมนู
      if (anchor && document.activeElement && panel?.contains(document.activeElement)) {
        anchor.focus();
      }
    };
  }, [open, onClose, place, anchorRef]);

  if (!open) return null;

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();

      return;
    }

    if (items.length === 0) return;

    // Tab วนในเมนู — กักโฟกัสไว้ ไม่ให้หลุดไปหลังฉากระหว่างเมนูเปิด
    if (event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      const back = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
      const next = back
        ? (index - 1 + items.length) % items.length
        : (index + 1) % items.length;

      items[next].focus();
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
      }}
      className="fixed z-[95] overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  onSelect,
  icon,
  tone = 'default',
  disabled,
  trailing = false,
  children,
}: {
  onSelect: () => void;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /// ไอคอนชิดขวาแบบเมนู ⋮ ของฟองข้อความใน IG (ค่าเริ่มต้นชิดซ้าย)
  trailing?: boolean;
  children: ReactNode;
}) {
  const glyph = icon && (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center">
      {icon}
    </span>
  );

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50 ${
        tone === 'danger' ? 'font-semibold text-destructive' : ''
      }`}
    >
      {!trailing && glyph}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing && glyph}
    </button>
  );
}

/// กล่องยืนยันก่อนทำสิ่งที่ย้อนไม่ได้ (ลบแชท · ออกจากแชท) แบบ Instagram:
/// หัวข้อ · คำอธิบาย · ปุ่มแดงบน · ยกเลิกล่าง
///
/// ใช้ Dialog กลางซึ่งตั้งบน `<dialog>.showModal()` — ได้ top layer, กักโฟกัส
/// และ Esc ปิดมาจากเบราว์เซอร์เอง พร้อมแอนิเมชัน zoom-in-95 ชุดเดียวกัน
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl text-center">
        <div className="px-8 pb-5 pt-8">
          <DialogTitle className="text-xl font-normal leading-snug">{title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed">{description}</DialogDescription>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 border-t border-border text-sm font-bold text-destructive transition-colors hover:bg-accent disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-12 w-full border-t border-border text-sm transition-colors hover:bg-accent"
        >
          ยกเลิก
        </button>
      </DialogContent>
    </Dialog>
  );
}
