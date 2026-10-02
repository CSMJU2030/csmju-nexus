import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../common/auth/public.decorator.js';
import { authConfig } from './auth.config.js';
import { logAuthEvent } from './auth-events.js';
import {
  CoreHubTokenVerifier,
  RoleNotMapped,
  TokenRejected,
  type SsoStateRejectionReason,
  type VerifiedToken,
} from './core-hub-token.verifier.js';
import { safeNextPath } from './next-path.js';
import { subsystemRoleFor } from './role-mapping.js';
import {
  buildCookieRemoval,
  buildSessionCookie,
  buildStateCookie,
  createSsoState,
  readStateCookie,
  SSO_STATE_COOKIE_PATH,
  ssoCookieNames,
  timingSafeEqualString,
} from './sso-session.js';

/// path ที่ log แทน URL จริง — query ของ callback มี access token อยู่
const CALLBACK_PATH = '/auth/callback';

/// หน้าที่พาไปเมื่อไม่มี `next` ที่ใช้ได้ (หน้าแรกพาไป /feed อยู่แล้ว)
const DEFAULT_LANDING = '/feed';

/// สิ่งที่เบราว์เซอร์เห็นเมื่อ state ไม่ผ่าน (auth-contract.md ข้อ 5.1)
/// — ทางกลับเข้าระบบ ไม่ใช่ JSON ดิบ · ลิงก์เริ่มการเข้าสู่ระบบรอบใหม่
const SIGN_IN_AGAIN_PAGE = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>เข้าสู่ระบบไม่สำเร็จ · CS Nexus</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.6">
<h1>เข้าสู่ระบบไม่สำเร็จ</h1>
<p>การเข้าสู่ระบบครั้งนี้ไม่ได้เริ่มจากเบราว์เซอร์นี้ หรือใช้เวลาที่ Core Hub นานเกิน 10 นาที</p>
<p>ถ้าเปิดเว็บด้วย 127.0.0.1 ให้เปิดด้วย localhost แทน</p>
<p><a href="/auth/login">เข้าสู่ระบบอีกครั้ง</a></p>
</body>
</html>
`;

/// Central SSO ของระบบย่อย (auth-contract.md ข้อ 5 · standards 1.7.0)
///
///   GET  /auth/login     เริ่มทุกการเข้าสู่ระบบ · สร้าง state กัน login CSRF
///   GET  /auth/callback  URL ที่ลงทะเบียนไว้กับ Core Hub
///   POST /auth/logout    ลบคุกกี้ของระบบนี้ แล้วพาไปออกจาก Core Hub ทั้งหมด
///
/// ทั้งสามอยู่ **นอก** prefix `/api` และเป็น public · ไม่มีหน้าใดรับรหัสผ่าน
/// (รหัสผ่านกรอกที่ Core Hub เท่านั้น) · ทุกคำตอบมี `Cache-Control: no-store`
///
/// หน้าบ้าน (:3222) เป็นประตูเดียวของระบบ — rewrite สามเส้นนี้มาที่หลังบ้าน
/// คุกกี้ทั้งหมดจึงอยู่บน origin เดียวกับหน้าเว็บ (connect-core-hub.md ข้อ 1)
///
/// ทุก handler ปิด response เอง (`@Res()` ไม่ใช้ passthrough) Nest จึงไม่เขียน
/// คำตอบซ้ำหลัง redirect · กรณีที่โยน exception ให้ filter เขียน error envelope
/// header ที่ตั้งไว้ก่อนหน้า (no-store · Set-Cookie ลบ state) ยังอยู่ครบ
@ApiExcludeController() // ไม่ใช่ API ของโดเมน — เป็นทางเข้าของเบราว์เซอร์
@Controller('auth')
export class SsoController {
  constructor(private readonly verifier: CoreHubTokenVerifier) {}

  /// เริ่มการเข้าสู่ระบบ: สร้าง state ใช้ครั้งเดียว เก็บคู่กับหน้าที่จะกลับไป
  /// ในคุกกี้ที่มีแค่ callback ได้รับ แล้วส่งเบราว์เซอร์ไปเว็บของ Core Hub
  ///
  /// **ไม่ส่ง `callback_url`** — Core Hub redirect ไปที่ URL ในทะเบียนเท่านั้น
  /// และปฏิเสธ URL อื่นด้วย 400 อยู่แล้ว (conformance L3-15 · L3-16)
  @Public()
  @Get('login')
  login(@Query('next') next: unknown, @Res() response: Response): void {
    const { subsystemId, coreHubWebUrl, secureCookies } = authConfig();
    const names = ssoCookieNames(subsystemId);
    const state = createSsoState();
    const landing = safeNextPath(next) ?? DEFAULT_LANDING;

    const target = new URL(`${coreHubWebUrl}/sso/authorize`);

    target.searchParams.set('subsystem', subsystemId);
    target.searchParams.set('state', state);

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Set-Cookie',
      buildStateCookie(names.state, state, landing, secureCookies),
    );
    response.redirect(HttpStatus.FOUND, target.toString());
  }

  /// ปลายทางที่ Core Hub ส่งเบราว์เซอร์กลับมาพร้อม token — ตามตาราง 5.1 ตามลำดับ
  ///
  ///  - ไม่มี `access_token`            → 400
  ///  - ไม่มี `state` (กดจาก sidebar)   → ทิ้ง token · ไม่ตั้งคุกกี้ใดเลย
  ///                                     · ไม่แตะคุกกี้ state · 302 /auth/login
  ///  - มี state แต่ไม่มีคุกกี้/ไม่ตรง   → 401 ไม่ redirect (เบราว์เซอร์ที่ไม่เก็บ
  ///                                     คุกกี้จะวนไม่จบ) · ขอ HTML ได้หน้า "เข้าสู่ระบบอีกครั้ง"
  ///  - token ไม่ผ่าน 10 ขั้น          → 401
  ///  - role ที่ระบบนี้ไม่รับ           → 403
  ///  - ผ่านทุกข้อ                      → ตั้งคุกกี้ session · 302 ไปหน้า next ที่เก็บไว้
  ///
  /// ไม่มีกรณีล้มเหลวใดตั้งคุกกี้ session · ไม่ log URL หรือ header Cookie
  @Public()
  @Get('callback')
  async callback(
    @Req() request: Request,
    @Query('access_token') accessToken: unknown,
    @Query('state') state: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const { subsystemId, secureCookies } = authConfig();
    const names = ssoCookieNames(subsystemId);

    response.setHeader('Cache-Control', 'no-store');
    // หน้าถัดไปต้องไม่ได้ URL ที่มี token นี้ไปเป็น Referer
    response.setHeader('Referrer-Policy', 'no-referrer');

    // state ใช้ได้ครั้งเดียวไม่ว่าผลจะเป็นอย่างไร — ตั้งคุกกี้ลบไว้ **ก่อน**
    // ตรวจทุกอย่าง ทุกคำตอบที่มี state จึงเผาคุกกี้ state ทิ้งเสมอ
    // ไม่มี state = ไม่แตะ เพราะแท็บอื่นอาจกำลังรอ callback ของตัวเอง
    const hasState = state !== undefined;
    const stateRemoval = hasState
      ? buildCookieRemoval(names.state, SSO_STATE_COOKIE_PATH, secureCookies)
      : null;

    if (stateRemoval) response.setHeader('Set-Cookie', [stateRemoval]);

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      this.rejected('missing_token');

      throw new BadRequestException(['access_token ต้องไม่ว่าง']);
    }

    if (!hasState) {
      // กดชื่อระบบจาก sidebar ของ Core Hub — Core Hub เป็นคนเริ่ม จึงไม่มี
      // state ที่เราตรวจได้ ทิ้ง token แล้วเริ่มใหม่ที่ /auth/login ซึ่งจะ
      // กลับมาพร้อม state ของเราเอง ลิงก์ที่มี token ของผู้โจมตีจึงทำให้
      // เหยื่อได้ session ของผู้โจมตีไม่ได้
      this.rejected('sso_restart_without_state');
      response.redirect(HttpStatus.FOUND, '/auth/login');
      return;
    }

    const saved = readStateCookie(request.headers.cookie, names.state);
    const matches =
      saved !== null &&
      typeof state === 'string' &&
      timingSafeEqualString(saved.state, state);

    if (!matches) {
      this.rejected(saved ? 'sso_state_mismatch' : 'sso_state_missing');

      // สาเหตุที่พบบ่อย: อยู่ที่ Core Hub เกิน 10 นาที (ตั้งรหัสครั้งแรกของ
      // MJU SSO) หรือเปิดเว็บด้วย 127.0.0.1 แต่ลงทะเบียน localhost
      if (request.accepts(['json', 'html']) === 'html') {
        response
          .status(HttpStatus.UNAUTHORIZED)
          .type('html')
          .send(SIGN_IN_AGAIN_PAGE);
        return;
      }

      throw new UnauthorizedException(
        'การเข้าสู่ระบบนี้ไม่ได้เริ่มจากเบราว์เซอร์นี้ หรือใช้เวลานานเกินไป — เริ่มใหม่ที่ /auth/login',
      );
    }

    const verified = await this.verifyOrThrow(accessToken);
    const { user, expiresAtMs } = verified;

    // อายุคุกกี้ไม่ยาวกว่า token — คิดจาก `exp` ที่ผ่านลายเซ็น ไม่ใช่จาก
    // `expires_in` ใน query string ซึ่งใครก็แก้ได้ระหว่างทาง
    const maxAgeSec = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));

    response.setHeader('Set-Cookie', [
      stateRemoval as string,
      buildSessionCookie(names.session, accessToken, maxAgeSec, secureCookies),
    ]);

    logAuthEvent('log', 'jwt.verification.success', {
      sub: user.coreUserId,
      kid: verified.kid,
      coreRole: user.coreRole,
      subsystemRole: subsystemRoleFor(user.coreRole),
    });

    // หน้าปลายทางกลับมาจากคุกกี้ จึงตรวจซ้ำอีกครั้งก่อนใช้ (ข้อ 5.2)
    response.redirect(
      HttpStatus.FOUND,
      safeNextPath(saved.landing) ?? DEFAULT_LANDING,
    );
  }

  /// ออกจากระบบ **ทั้งหมด** — ลบคุกกี้ทั้งสองของระบบนี้ (Path เดิมของแต่ละตัว)
  /// แล้วพาไปหน้า `/logout` ของ Core Hub ให้ผู้ใช้ยืนยันการออกจาก Core Hub
  ///
  /// ออกแค่ระบบนี้ไม่พอ เพราะกดเข้าใหม่ Core Hub ที่ยังเข้าอยู่จะ SSO กลับมาทันที
  /// (auth-contract.md ข้อ 7) · public เพราะต้องใช้ได้แม้ token หมดอายุแล้ว
  ///
  /// แทนตัวเดิม (`POST /api/v1/auth/logout`) ที่ส่ง token ไปเพิกถอน session
  /// ที่ Core Hub เอง — สัญญา 1.1 ขึ้นไปให้ Core Hub เป็นคนจบ session ที่หน้า
  /// `/logout` ของมัน และ token ของผู้ใช้ห้ามถูกส่งไปที่ endpoint นอกรายการ (ข้อ 6.1)
  @Public()
  @Post('logout')
  logout(@Res() response: Response): void {
    const { subsystemId, coreHubWebUrl, secureCookies } = authConfig();
    const names = ssoCookieNames(subsystemId);

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [
      buildCookieRemoval(names.session, '/', secureCookies),
      buildCookieRemoval(names.state, SSO_STATE_COOKIE_PATH, secureCookies),
    ]);
    response.redirect(HttpStatus.SEE_OTHER, `${coreHubWebUrl}/logout`);
  }

  private async verifyOrThrow(token: string): Promise<VerifiedToken> {
    try {
      return await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof RoleNotMapped) {
        logAuthEvent('warn', 'authorization.role_mapping_failed', {
          sub: error.sub,
          coreRole: error.coreRole,
        });

        throw new ForbiddenException('บัญชีของคุณไม่มีสิทธิ์เข้าระบบนี้');
      }

      const rejected =
        error instanceof TokenRejected
          ? error
          : new TokenRejected('malformed_token');

      logAuthEvent('warn', 'jwt.verification.failure', {
        reason: rejected.reason,
        kid: rejected.kid,
        path: CALLBACK_PATH,
      });

      throw new UnauthorizedException('ตรวจสอบ token จาก Core Hub ไม่ผ่าน');
    }
  }

  private rejected(reason: SsoStateRejectionReason | 'missing_token'): void {
    logAuthEvent('warn', 'jwt.verification.failure', {
      reason,
      kid: null,
      path: CALLBACK_PATH,
    });
  }
}
