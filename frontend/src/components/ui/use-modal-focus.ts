'use client';

import * as React from 'react';

/// กักโฟกัสไว้ในกล่องที่เปิดอยู่ แล้วคืนที่เดิมตอนปิด
///
/// `<dialog>` ของเบราว์เซอร์ทำสี่อย่างนี้ให้ฟรี แต่กล่องที่วาดเองด้วย `<div>`
/// ไม่ได้อะไรเลย — การประกาศ `role="dialog" aria-modal="true"` เป็นเพียง
/// **คำสัญญา** กับโปรแกรมอ่านหน้าจอ ถ้าไม่ทำตามจะแย่กว่าไม่ประกาศ เพราะมัน
/// บอกผู้ใช้ว่า "ข้างนอกถูกซ่อนแล้ว" ทั้งที่ Tab ยังเดินออกไปข้างนอกได้จริง
///
/// สี่อย่างที่ต้องทำเอง:
///   1. จำว่าโฟกัสอยู่ที่ไหนก่อนเปิด
///   2. ย้ายโฟกัสเข้ามาในกล่อง (ไม่งั้นคนใช้คีย์บอร์ดไม่รู้ว่ามีอะไรเปิดขึ้น)
///   3. กัน Tab ไม่ให้หลุดออกไปหลังฉาก
///   4. คืนโฟกัสกลับที่เดิมตอนปิด
///
/// ใช้ร่วมกันทั้งสตอรี่ · แผ่นสายเรียกเข้า · เมนู "เพิ่มเติม" ของแถบล่าง
/// เพราะทั้งสามพลาดชุดเดียวกันหมด

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
}

export function useModalFocus<T extends HTMLElement>(
  open: boolean,
  onClose?: () => void,
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const returnTo = React.useRef<HTMLElement | null>(null);

  // เก็บ callback ไว้ใน ref เพื่อไม่ให้ effect ผูก-ถอดใหม่ทุก render
  // (ผู้เรียกมักส่ง arrow function ตัวใหม่มาทุกครั้ง)
  const closeRef = React.useRef(onClose);

  React.useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;

    const container = ref.current;

    if (!container) return;

    returnTo.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const items = focusableWithin(container);

    // ถ้าไม่มีอะไรให้โฟกัสเลย ให้โฟกัสตัวกล่องเอง (ต้องมี tabIndex={-1})
    (items[0] ?? container).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeRef.current?.();

        return;
      }

      if (event.key !== 'Tab') return;

      const current = focusableWithin(container!);

      if (current.length === 0) {
        event.preventDefault();

        return;
      }

      const first = current[0];
      const last = current[current.length - 1];
      const active = document.activeElement;
      const inside = container!.contains(active);

      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();

        return;
      }

      if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    // capture = true เพื่อให้ได้เห็นปุ่มก่อน handler อื่นที่อาจ stopPropagation
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);

      // คืนโฟกัสเฉพาะเมื่อปุ่มเดิมยังอยู่ในหน้า — ถ้ามันถูกถอดไปแล้ว
      // การเรียก focus() จะไม่เกิดอะไรขึ้นและโฟกัสจะร่วงไปที่ body
      const target = returnTo.current;

      returnTo.current = null;

      if (target && target.isConnected) {
        target.focus();
      }
    };
  }, [open]);

  return ref;
}
