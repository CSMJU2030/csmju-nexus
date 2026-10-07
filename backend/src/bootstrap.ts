import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CoreHubJwtGuard } from './auth/core-hub-jwt.guard.js';
import { CoreHubTokenVerifier } from './auth/core-hub-token.verifier.js';
import { JwksService } from './auth/jwks.service.js';
import { RolesGuard } from './common/auth/roles.guard.js';
import { EnvelopeInterceptor } from './common/http/envelope.js';
import { RealtimeBus } from './common/realtime/realtime-bus.js';
import { RealtimeSyncInterceptor } from './common/realtime/sync.interceptor.js';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { PrismaService } from './common/prisma/prisma.service.js';

/// ตั้งค่าทุกอย่างที่ทำให้ response ตรงมาตรฐาน CSMJU2030
///
/// อยู่ในไฟล์แยกเพราะทั้ง main.ts และชุดทดสอบต้องใช้ชุดเดียวกัน ถ้าปล่อยให้
/// test ก๊อปการตั้งค่าไปเอง วันหนึ่งมันจะเพี้ยนจากของจริงแล้วชุดทดสอบจะผ่าน
/// ทั้งที่ production พัง
/// โดเมนของหน้าบ้านที่ยิงเข้ามาได้
///
/// dev: ยอม localhost ทุกพอร์ต เพราะ Next.js เลื่อนพอร์ตเองเมื่อ 3000 ไม่ว่าง
/// production: ต้องระบุ CORS_ORIGIN เท่านั้น — ไม่มีการยอมทุกโดเมนเด็ดขาด
function corsOrigin(): string[] | RegExp | boolean {
  const configured = process.env.CORS_ORIGIN?.trim();

  if (configured) {
    return configured.split(',').map((origin) => origin.trim());
  }

  if (process.env.NODE_ENV === 'production') {
    // ไม่ตั้ง CORS_ORIGIN บน production = ไม่ยอมให้เบราว์เซอร์ไหนยิงเข้ามา
    // ปลอดภัยกว่าการเผลอเปิดให้ทุกโดเมนอ่าน API ในนามผู้ใช้ที่ล็อกอินอยู่
    return false;
  }

  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
}

/// เส้นทางที่ต้องอยู่ **นอก** prefix /api/v1
///
///   /api/health     — ไม่มีเลขเวอร์ชัน เพราะตัวตรวจสถานะต้องเรียกได้เหมือนเดิม
///                     ตลอดไปแม้ API ธุรกิจจะขึ้น v2 (vocabulary.json)
///   /auth/login     — เริ่มทุกการเข้าสู่ระบบ (auth-contract.md ข้อ 5)
///   /auth/callback  — ต้องตรงกับ callback_url ที่ลงทะเบียนไว้กับ Core Hub
///   /auth/logout    — ออกจากระบบทั้งหมด (POST · 303 ไปเว็บ Core Hub)
///
/// **การเรียก `setGlobalPrefix` อยู่ที่ `main.ts` ไม่ใช่ที่นี่** ทั้งที่ของอื่น
/// ที่ทำให้ response ตรงมาตรฐานอยู่ในไฟล์นี้หมด — เพราะสคริปต์ `API-02` ของ
/// มาตรฐานอ่านเฉพาะ `backend/src/main.ts` ไฟล์เดียว ถ้าซ่อนไว้ที่นี่จะถูก
/// ตีตกทั้งที่ตั้ง prefix ถูกต้อง (แจ้ง standards ไว้แล้วในร่าง issue ข้อ 2.4)
///
/// ชุดทดสอบ e2e จึงต้องเรียก setGlobalPrefix เองด้วย โดยใช้ค่าคงที่ชุดนี้
/// ไม่ใช่พิมพ์ค่าซ้ำ — ถ้าค่าหลุดจากกัน เทสต์ที่ยิง /api/v1/... จะแดงทันที
export const GLOBAL_PREFIX = 'api/v1';
export const PREFIX_EXCLUDE = [
  'api/health',
  'auth/login',
  'auth/callback',
  'auth/logout',
];

/// ตั้ง prefix ให้ทุกทางที่สร้าง openapi.json ได้ผลเหมือนกัน
///
/// **บั๊กที่ตัวนี้แก้ (พบ 27 ก.ย. 2569):** `main.ts` ตั้ง prefix **ก่อน** สร้าง
/// เอกสาร Swagger แต่ `write-openapi.ts` กับ `check-openapi.ts` เรียกแค่
/// `configureApp()` ซึ่งไม่ได้ตั้ง — ไฟล์ที่ได้จากสองทางจึงต่างกัน:
///
///   บูตเซิร์ฟเวอร์จริง  →  "/api/v1/notifications"   (ตรงกับที่เสิร์ฟจริง)
///   pnpm run openapi   →  "/notifications"          (ขาด prefix)
///
/// ที่ commit ไว้คือแบบหลัง แปลว่า**ระบบย่อยอื่นที่อ่าน contract ของเรา
/// จะยิงผิด path ทุกเส้น** และ `openapi:check` ก็เทียบผิดกับผิดจนเขียว
/// ส่วน `check-openapi-sync.sh` ของมาตรฐานมองหา script ชื่อ `generate:openapi`
/// ซึ่งเราตั้งชื่อว่า `openapi` มันจึง **ข้ามมาตลอด** ไม่เคยจับได้เลย
export function applyGlobalPrefix(app: INestApplication): void {
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: PREFIX_EXCLUDE });
}

