'use client';

import AuthSwitch from '@/components/ui/auth-switch';
import { loginHref } from '@/lib/csmju/session';

/// หน้าทางเข้าระบบ — **ไม่ใช่หน้ารับรหัสผ่าน**
///
/// Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า Login เอง และห้ามตรวจ session เอง
/// หน้านี้จึงไม่มีช่องกรอกรหัสผ่านแม้แต่ช่องเดียว — มันทำหน้าที่เดียวคือ
/// **ส่งผู้ใช้ไปล็อกอินที่ CSMJU2030 Core แล้วให้ Core ส่งกลับมา**
///
/// เหตุผลที่ต้องเป็นแบบนี้ ไม่ใช่แค่เรื่องทำตามกฎ:
/// ถ้า 36 ระบบย่อยต่างคนต่างมีช่องกรอกรหัสผ่าน รหัสของนักศึกษาจะไปโผล่อยู่
/// 36 ที่ ระบบย่อยไหนหลุดที่เดียวก็หลุดหมด และการเปลี่ยนรหัสครั้งเดียว
/// ต้องไปเปลี่ยน 36 รอบ — ศูนย์กลางตัวตนจึงต้องมีที่เดียวคือ Core
///
/// **ปลายทางยืนยันแล้ว** — อ่านจากโค้ดจริงของ `CSMJU2030/csmju-core-hub`
/// เมื่อ 27 ก.ย. 2569 และทดสอบวิ่งจริงครบวงจรแล้ว (`backend/test/core-hub-sso.e2e-spec.ts`)
///
/// ปลายทางคือ **SSO launcher** ของหน้าบ้าน Core Hub ไม่ใช่หน้า login ของมัน:
///
///   `<CORE_HUB_UI>/api/sso/csmju-nexus`
///
/// (`csmju-core-hub/frontend/app/api/sso/[subsystem]/route.ts`)
/// เส้นนี้ทำสองอย่างให้ในตัวเดียว จึงไม่ต้องแยกปุ่ม:
///
///   ยังไม่ล็อกอิน → เด้งไป `/login?next=/api/sso/csmju-nexus`
///   ล็อกอินแล้ว   → เรียก `GET /api/v1/auth/sso/handoff` ด้วยคุกกี้ session
///                    แล้วเด้งกลับมาที่ `callback_url` ที่ Registry ถือไว้
///
/// เหตุผลที่ต้องผ่าน launcher: เบราว์เซอร์แนบ `Authorization: Bearer` ไปกับ
/// การคลิกลิงก์ไม่ได้ แต่ `/auth/sso/authorize` ของ Core API บังคับให้มี
///
/// ค่าอยู่ใน `NEXT_PUBLIC_CORE_LOGIN_URL` (ดู frontend/.env.example)
/// ถ้ายังไม่ตั้ง ปุ่มจะปิดไว้พร้อมบอกเหตุผล แทนที่จะพาไปหน้าตาย

/// standards 1.7.0: ทุกการเข้าสู่ระบบเริ่มที่ `/auth/login` ของเราเอง (auth-contract.md ข้อ 5)
/// หลังบ้านสร้าง state กัน login CSRF แล้วส่งไปเว็บ Core Hub · กลับมาแล้วลงที่ /feed
const SIGN_IN_URL = loginHref('/feed');
const CORE_SIGNUP_URL = process.env.NEXT_PUBLIC_CORE_SIGNUP_URL ?? '';

export default function LoginPage() {
  return (
    // หน้าตาแบบหน้าเข้าสู่ระบบของ Core Hub — พื้นน้ำเงินไล่สี วงแสงฟุ้ง การ์ดขาวพร้อมโลโก้สาขา
    <main
      className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10"
      style={{ backgroundImage: 'var(--sidebar-gradient)' }}
    >
      <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-ring opacity-40 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-32 -right-16 size-96 rounded-full bg-primary opacity-50 blur-3xl" />

      <div className="relative w-full max-w-md rounded-2xl bg-card p-6 text-card-foreground shadow-csmju-lg sm:p-8">
        <header className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ใน public ไม่ต้องผ่านตัวย่อรูป */}
          <img
            src="/csmju-logo.png"
            alt="โลโก้ สาขาวิทยาการคอมพิวเตอร์ มหาวิทยาลัยแม่โจ้"
            width={720}
            height={428}
            className="mx-auto mb-4 h-20 w-auto object-contain"
          />

          <h1 className="font-heading text-2xl font-extrabold tracking-tight text-primary">CS Nexus</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ศูนย์กลางชุมชนของสาขาวิทยาการคอมพิวเตอร์ · CSMJU2030
          </p>
        </header>

        <AuthSwitch
          signInUrl={SIGN_IN_URL}
          // /auth/login ไม่รับ redirect_uri — Core Hub ส่งกลับไปที่ callback ในทะเบียนเท่านั้น
          callbackPath=""
          signUpUrl={CORE_SIGNUP_URL || undefined}
          className="max-w-none"
        />

      </div>
    </main>
  );
}
