'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/// ป๊อปอัพลอยที่เกาะปุ่มหรือจุดบนจอ — ใช้ร่วมกันทุกป๊อปอัพของหน้า "ห้อง"
///
/// วาดผ่าน portal ไปที่ `<body>` เสมอ เพราะหัวห้องกับแถบซ้ายสร้าง stacking
/// context ของตัวเอง ป๊อปอัพที่อยู่ในนั้นจะโดนกรอบเลื่อนตัดหรือโดนของอื่นทับ
/// (บทเรียนเดียวกับ mobile-bars.tsx)
///
///   Esc · คลิกนอกกรอบ · เลื่อนหน้าจนปุ่มหลุดจอ → ปิด
///   ที่ว่างด้านล่างไม่พอ → พลิกขึ้นบน · ชิดขอบจอไม่ล้น
export type PopoverSide = 'bottom' | 'top' | 'right' | 'left';
export type PopoverAlign = 'start' | 'end' | 'center';

const GAP = 8;
const EDGE = 8;

export interface PopoverAnchor {
  /// ปุ่มหรือกล่องที่ป๊อปอัพเกาะ — ใช้ตัดสินว่าคลิกนอกกรอบหรือไม่ด้วย
  ref?: RefObject<HTMLElement | null>;
  /// หรือกรอบสี่เหลี่ยมตรง ๆ (เช่นตำแหน่งรูปโปรไฟล์ที่ถูกคลิก)
  rect?: DOMRect | null;
}

export function RoomPopover({
  open,
  onClose,
  anchor,
  side = 'bottom',
  align = 'end',
  width,
  label,
  className = '',
  children,
  role = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  anchor: PopoverAnchor;
  side?: PopoverSide;
  align?: PopoverAlign;
  /// ความกว้างที่ตั้งใจ (px) — ใช้คำนวณการชิดขอบก่อนวาดจริง
  width: number;
  label: string;
  className?: string;
  children: ReactNode;
  role?: 'dialog' | 'menu' | 'tooltip';
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const close = useEffectEvent(() => onClose());

  /// อ่านตำแหน่งปุ่มล่าสุดทุกครั้งที่เรียก (ปุ่มขยับได้เมื่อหน้าเลื่อน)
  const place = useEffectEvent(() => {
    const rect = anchor.ref?.current?.getBoundingClientRect() ?? anchor.rect ?? null;

    if (!rect) return;

    const panelHeight = panelRef.current?.offsetHeight ?? 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - EDGE * 2);
    let top: number;
    let left: number;

    if (side === 'right' || side === 'left') {
      left = side === 'right' ? rect.right + GAP : rect.left - w - GAP;

      // ไม่พอทางขวา → ไปซ้าย (และกลับกัน)
      if (side === 'right' && left + w > vw - EDGE) left = rect.left - w - GAP;
      if (side === 'left' && left < EDGE) left = rect.right + GAP;

      top = rect.top;
      if (top + panelHeight > vh - EDGE) top = Math.max(EDGE, vh - EDGE - panelHeight);
    } else {
      const below = vh - rect.bottom;
      const flipUp =
        side === 'top' ? rect.top > panelHeight + GAP || rect.top > below : below < panelHeight + GAP && rect.top > below;

      top = flipUp ? rect.top - panelHeight - GAP : rect.bottom + GAP;
      left =
        align === 'start' ? rect.left : align === 'center' ? rect.left + rect.width / 2 - w / 2 : rect.right - w;
    }

    left = Math.min(Math.max(EDGE, left), vw - w - EDGE);
    top = Math.max(EDGE, top);

    setPos({ top, left, maxHeight: vh - top - EDGE });
  });

  useLayoutEffect(() => {
    if (!open) return;

    place();

    // วางซ้ำหลังวาดรอบแรก — ตอนนั้นถึงจะรู้ความสูงจริงของเนื้อหา
    const frame = requestAnimationFrame(place);

    return () => cancelAnimationFrame(frame);
  }, [open, anchor.rect]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    const onPlace = () => place();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;

      if (panelRef.current?.contains(target)) return;
      if (anchor.ref?.current?.contains(target)) return;

      // ป๊อปอัพซ้อน (เช่นแผงอิโมจิที่เปิดจากในนี้) ก็อยู่ใน body เหมือนกัน
      if ((target as Element).closest?.('[data-room-popover], [aria-label="เลือกอีโมจิ"]')) return;

      close();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onPlace);
    window.addEventListener('scroll', onPlace, true);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onPlace);
      window.removeEventListener('scroll', onPlace, true);
    };
  }, [open, anchor.ref]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={label}
      data-room-popover=""
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: `min(${width}px, calc(100vw - ${EDGE * 2}px))`,
        maxHeight: pos?.maxHeight,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={`fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-csmju-lg animate-in fade-in-0 zoom-in-95 duration-100 ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
