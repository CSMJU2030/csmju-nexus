import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/auth/public.decorator.js';
import { authConfig } from './auth.config.js';
import { logAuthEvent } from './auth-events.js';
import {
  CoreHubTokenVerifier,
  RoleNotMapped,
  TokenRejected,
  type CoreHubUser,
} from './core-hub-token.verifier.js';
import { subsystemRoleFor } from './role-mapping.js';
import { readCookie, ssoCookieNames } from './sso-session.js';

/// ชื่อคุกกี้ session ของระบบนี้ — `<ชื่อระบบ>_access_token`
/// (auth-contract.md ข้อ 5.1 · contracts/vocabulary.json `ssoCookies.session`)
///
/// เป็นฟังก์ชันเพราะชื่อมาจาก `SUBSYSTEM_ID` ซึ่งชุดทดสอบสลับได้
/// conformance L3-09 หาคุกกี้ตามชื่อนี้ตรง ๆ
export function sessionCookieName(): string {
  return ssoCookieNames(authConfig().subsystemId).session;
}

export interface RequestWithCoreUser extends Request {
  coreUser?: CoreHubUser;
  /// เวลาหมดอายุของ token ที่ใช้กับคำขอนี้ — `/api/v1/me` คืนเป็น
  /// `session.expiresAt` ให้หน้าบ้านต่ออายุล่วงหน้าได้ (auth-contract.md ข้อ 5)
  coreSessionExpiresAtMs?: number;
}

/// ด่านแรกของทุก request — "คุณเป็นใคร"
///
/// token เสีย = **401** ทุกกรณี · token ดีแต่ role ไม่อยู่ใน mapping = **403**
/// (auth-contract.md ข้อ 8) — สลับสองอันนี้เมื่อไร conformance ตกทันที
@Injectable()
export class CoreHubJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: CoreHubTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket ไม่มี HTTP header ให้อ่านที่ชั้นนี้ — ตัวตนของ socket
    // ยืนยันตอนจับมือใน gateway ของมันเอง
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithCoreUser>();
    const token = extractToken(request);

    try {
      const { user, expiresAtMs, kid } = await this.verifier.verify(token);

      request.coreUser = user;
      request.coreSessionExpiresAtMs = expiresAtMs;

      logAuthEvent('debug', 'jwt.verification.success', {
        sub: user.coreUserId,
        kid,
        coreRole: user.coreRole,
        subsystemRole: subsystemRoleFor(user.coreRole),
      });

      return true;
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
          : new TokenRejected('invalid_signature');

      // log เหตุผล kid และ **path ไม่มี query** เท่านั้น — ห้าม log token,
      // header Authorization/Cookie หรือ URL เต็ม (log-events.json `mustNeverLog`)
      logAuthEvent('warn', 'jwt.verification.failure', {
        reason: rejected.reason,
        kid: rejected.kid,
        path: request.path,
      });

      throw new UnauthorizedException('ยืนยันตัวตนไม่สำเร็จ');
    }
  }
}

/// อ่าน token จากสองทางที่สัญญาอนุญาต (auth-contract.md ข้อ 6)
///
/// `Authorization` มาก่อนคุกกี้เสมอเมื่อมีทั้งคู่ · อ่านเฉพาะคุกกี้ของระบบนี้
/// — คุกกี้ `csmju_*` ของเว็บ Core Hub ที่ติดมาบน localhost ต้องไม่ถูกอ่าน
export function extractToken(request: Pick<Request, 'headers'>): string {
  const header = request.headers.authorization;

  if (typeof header === 'string') {
    // ต้องเป็น `Bearer` เท่านั้น — Basic หรือ scheme อื่นถือว่าไม่มี token
    // ไม่ใช่ token ที่ใช้ไม่ได้ (conformance L1-16 ตรวจข้อนี้)
    const [scheme, value] = header.split(/\s+/, 2);

    if (scheme?.toLowerCase() === 'bearer' && value) return value;

    return '';
  }

  return readCookie(request.headers.cookie, sessionCookieName()) ?? '';
}
