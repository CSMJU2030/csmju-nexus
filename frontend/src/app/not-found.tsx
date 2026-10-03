import Link from 'next/link';
import { Compass, Search } from 'lucide-react';

/// หน้า 404 ของระบบ
///
/// ของเดิมเป็นหน้าเริ่มต้นของ Next ซึ่งเป็นภาษาอังกฤษ ไม่มีตราของระบบ
/// และ **ไม่มีทางกลับ** — ผู้ใช้ที่กดลิงก์เก่าหรือพิมพ์ผิดจะเจอทางตัน
/// แล้วต้องแก้ URL เอง ซึ่งคนส่วนใหญ่ไม่ทำ เขาจะปิดแท็บไปเลย
///
/// เป็น Server Component ได้เพราะไม่มีอะไรต้องโต้ตอบ — ส่ง JavaScript
/// ไปเบราว์เซอร์เป็นศูนย์
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <p className="font-mono text-5xl font-semibold text-primary">404</p>

        <h1 className="mt-4 text-xl font-semibold">ไม่พบหน้าที่ต้องการ</h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          หน้านี้อาจถูกย้าย ถูกลบ หรือลิงก์ที่ได้มาพิมพ์ผิด —
          ลองกลับไปที่ฟีดแล้วหาจากตรงนั้นดูครับ
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/feed"
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Compass className="size-4" aria-hidden="true" />
            ไปที่ฟีดชุมชน
          </Link>

          <Link
            href="/search"
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Search className="size-4" aria-hidden="true" />
            ค้นหา
          </Link>
        </div>
      </div>
    </main>
  );
}
