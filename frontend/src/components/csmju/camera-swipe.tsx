'use client';

import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Camera } from 'lucide-react';

/// ปัดขวาบนฟีดเพื่อเปิดกล้อง แบบ Instagram (จอสัมผัสเท่านั้น)
///
/// ไม่แย่งท่าปัดของส่วนที่เลื่อนแนวนอนได้เอง (แถวสตอรี่ · รูปหลายภาพในโพสต์ · ช่องพิมพ์) —
/// เริ่มปัดบนกล่องพวกนั้นแล้วกล่องเลื่อนตามปกติ ไม่เปิดกล้อง
const OPEN_PX = 90;
const DECIDE_PX = 12;

export function isInsideHorizontalScroller(target: EventTarget | null, stop: Element | null): boolean {
  let node = target instanceof Element ? target : null;

  while (node && node !== stop) {
    if (node.matches('input, textarea, select, [contenteditable="true"], [data-no-camera-swipe]')) return true;

    const style = window.getComputedStyle(node);

    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth) return true;

    node = node.parentElement;
  }

  return false;
}

export function CameraSwipe({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);
  // ระยะปัดเก็บใน ref ด้วย — touchend อาจมาก่อน React วาดรอบใหม่ ถ้าอ่านจาก state จะได้ค่าเก่า
  const start = useRef<{ x: number; y: number; dx: number; mode: 'pending' | 'swipe' | 'ignore' } | null>(null);
  const [drag, setDrag] = useState(0);

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];

    if (!touch || event.touches.length > 1) {
      start.current = null;
      return;
    }

    start.current = {
      x: touch.clientX,
      y: touch.clientY,
      dx: 0,
      mode: isInsideHorizontalScroller(event.target, root.current) ? 'ignore' : 'pending',
    };
  }

  function onTouchMove(event: TouchEvent) {
    const state = start.current;
    const touch = event.touches[0];

    if (!state || !touch || state.mode === 'ignore') return;

    const dx = touch.clientX - state.x;
    const dy = touch.clientY - state.y;

    if (state.mode === 'pending') {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      state.mode = dx > 0 && dx > Math.abs(dy) * 1.3 ? 'swipe' : 'ignore';
    }

    if (state.mode === 'swipe') {
      state.dx = Math.max(0, dx);
      setDrag(state.dx);
    }
  }

  function onTouchEnd() {
    const opened = start.current?.mode === 'swipe' && start.current.dx >= OPEN_PX;

    start.current = null;
    setDrag(0);

    if (opened) onOpen();
  }

  return (
    <div
      ref={root}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="overscroll-x-none"
    >
      {children}

      {drag > 0 && (
        <div
          aria-hidden
          style={{ width: Math.min(drag, window.innerWidth) }}
          className="pointer-events-none fixed inset-y-0 left-0 z-90 grid place-items-center overflow-hidden bg-black text-white"
        >
          <span
            className="flex flex-col items-center gap-2 text-xs transition-opacity"
            style={{ opacity: Math.min(1, drag / OPEN_PX) }}
          >
            <Camera className="size-8" />
            {drag >= OPEN_PX ? 'ปล่อยเพื่อเปิดกล้อง' : 'ปัดต่อเพื่อเปิดกล้อง'}
          </span>
        </div>
      )}
    </div>
  );
}
