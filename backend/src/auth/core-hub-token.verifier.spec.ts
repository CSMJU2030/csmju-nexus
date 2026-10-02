import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { JwksService } from './jwks.service.js';
import {
  CORE_ROLES,
  CoreHubTokenVerifier,
  RoleNotMapped,
  TokenRejected,
  type RejectionReason,
} from './core-hub-token.verifier.js';

/// เทสต์ชั้นตรวจ token ของ Core Hub
///
/// ชุดนี้คือหลักฐานว่าเราทำตาม auth-contract.md ข้อ 4 ครบ 10 ขั้นจริง
/// ไม่ใช่แค่เขียนโค้ดที่ "ดูเหมือนตรวจ" — ทุกเคสลบข้างล่างสะท้อนการโจมตี
/// ที่เกิดขึ้นจริงกับระบบที่ใช้ JWT และ conformance L1-17..27 ก็ยิงชุดเดียวกัน
///
/// **กุญแจทุกดอกสร้างขึ้นในเทสต์เอง** ไม่มีการอ่านกุญแจจริงของ Core Hub
/// มาไว้ใน repo (ข้อห้ามข้อ 3)

const ISSUER = 'core-hub';
const AUDIENCE = 'csmju2030';
const KID = 'core-hub-2026';

/// กุญแจของ "Core Hub" และกุญแจของ "ผู้โจมตี" — คนละดอกกัน
let hubKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let foreignKeys: Awaited<ReturnType<typeof generateKeyPair>>;

let jwks: JwksService;
let verifier: CoreHubTokenVerifier;
let fetchMock: ReturnType<typeof vi.fn>;

/// JWKS ที่ Core Hub ควรตอบ — RFC 7517 ดิบ ไม่มี envelope ครอบ (ข้อ 4.2)
async function publicJwks(kid = KID) {
  const jwk = await exportJWK(hubKeys.publicKey);

  return { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] };
}

