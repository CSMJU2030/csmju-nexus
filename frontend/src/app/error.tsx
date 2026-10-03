'use client'; // Error boundaries ต้องเป็น Client Component

import { useEffect } from 'react';
import Link from 'next/link';
import { Compass, RotateCcw, TriangleAlert } from 'lucide-react';

/// ตาข่ายรับข้อผิดพลาดของทั้งแอป
///
/// ไม่มีไฟล์นี้ = หน้าไหนโยน error ขึ้นมา ผู้ใช้จะเจอหน้าขาวหรือข้อความ
/// "Application error: a client-side exception has occurred" ซึ่งบอกอะไร
/// ไม่ได้เลยและ **ไม่มีทางกลับ** ต้องปิดแท็บทิ้งอย่างเดียว
///
/// หมายเหตุสำหรับคนที่มาแก้ต่อ: Next รุ่นนี้ส่ง prop ชื่อ `retry`
/// **ไม่ใช่ `reset`** แบบรุ่นก่อน (ดู node_modules/next/dist/docs/01-app/
/// 03-api-reference/03-file-conventions/error.md) — เขียนจากความจำจะพัง
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // ต้องมีร่องรอยไว้ไล่ — ไม่งั้นรู้แค่ว่า "ผู้ใช้บอกว่ามันพัง"
    console.error('หน้าจอพังเพราะ:', error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-destructive/40 bg-card p-6 text-center shadow-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10">
            <TriangleAlert
              className="size-6 text-destructive"
              aria-hidden="true"
            />
          </span>

          <h1 className="mt-4 text-lg font-semibold">หน้านี้ทำงานผิดพลาด</h1>

          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            ไม่ใช่ความผิดของคุณ — ลองโหลดใหม่ดูก่อน ถ้ายังเป็นอยู่
            ให้แจ้งผู้ดูแลพร้อมรหัสด้านล่าง
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => retry()}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              ลองใหม่
            </button>

            <Link
              href="/feed"
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Compass className="size-4" aria-hidden="true" />
              กลับไปที่ฟีด
            </Link>
          </div>
        </div>

        {error.digest && (
          <p className="mt-3 text-center font-mono text-xs text-muted-foreground">
            {/* digest คือรหัสที่ Next สร้างให้ ใช้จับคู่กับ log ฝั่งเซิร์ฟเวอร์
              * ผู้ใช้ไม่ต้องเข้าใจมัน แค่ก๊อปไปให้ผู้ดูแลก็ตามรอยได้ */}
            รหัสอ้างอิง: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
