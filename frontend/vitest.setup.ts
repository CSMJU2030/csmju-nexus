import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

/// ถอด DOM ทิ้งหลังทุกเทสต์ ไม่งั้น component จากเทสต์ก่อนจะค้างอยู่
/// แล้ว getByRole จะเจอสองตัวและฟ้อง "found multiple elements"
afterEach(cleanup);

/// jsdom ไม่มี requestAnimationFrame ที่เดินจริง — แทนด้วย setTimeout
/// เพื่อให้ตัวจับเวลาของสตอรี่เดินได้ในเทสต์
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame;
}

/// jsdom ยังไม่รองรับ <dialog>.showModal() — Dialog ของเราใช้มันเป็นฐาน
/// จำลองให้พอทดสอบพฤติกรรมเปิด-ปิดได้
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

/// component หลายตัวเรียก scrollIntoView ซึ่ง jsdom ไม่มี
Element.prototype.scrollIntoView = vi.fn();

/// ─────────────────────────────────────────────────────────────────────
/// คำเตือนของ React ต้องทำให้เทสต์แดง
///
/// **บทเรียนที่ได้มาแบบเจ็บตัว:** เดิมผมเขียนเทสต์ที่ดัก console.error แล้ว
/// assert ว่าไม่มีข้อความ "Cannot update a component" — เทสต์นั้นเขียวทั้งที่
/// บั๊กยังอยู่ครบ
///
/// เหตุผล: **React แจ้งคำเตือนแต่ละแบบครั้งเดียวต่อคู่ component**
/// เทสต์ก่อนหน้าในไฟล์เดียวกันกระตุ้นมันไปแล้ว พอถึงเทสต์ที่ตรวจจริง
/// React จึงเงียบ แล้ว assert ก็ผ่านโดยไม่ได้ตรวจอะไรเลย
///
/// การไล่ assert ทีละที่จึงเชื่อถือไม่ได้โดยธรรมชาติ — ต้องดักที่ระดับชุดทดสอบ
/// ให้ console.error ครั้งแรกที่เกิดขึ้นทำให้เทสต์นั้นแดงทันที
///
/// เทสต์ที่ตั้งใจให้เกิด error (เช่นทดสอบ error boundary) เรียก
/// `expectConsoleError()` เพื่อขออนุญาตเป็นรายเทสต์
let allowedErrors: RegExp[] = [];
let capturedErrors: string[] = [];

/// อนุญาตให้เทสต์นี้มี console.error ที่ตรงกับรูปแบบที่ระบุ
export function expectConsoleError(...patterns: RegExp[]) {
  allowedErrors.push(...patterns);
}

beforeEach(() => {
  allowedErrors = [];
  capturedErrors = [];

  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    // React ใช้ %s เป็น placeholder — ต่อ argument ทั้งหมดเพื่อให้อ่านออก
    const message = args.map(String).join(' ');

    if (allowedErrors.some((pattern) => pattern.test(message))) {
      return;
    }

    capturedErrors.push(message);
  });

  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const message = args.map(String).join(' ');

    // คำเตือนของ React ที่บอกว่าเขียนโค้ดผิด — ปนกับ warn ทั่วไปไม่ได้
    if (/^Warning:|React|act\(\)/i.test(message)) {
      capturedErrors.push(message);
    }
  });
});

afterEach(() => {
  const errors = capturedErrors;

  capturedErrors = [];

  if (errors.length > 0) {
    expect
      .soft(errors, 'เทสต์นี้ทำให้ React เขียนคำเตือนออกมา')
      .toEqual([]);
  }
});
