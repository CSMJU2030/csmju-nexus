import { Injectable } from '@nestjs/common';
import { decodeProtectedHeader, errors, jwtVerify } from 'jose';
import {
  authConfig,
  MAX_TOKEN_LIFETIME_SEC,
  TOKEN_LIFETIME_TOLERANCE_SEC,
} from './auth.config.js';
import { JwksService } from './jwks.service.js';

/// core role ของ Core Hub (Layer 1) — รายการปิด 6 ค่าตาม authorization.md ข้อ 2
/// (`lecturer` กับ `guest` เพิ่มใน standards 1.6.0 / 1.0.6) ห้ามเพิ่มค่าเอง
///
/// token ที่ผ่านการตรวจครบ 10 ขั้นแต่ role อยู่นอกรายการนี้ **ไม่ใช่ token เสีย**
/// แต่เป็น "รู้ว่าเป็นใครแล้ว แต่ระบบนี้ไม่รับ" → 403 (auth-contract.md ข้อ 8)
export const CORE_ROLES = [
  'student',
  'alumni',
  'staff',
  'lecturer',
  'guest',
  'admin',
] as const;
export type CoreRole = (typeof CORE_ROLES)[number];

/// ตัวตนที่ผ่านการตรวจลายเซ็นแล้ว — **แหล่งความจริงเดียวของระบบ**
///
/// `coreUserId` คือค่า `sub` จาก token (data-dictionary.md ข้อ 1.1)
/// ชื่ออื่นที่สื่อความหมายเดียวกันถูกกฎ DD-01 ห้ามไว้ทั้งหมด
///
/// สังเกตว่าไม่มี `username` และไม่มี `faculty` — สองค่านั้น **ไม่ได้อยู่ใน
/// token** (data-dictionary.md ข้อ 1.2 และ 1.3) ใครอยากได้ต้องไปถาม Core Hub
/// เป็นรายครั้ง ไม่ใช่สมมติว่ามีติดมากับตัวตน
///
/// ยืนยันกับ Core Hub ตัวจริงแล้วเมื่อ 27 ก.ย. 2569: `GET /api/v1/users/:id`
/// คืนแค่ id/email/role ส่วนชื่อจริงอยู่ในตาราง `Person` ซึ่งระบบย่อยโดน 403
export interface CoreHubUser {
  coreUserId: string;
  email: string;
  coreRole: CoreRole;
}

/// ผลการตรวจ — ตัวตน **และ** เวลาหมดอายุของ token
///
/// แยก `expiresAtMs` ออกมาจาก `user` โดยเจตนา เพราะมันไม่ใช่คุณสมบัติของคน
/// แต่เป็นคุณสมบัติของ "ใบผ่าน" ใบนี้ ที่ /auth/callback ต้องใช้กำหนดอายุคุกกี้
/// ให้ไม่ยาวกว่าตัว token (auth-contract.md ข้อ 5.1)
///
/// ถ้ายัดรวมเข้าไปใน CoreHubUser มันจะไหลไปโผล่ในที่ที่ไม่ควรอยู่ เช่น
/// response ของ /api/v1/me ซึ่งสัญญากำหนดไว้แค่ 4 ฟิลด์
export interface VerifiedToken {
  user: CoreHubUser;
  expiresAtMs: number;
  /// กุญแจที่ใช้ตรวจ — log ได้ (ไม่ใช่ความลับ) ต่างจากตัว token
  kid: string;
}

/// เหตุผลที่ปฏิเสธ — รายการปิดตาม contracts/log-events.json `failureReasons`
/// ใช้ชื่อตรงตามนั้นเพื่อให้ log ของทุกระบบย่อยค้นด้วยคำเดียวกันได้
export type RejectionReason =
  | 'missing_token'
  | 'malformed_token'
  | 'unsupported_algorithm'
  | 'missing_kid'
  | 'unknown_kid'
  | 'jwks_unavailable'
  | 'invalid_signature'
  | 'expired'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'invalid_claims'
  | 'token_lifetime_exceeded'
  | 'invalid_azp';

