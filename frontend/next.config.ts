import { join } from "node:path";
import type { NextConfig } from "next";

/// รากของ workspace — ใช้ทั้งกับ Turbopack และการตามรอยไฟล์ตอน build
const WORKSPACE_ROOT = join(__dirname, "..");

/// หลังบ้าน NestJS ที่หน้าบ้านส่งต่อคำขอไปให้ (connect-core-hub.md ข้อ 1)
///
/// **หน้าบ้านเป็นประตูเดียวของระบบ** (standards 1.7.0): `/api/*` และ
/// `/auth/login` `/auth/callback` `/auth/logout` ถูก rewrite ไปที่หลังบ้าน
/// Callback URL ในทะเบียน Core Hub จึงเป็น http://localhost:3222/auth/callback
/// และคุกกี้ state กับคุกกี้ session (HttpOnly) อยู่บน origin เดียวกับหน้าเว็บ
///
/// rewrite ถูกคำนวณตอน `next build` ด้วย — build สำหรับ Docker ต้องตั้ง
/// BACKEND_URL ตอน build ไม่ใช่แค่ตอนรัน
///
/// socket.io ส่งผ่าน rewrite ไม่ได้ (WebSocket) จึงต่อตรงที่ NEXT_PUBLIC_SOCKET_URL
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:4222").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /// image ของ web (frontend/Dockerfile) copy `.next/standalone` — deployment.md ข้อ 3 · DEP-04
  output: "standalone",
  /// standalone ต้องตามรอยไฟล์จากรากของ pnpm workspace ไม่ใช่แค่ frontend/
  outputFileTracingRoot: WORKSPACE_ROOT,

  /// ปุ่ม "N" ของ Next dev tools (มีเฉพาะตอน next dev) ไปไว้มุมขวาบน
  /// ค่าเริ่มต้นคือซ้ายล่าง ซึ่งทับไอคอนล่างสุดของแถบซ้าย ส่วนขวาล่างเป็นที่ของปุ่มข้อความ
  devIndicators: { position: 'top-right' },

  /// ส่งต่อ API และสามเส้นของ SSO ไปหลังบ้าน (auth-contract.md ข้อ 5)
  ///
  /// คืนเป็น array = afterFiles: เช็กหน้าและไฟล์ใน public ก่อน — ไม่มีหน้าใดของ
  /// เราอยู่ใต้ /api หรือ /auth จึงไม่ชนกัน · ต้องไม่มี proxy.ts มาดัก /auth/*
  /// ก่อน เพราะ proxy ทำงานก่อน rewrite (docs rewrites.md ลำดับการทำงาน)
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
      { source: "/auth/login", destination: `${BACKEND_URL}/auth/login` },
      { source: "/auth/callback", destination: `${BACKEND_URL}/auth/callback` },
      { source: "/auth/logout", destination: `${BACKEND_URL}/auth/logout` },
    ];
  },

  turbopack: {
    /// รากของ workspace ไม่ใช่โฟลเดอร์ของหน้าบ้าน
    ///
    /// Turbopack ใช้ค่านี้เป็นขอบเขตการหา module และ **ไม่คอมไพล์ไฟล์ที่อยู่
    /// นอกราก** ในโครงแบบ pnpm workspace ตัว `next` จริงอยู่ที่
    /// `<ราก>/node_modules/.pnpm/…` ซึ่งอยู่เหนือโฟลเดอร์นี้ขึ้นไปหนึ่งชั้น
    ///
    /// เดิมตั้งเป็น `__dirname` ตอนที่หน้าบ้านยังอยู่ที่รากของ repo พอย้าย
    /// เข้ามาใน `frontend/` ตาม repo-structure.md ค่านั้นกลายเป็นการขังตัวเอง
    /// ไว้ใต้ `frontend/` แล้ว build ล้มด้วย "Could not find the Next.js package"
    ///
    /// ปกติ Next หารากเองได้จาก `pnpm-lock.yaml` (ดู docs `turbopack.md`
    /// หัวข้อ root directory) แต่ระบุให้ชัดไว้ดีกว่า เพราะเครื่องพัฒนาบางเครื่อง
    /// มี `package.json` หลงอยู่ใน `C:\Users\<ชื่อ>` ซึ่งทำให้เดารากผิด
    root: WORKSPACE_ROOT,
  },
};

export default nextConfig;