export function configureApp(app: INestApplication): void {
  /// เปิด CORS ให้หน้าบ้านคนละพอร์ตยิงเข้ามาได้
  ///
  /// **บั๊กที่ตัวนี้แก้:** เดิมไม่ได้เปิดเลย เบราว์เซอร์จึงบล็อกทุกคำขอจาก
  /// http://localhost:3000 ไป :4222 ด้วย "Failed to fetch" — และไม่มีเทสต์ไหน
  /// จับได้ เพราะ curl กับ node fetch ไม่บังคับ CORS จึงเห็น HTTP 200 ตลอด
  ///
  /// `allowedHeaders` ต้องระบุ header ตัวตนของ Gateway ให้ครบ เพราะ header
  /// ที่ไม่ใช่ชุดมาตรฐานต้องผ่าน preflight ก่อน — ขาดตัวใดตัวหนึ่งแล้วคำขอ
  /// ทั้งก้อนถูกบล็อกโดยไม่มี error ฝั่งเซิร์ฟเวอร์ให้เห็น
  app.enableCors({
    origin: corsOrigin(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // ไม่มี header ตัวตนอีกแล้ว — X-User-Id / X-Layer1-Role / X-Faculty
    // ถูกถอดออกพร้อมกับ API Gateway ที่สัญญา v1.0 บอกว่าไม่เคยมีอยู่จริง
    // เหลือ `authorization` สำหรับ Bearer และคุกกี้ที่เบราว์เซอร์แนบเอง
    allowedHeaders: ['content-type', 'authorization'],

    // REST ทั้งหมดมาทาง rewrite ของหน้าบ้าน (:3222 → :4222) จึงเป็น same-origin
    // แล้ว — CORS เหลือไว้ให้ socket.io ซึ่ง rewrite ของ Next ส่งต่อไม่ได้
    // และต่อตรงมาที่ :4222 · คุกกี้ `csmju_nexus_access_token` เป็น
    // host-only ของ localhost ซึ่งไม่แยกพอร์ต จึงติดมากับการจับมือของ socket ด้วย
    //
    // ผลข้างเคียงที่ต้องรู้: เปิดแล้วใช้ origin เป็น `*` ไม่ได้ —
    // corsOrigin() จึงต้องคืนรายการโดเมนหรือ RegExp เสมอ ห้ามคืน true
    credentials: true,
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // ปฏิเสธ field ที่ไม่อยู่ใน DTO ไม่ใช่แค่ตัดออกเงียบ ๆ
      // เพื่อไม่ให้ client ยัดค่าอย่าง ownerCoreUserId เข้ามาแล้วคิดว่ามันมีผล
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const reflector = app.get(Reflector);

  // ด่านแรกคือ "คุณเป็นใคร" — ตรวจลายเซ็น JWT ของ Core Hub ด้วยกุญแจจาก JWKS
  // ด่านที่สองคือ "คุณทำสิ่งนี้ได้ไหม" — สิทธิ์ Layer 2 ของระบบย่อยเอง
  //
  // เดิมด่านแรกคือ GatewayAuthGuard ซึ่งเชื่อ header `X-User-Id` ที่ใครยิงตรง
  // เข้าหลังบ้านก็ปลอมได้ และมีโหมด DEV_FAKE_GATEWAY ที่สร้างตัวตนขึ้นมาเอง
  // จาก env — ทั้งสองอย่างถูกลบทิ้งแล้ว ตัวตนมาจาก token ที่ Core Hub เซ็น
  // ทางเดียวเท่านั้น
  app.useGlobalGuards(
    new CoreHubJwtGuard(
      reflector,
      new CoreHubTokenVerifier(new JwksService()),
    ),
    new RolesGuard(reflector, app.get(PrismaService)),
  );
  // ซิงก์ทั้งเว็บ: เขียนสำเร็จแล้วบอกหน้าเว็บที่เปิดอยู่ให้ดึงใหม่ทันที (common/realtime/sync.interceptor.ts)
  app.useGlobalInterceptors(new EnvelopeInterceptor(), new RealtimeSyncInterceptor(app.get(RealtimeBus)));
  app.useGlobalFilters(new HttpExceptionFilter());
}