/// เหตุผลของ callback ที่ state ไม่ผ่าน (logging.md ข้อ 2) — ใช้กับ
/// `jwt.verification.failure` ที่ path = /auth/callback เท่านั้น
export type SsoStateRejectionReason =
  | 'sso_restart_without_state'
  | 'sso_state_missing'
  | 'sso_state_mismatch';

export class TokenRejected extends Error {
  constructor(
    readonly reason: RejectionReason,
    readonly kid: string | null = null,
  ) {
    super(reason);
    this.name = 'TokenRejected';
  }
}

/// token ผ่านครบ 10 ขั้น แต่ role ไม่อยู่ใน role mapping ของระบบนี้
///
/// แยกจาก `TokenRejected` โดยเจตนา เพราะคำตอบต่างกัน: token เสีย = 401
/// ส่วนนี่คือรู้ตัวตนแล้วแต่ไม่มีสิทธิ์ = **403** (auth-contract.md ข้อ 5.1 · 8)
export class RoleNotMapped extends Error {
  constructor(
    readonly sub: string,
    readonly coreRole: string,
  ) {
    super('role_not_mapped');
    this.name = 'RoleNotMapped';
  }
}

/// ตรวจ access token ของ Core Hub ครบ 10 ขั้นตามสัญญา (auth-contract.md ข้อ 4)
///
/// ขั้น 9 (อายุ token) กับ 10 (`azp`) เพิ่มใน auth-contract 1.2 / standards 1.7.0
/// conformance ทดสอบสองขั้นนี้ไม่ได้ จึงมีเทสต์ของเราเองครอบไว้
///
/// ทุกขั้นที่ไม่ผ่าน = 401 เสมอ ไม่มีขั้นไหนที่ "ผ่อนผันตอน dev" ได้
/// (ข้อห้ามข้อ 8) — โหมดพัฒนาที่ข้ามการตรวจคือช่องโหว่ที่หลุดขึ้น production
/// ได้ง่ายที่สุด เพราะมันไม่ทำให้อะไรพัง มันแค่ทำให้ทุกคนเป็นใครก็ได้
@Injectable()
export class CoreHubTokenVerifier {
  constructor(private readonly jwks: JwksService) {}

  async verify(token: string): Promise<VerifiedToken> {
    // ── ขั้น 1: ต้องมี token ─────────────────────────────────────────────
    if (!token || token.trim() === '') {
      throw new TokenRejected('missing_token');
    }

    // ── ขั้น 2: ถอด header เพื่ออ่าน alg และ kid (ยังไม่เชื่อ payload) ──
    let header: ReturnType<typeof decodeProtectedHeader>;

    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new TokenRejected('malformed_token');
    }

    // ── ขั้น 3: บังคับ RS256 ────────────────────────────────────────────
    //
    // ด่านนี้คือตัวที่กัน `alg: none` และ HS256 ซึ่งเป็นการโจมตีคลาสสิกที่สุด
    // สองแบบกับ JWT — ผู้โจมตีสร้าง token เองแล้วอ้างว่าไม่ต้องมีลายเซ็น
    // หรือเซ็นด้วย public key ที่เผยแพร่อยู่แล้วโดยใช้มันเป็น shared secret
    //
    // ตรวจที่นี่ครั้งหนึ่ง และส่ง allow-list ให้ jwtVerify ซ้ำอีกชั้นข้างล่าง
    // (ข้อ 4 ขั้น 5 สั่งให้ระบุซ้ำ) เพราะด่านเดียวพลาดได้ถ้าโค้ดถูกแก้ทีหลัง
    if (header.alg !== 'RS256') {
      throw new TokenRejected('unsupported_algorithm');
    }

    if (typeof header.kid !== 'string' || header.kid === '') {
      throw new TokenRejected('missing_kid');
    }

    // ── ขั้น 4: หากุญแจตาม kid ──────────────────────────────────────────
    const key = await this.jwks.keyFor(header.kid);

    if (!key) {
      throw new TokenRejected('unknown_kid', header.kid);
    }

