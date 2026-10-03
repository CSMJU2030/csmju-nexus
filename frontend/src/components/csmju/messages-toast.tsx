'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert } from 'lucide-react';

/// แจ้งเตือนสั้นกลางล่างจอแบบ Instagram ("คัดลอกแล้ว ✓")
///
/// เก็บสถานะไว้ระดับโมดูล ไม่ผูกกับคอมโพเนนต์ใด — ปุ่ม "คัดลอก" อยู่ลึกในเมนู ⋮
/// ของฟองข้อความ ถ้าต้องส่ง callback ขึ้นไปหาคนวาด toast ทุกชั้นจะรกมาก
/// `showToast()` เรียกจากที่ไหนก็ได้ แล้ว `<ToastHost />` ตัวเดียวเป็นคนวาด
///
/// ไม่ใช่ popup ที่ต้องกักโฟกัส — แค่ประกาศผ่าน role="status" ให้โปรแกรมอ่าน
/// หน้าจออ่านออก แล้วจางหายเองใน 2 วินาที

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

let current: Toast | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const notify of listeners) notify();
}

export function showToast(text: string, tone: Toast['tone'] = 'ok') {
  counter += 1;
  current = { id: counter, text, tone };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function ToastHost() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  const [leaving, setLeaving] = useState<number | null>(null);

  useEffect(() => {
    if (!toast) return;

    // จางออกก่อนหายจริง — หายวับทันทีดูเหมือนแอปกระตุก
    const fade = setTimeout(() => setLeaving(toast.id), 1700);
    const timer = setTimeout(() => {
      // ปิดเฉพาะตัวที่ตั้งเวลาไว้ — ถ้ามีอันใหม่มาแทนแล้ว อันใหม่ต้องอยู่ครบ 2 วินาทีของมัน
      if (current?.id === toast.id) {
        current = null;
        emit();
      }
    }, 2000);

    return () => {
      clearTimeout(fade);
      clearTimeout(timer);
    };
  }, [toast]);

  if (!toast || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      key={toast.id}
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[110] flex justify-center px-4 lg:bottom-8"
    >
      <span
        className={`flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background shadow-xl duration-300 ${
          leaving === toast.id
            ? 'animate-out fade-out-0 fill-mode-forwards'
            : 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2'
        }`}
      >
        {toast.tone === 'ok' ? (
          <Check aria-hidden className="size-4" strokeWidth={3} />
        ) : (
          <CircleAlert aria-hidden className="size-4" strokeWidth={2.4} />
        )}
        {toast.text}
      </span>
    </div>,
    document.body,
  );
}