function respondWith(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

/// สร้าง token ที่ถูกต้องทุกอย่าง แล้วให้แต่ละเคสไปบิดทีละจุด
async function signToken(
  overrides: Record<string, unknown> = {},
  options: { kid?: string; key?: KeyLike | Uint8Array } = {},
) {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: 'student@core.local',
    role: 'student',
    sid: 'session-1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: options.kid ?? KID })
    .setSubject((overrides.sub as string) ?? 'user-002')
    .setIssuer((overrides.iss as string) ?? ISSUER)
    .setAudience((overrides.aud as string) ?? AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(options.key ?? hubKeys.privateKey);
}

/// ยืนยันว่าถูกปฏิเสธ **ด้วยเหตุผลที่ถูกต้อง** ไม่ใช่แค่ "ไม่ผ่าน"
///
/// เหตุผลสำคัญเท่ากับการปฏิเสธ เพราะมันคือสิ่งที่ลงไปใน log แล้วคนที่ตาม
/// ปัญหาทีหลังต้องแยกออกว่า "นาฬิกาเพี้ยน" กับ "มีคนพยายามปลอม" คนละเรื่องกัน
async function expectRejected(token: string, reason: RejectionReason) {
  await expect(verifier.verify(token)).rejects.toThrow(TokenRejected);

  await verifier.verify(token).catch((error: unknown) => {
    expect((error as TokenRejected).reason).toBe(reason);
  });
}

beforeEach(async () => {
  hubKeys = await generateKeyPair('RS256');
  foreignKeys = await generateKeyPair('RS256');

  process.env.CORE_HUB_JWKS_URL = 'http://core-hub.test/api/v1/.well-known/jwks.json';
  process.env.CORE_HUB_ISSUER = ISSUER;
  process.env.CORE_HUB_AUDIENCE = AUDIENCE;
  process.env.JWKS_MIN_REFRESH_INTERVAL_MS = '0';

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  respondWith(await publicJwks());

  jwks = new JwksService();
  verifier = new CoreHubTokenVerifier(jwks);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('token ที่ถูกต้อง', () => {
  it('ผ่าน และคืนตัวตนตามที่ claim บอก', async () => {
    const { user } = await verifier.verify(await signToken());

    expect(user).toEqual({
      coreUserId: 'user-002',
      email: 'student@core.local',
      coreRole: 'student',
    });
  });

  it('ใช้ชื่อ coreUserId ตามที่ DD-01 บังคับ ไม่ใช่ชื่ออื่น', async () => {
    // กฎ DD-01 — Global Identity ต้องชื่อ coreUserId / coreUserId เท่านั้น
    // เทสต์นี้กันไม่ให้ใครเผลอเปลี่ยนชื่อกลับไปเป็น `username` ตอน refactor
    // (ชื่อนั้นยังผิดกว่าเดิมด้วย เพราะ token ไม่มี claim `username` เลย)
    const { user } = await verifier.verify(await signToken());

    expect(Object.keys(user).sort()).toEqual([
      'coreRole',
      'coreUserId',
      'email',
    ]);
  });

  it('คืนเวลาหมดอายุจาก exp ที่ผ่านลายเซ็นแล้ว', async () => {
    // /auth/callback ใช้ค่านี้กำหนดอายุคุกกี้ ถ้าไปอ่าน expires_in จาก
    // query string แทน ผู้โจมตีจะยืดอายุ session ของตัวเองได้เอง
    const { expiresAtMs } = await verifier.verify(await signToken());
    const expected = (Math.floor(Date.now() / 1000) + 900) * 1000;

    expect(Math.abs(expiresAtMs - expected)).toBeLessThan(5_000);
  });

  it('ยอมให้นาฬิกาเหลื่อมได้ตามที่ตั้งไว้', async () => {
    process.env.JWT_CLOCK_TOLERANCE_SEC = '60';

    const now = Math.floor(Date.now() / 1000);
    const justExpired = await new SignJWT({ role: 'staff', email: 'a@b.c' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
      .setSubject('user-003')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now - 950)
      .setExpirationTime(now - 30) // หมดอายุไป 30 วินาที ยังอยู่ในเกณฑ์ผ่อนผัน
      .sign(hubKeys.privateKey);

    await expect(verifier.verify(justExpired)).resolves.toMatchObject({
      user: { coreUserId: 'user-003' },
    });

    delete process.env.JWT_CLOCK_TOLERANCE_SEC;
  });
});

describe('token ที่ต้องถูกปฏิเสธ (auth-contract.md ข้อ 4)', () => {
  it('ไม่มี token', async () => {
    await expectRejected('', 'missing_token');
  });

  it('รูปแบบไม่ใช่ JWT', async () => {
    await expectRejected('not-a-jwt', 'malformed_token');
  });

  it('alg=none — token ที่ไม่มีลายเซ็นเลย', async () => {
    // การโจมตีคลาสสิกที่สุด: ประกาศว่า "ไม่ต้องตรวจลายเซ็นนะ" แล้วยัด role admin
    const b64 = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const token = `${b64({ alg: 'none', typ: 'JWT', kid: KID })}.${b64({
      sub: 'user-002',
      role: 'admin',
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 900,
    })}.`;

    await expectRejected(token, 'unsupported_algorithm');
  });

  it('HS256 — เซ็นด้วย secret แทนกุญแจส่วนตัว', async () => {
    // อันตรายเป็นพิเศษ: ถ้าระบบเผลอรับ HS256 ผู้โจมตีเอา public key ที่
    // เผยแพร่อยู่แล้วมาใช้เป็น secret เซ็น token ปลอมได้ทันที
    const crypto = await import('node:crypto');
    const b64 = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const head = b64({ alg: 'HS256', typ: 'JWT', kid: KID });
    const body = b64({
      sub: 'user-002',
      role: 'admin',
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const signature = crypto
      .createHmac('sha256', 'attacker-secret')
      .update(`${head}.${body}`)
      .digest('base64url');

    await expectRejected(`${head}.${body}.${signature}`, 'unsupported_algorithm');
  });

  it('ไม่มี kid ใน header', async () => {
    const token = await new SignJWT({ role: 'student', email: 'a@b.c' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setSubject('user-002')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('15m')
      .sign(hubKeys.privateKey);

    await expectRejected(token, 'missing_kid');
  });

  it('kid ที่ไม่รู้จัก แม้รีเฟรชแล้วก็ยังไม่เจอ', async () => {
    await expectRejected(
      await signToken({}, { kid: 'core-hub-2099' }),
      'unknown_kid',
    );
  });

  it('เซ็นด้วยกุญแจของคนอื่น', async () => {
    await expectRejected(
      await signToken({}, { key: foreignKeys.privateKey }),
      'invalid_signature',
    );
  });

  it('หมดอายุแล้ว', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'student', email: 'a@b.c' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
      .setSubject('user-002')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 600)
      .sign(hubKeys.privateKey);

    await expectRejected(token, 'expired');
  });

  it('ผู้ออก token ไม่ใช่ Core Hub', async () => {
    await expectRejected(await signToken({ iss: 'evil-hub' }), 'invalid_issuer');
  });

  it('ออกให้แพลตฟอร์มอื่น', async () => {
    await expectRejected(
      await signToken({ aud: 'another-platform' }),
      'invalid_audience',
    );
  });

  it('ไม่มี sub', async () => {
    const token = await new SignJWT({ role: 'student', email: 'a@b.c' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('15m')
      .sign(hubKeys.privateKey);

    await expectRejected(token, 'invalid_claims');
  });

  it('ไม่มี role หรือ role ว่าง = claim ผิดรูป (401)', async () => {
    await expectRejected(await signToken({ role: '' }), 'invalid_claims');
    await expectRejected(await signToken({ role: 42 }), 'invalid_claims');
  });

  it('role นอกรายการปิด 6 ค่า = รู้ตัวตนแต่ไม่รับ (403) ไม่ใช่ token เสีย', async () => {
    // 'faculty' ไม่ใช่ core role · token ผ่านครบ 10 ขั้น จึงต้องเป็น 403
    // ตาม auth-contract.md ข้อ 5.1/8 ไม่ใช่ 401
    const rejection = await verifier
      .verify(await signToken({ role: 'faculty' }))
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RoleNotMapped);
    expect((rejection as RoleNotMapped).coreRole).toBe('faculty');
    expect((rejection as RoleNotMapped).sub).toBe('user-002');
  });

  it('แก้ payload แต่ใช้ลายเซ็นเดิม', async () => {
    // ผู้ใช้จริงที่พยายามเลื่อนขั้นตัวเองเป็น admin โดยแก้แค่ payload
    const valid = await signToken({ role: 'student' });
    const [head, , signature] = valid.split('.');
    const escalated = Buffer.from(
      JSON.stringify({
        sub: 'user-002',
        role: 'admin',
        email: 'student@core.local',
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');

    await expectRejected(
      `${head}.${escalated}.${signature}`,
      'invalid_signature',
    );
  });
});

describe('JWKS (auth-contract.md ข้อ 4.1)', () => {
  it('ปฏิเสธ JWK ที่มีกุญแจส่วนตัวติดมา', async () => {
    // ถ้า Core Hub ตั้งค่าผิดแล้วเผยแพร่กุญแจส่วนตัว การ "รับไว้ใช้" เท่ากับ
    // เก็บกุญแจส่วนตัวของ Core Hub ไว้ในหน่วยความจำเรา ซึ่งข้อห้ามข้อ 3 ห้ามไว้
    const privateJwk = await exportJWK(hubKeys.privateKey);

    respondWith({ keys: [{ ...privateJwk, kid: KID, alg: 'RS256' }] });

    await expectRejected(await signToken(), 'unknown_kid');
  });

  it('ปฏิเสธกุญแจที่ไม่ใช่ RSA', async () => {
    const ec = await generateKeyPair('ES256');
    const ecJwk = await exportJWK(ec.publicKey);

    respondWith({ keys: [{ ...ecJwk, kid: KID, alg: 'ES256' }] });

    await expectRejected(await signToken(), 'unknown_kid');
  });

  it('ห่อ envelope มาแทน RFC 7517 ดิบ = ไม่มีกุญแจใช้ได้', async () => {
    // Core Hub ยกเว้น endpoint นี้จาก envelope โดยเจตนา (ข้อ 4.2)
    // ถ้าวันหนึ่งมีคนเผลอห่อ เราต้องไม่พังแบบเงียบ ๆ
    respondWith({ success: true, data: await publicJwks() });

    await expectRejected(await signToken(), 'unknown_kid');
  });

  it('Core Hub ล่ม แต่ยังใช้กุญแจที่แคชไว้ต่อได้', async () => {
    // ดึงสำเร็จรอบแรกเพื่อให้มีของในแคช
    await expect(verifier.verify(await signToken())).resolves.toBeTruthy();

    // แล้ว Core Hub ล่ม
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    process.env.JWKS_CACHE_TTL_MS = '0'; // บังคับให้ถือว่าแคชหมดอายุ

    // ระบบต้องไม่ล่มตาม — นี่คือข้อ 4.1 "ควรใช้กุญแจที่แคชไว้ต่อได้"
    await expect(verifier.verify(await signToken())).resolves.toMatchObject({
      user: { coreUserId: 'user-002' },
    });

    delete process.env.JWKS_CACHE_TTL_MS;
  });

  it('ไม่ทับกุญแจที่ใช้ได้ด้วยคำตอบที่ว่างเปล่า', async () => {
    await expect(verifier.verify(await signToken())).resolves.toBeTruthy();

    respondWith({ keys: [] });
    process.env.JWKS_CACHE_TTL_MS = '0';

    await expect(verifier.verify(await signToken())).resolves.toBeTruthy();

    delete process.env.JWKS_CACHE_TTL_MS;
  });

  it('จำกัดอัตราการรีเฟรช — kid มั่วรัว ๆ ต้องไม่กลายเป็นเครื่องถล่ม Core Hub', async () => {
    process.env.JWKS_MIN_REFRESH_INTERVAL_MS = '60000';

    jwks.resetForTesting();

    // ยิง 20 ครั้งด้วย kid ที่ไม่มีอยู่จริง
    for (let i = 0; i < 20; i += 1) {
      await verifier
        .verify(await signToken({}, { kid: `ghost-${i}` }))
        .catch(() => undefined);
    }

    // ต้องยิงหา Core Hub ครั้งเดียว ไม่ใช่ 20 ครั้ง
    expect(fetchMock).toHaveBeenCalledTimes(1);

    process.env.JWKS_MIN_REFRESH_INTERVAL_MS = '0';
  });
});

/// เซ็นด้วย iat/exp ที่กำหนดเอง — signToken ตั้งให้ถูกเสมอ ใช้ทดสอบขั้น 9 ไม่ได้
async function signLifetime(claims: { iat?: number; exp: number; azp?: string }) {
  let jwt = new SignJWT({
    email: 'student@core.local',
    role: 'student',
    ...(claims.azp === undefined ? {} : { azp: claims.azp }),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
    .setSubject('user-002')
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(claims.exp);

  if (claims.iat !== undefined) jwt = jwt.setIssuedAt(claims.iat);

  return jwt.sign(hubKeys.privateKey);
}

describe('ขั้น 9 — อายุ token (auth-contract 1.2 · standards 1.7.0)', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('ไม่มี iat → token_lifetime_exceeded', async () => {
    await expectRejected(await signLifetime({ exp: now() + 600 }), 'token_lifetime_exceeded');
  });

  it('อายุ 7 วันแบบ refresh token → token_lifetime_exceeded', async () => {
    const iat = now() - 10;

    await expectRejected(
      await signLifetime({ iat, exp: iat + 7 * 24 * 3600 }),
      'token_lifetime_exceeded',
    );
  });

  it('อายุ 900 + 60 วินาทีพอดียังผ่าน แต่เกิน 1 วินาทีไม่ผ่าน', async () => {
    const iat = now() - 10;

    await expect(verifier.verify(await signLifetime({ iat, exp: iat + 960 }))).resolves.toBeDefined();
    await expectRejected(await signLifetime({ iat, exp: iat + 961 }), 'token_lifetime_exceeded');
  });

  it('ไม่มี exp → ขั้น 7 ไม่ผ่าน', async () => {
    const token = await new SignJWT({ role: 'student' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
      .setSubject('user-002')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .sign(hubKeys.privateKey);

    await expectRejected(token, 'invalid_claims');
  });
});

describe('ขั้น 10 — azp (ถ้ามีต้องเป็นชื่อระบบนี้)', () => {
  const now = () => Math.floor(Date.now() / 1000);

  beforeEach(() => {
    process.env.SUBSYSTEM_ID = 'csmju-nexus';
  });

  it('ไม่มี azp → ผ่าน (ตอนนี้ยังไม่บังคับ)', async () => {
    await expect(
      verifier.verify(await signLifetime({ iat: now(), exp: now() + 900 })),
    ).resolves.toBeDefined();
  });

  it('azp เป็นชื่อระบบนี้ → ผ่าน', async () => {
    await expect(
      verifier.verify(
        await signLifetime({ iat: now(), exp: now() + 900, azp: 'csmju-nexus' }),
      ),
    ).resolves.toBeDefined();
  });

  it('azp เป็นระบบอื่น → invalid_azp', async () => {
    await expectRejected(
      await signLifetime({ iat: now(), exp: now() + 900, azp: 'csmju-equipment' }),
      'invalid_azp',
    );
  });
});

describe('core role ทั้ง 6 ค่า (authorization.md ข้อ 2)', () => {
  it('รายการปิดตรงกับสัญญา', () => {
    expect([...CORE_ROLES].sort()).toEqual(
      ['admin', 'alumni', 'guest', 'lecturer', 'staff', 'student'],
    );
  });

  it.each(CORE_ROLES)('%s ผ่านการตรวจ', async (role) => {
    const { user } = await verifier.verify(await signToken({ role }));

    expect(user.coreRole).toBe(role);
  });
});