    const { issuer, audience, clockToleranceSec, subsystemId } = authConfig();

    // ── ขั้น 5-7: ลายเซ็น · iss · aud · exp ────────────────────────────
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];

    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: ['RS256'],
        issuer,
        audience,
        clockTolerance: clockToleranceSec,
        // token ที่ไม่มี exp ไม่มีวันหมดอายุ — ขั้น 7 ต้องตกไม่ใช่ผ่านเงียบ ๆ
        requiredClaims: ['exp'],
      }));
    } catch (error) {
      throw new TokenRejected(reasonFor(error), header.kid);
    }

    // ── ขั้น 8: ต้องมี sub ที่ไม่ว่าง ───────────────────────────────────
    if (typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      throw new TokenRejected('invalid_claims', header.kid);
    }

    // ── ขั้น 9: อายุ token ไม่เกิน 15 นาที (+60 วินาที) ────────────────
    //
    // กัน refresh token (อายุ 7 วัน) ถูกส่งมาใช้แทน access token
    // ไม่มี iat = ไม่รู้อายุ จึงตกขั้นนี้ด้วย
    const exp = payload.exp as number;

    if (typeof payload.iat !== 'number') {
      throw new TokenRejected('token_lifetime_exceeded', header.kid);
    }

    if (exp - payload.iat > MAX_TOKEN_LIFETIME_SEC + TOKEN_LIFETIME_TOLERANCE_SEC) {
      throw new TokenRejected('token_lifetime_exceeded', header.kid);
    }

    // ── ขั้น 10: azp (ถ้ามี) ต้องเป็นชื่อระบบนี้ ─────────────────────────
    //
    // กัน token ที่ Core Hub ออกให้ระบบอื่นถูกนำมาใช้ที่นี่ · ตอนนี้ตรวจ
    // เฉพาะเมื่อมี — เวอร์ชันถัดไปของมาตรฐานจะบังคับให้ต้องมี
    if (payload.azp !== undefined && payload.azp !== subsystemId) {
      throw new TokenRejected('invalid_azp', header.kid);
    }

    const role = payload.role;

    if (typeof role !== 'string' || role.trim() === '') {
      throw new TokenRejected('invalid_claims', header.kid);
    }

    // ผ่านครบ 10 ขั้นแล้ว — role นอกรายการคือ "ไม่รับ" (403) ไม่ใช่ token เสีย
    if (!isCoreRole(role)) {
      throw new RoleNotMapped(payload.sub, role);
    }

    return {
      user: {
        coreUserId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
        coreRole: role,
      },
      // `exp` ผ่านการตรวจลายเซ็นมาแล้ว จึงเชื่อได้ — ต่างจาก `expires_in`
      // ที่ Core Hub ส่งมาใน query string ของ callback ซึ่งใครก็แก้ได้
      expiresAtMs: exp * 1000,
      kid: header.kid,
    };
  }
}

function isCoreRole(value: string): value is CoreRole {
  return (CORE_ROLES as readonly string[]).includes(value);
}

/// แปลง error ของ jose เป็นเหตุผลตามรายการปิดของสัญญา
///
/// ต้องแยกให้ละเอียดเพราะ log ของทุกระบบย่อยจะถูกเอาไปรวมกัน — ถ้าทุกอย่าง
/// กลายเป็น "invalid_signature" หมด เวลามีปัญหาจริงจะแยกไม่ออกว่า
/// นาฬิกาเครื่องเพี้ยน, กุญแจหมุนแล้วเราไม่รู้ หรือมีคนพยายามปลอม token
function reasonFor(error: unknown): RejectionReason {
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return 'invalid_signature';
  }

  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'iss') return 'invalid_issuer';
    // jose เจอ iat ที่ไม่ใช่ตัวเลข — ขั้น 9 ผ่านไม่ได้
    if (error.claim === 'iat') return 'token_lifetime_exceeded';
    if (error.claim === 'aud') return 'invalid_audience';

    return 'invalid_claims';
  }

  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
    return 'malformed_token';
  }

  return 'invalid_signature';
}
