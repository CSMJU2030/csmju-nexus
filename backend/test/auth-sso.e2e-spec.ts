import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/auth/auth.module.js';
import { CoreHubJwtGuard } from '../src/auth/core-hub-jwt.guard.js';
import { CoreHubTokenVerifier } from '../src/auth/core-hub-token.verifier.js';
import { JwksService } from '../src/auth/jwks.service.js';
import { EnvelopeInterceptor } from '../src/common/http/envelope.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { PREFIX_EXCLUDE } from '../src/bootstrap.js';

/// เทสต์เส้นทางบังคับของสัญญา SSO (auth-contract 1.2 · standards 1.7.0)
///
///   GET /api/v1/me      — conformance L1-08..16
///   GET  /auth/login     — conformance L3-16 · L3-17
///   GET  /auth/callback  — ทุกแถวของตาราง auth-contract.md ข้อ 5.1
///   POST /auth/logout    — conformance L3-22
///
/// **ไม่แตะฐานข้อมูลเลย** จึงรันได้โดยไม่ต้องเปิด docker — ตั้งใจให้เป็นแบบนั้น
/// เพราะชั้นยืนยันตัวตนไม่ควรต้องพึ่งฐานข้อมูล ถ้าวันหนึ่งมันเริ่มพึ่ง
/// แปลว่ามีคนเอาข้อมูลผู้ใช้ไปเก็บซ้ำ ซึ่งผิดข้อ 3 ของ data-dictionary

const ISSUER = 'core-hub';
const AUDIENCE = 'csmju2030';
const KID = 'core-hub-2026';

let app: INestApplication;
let hubKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let foreignKeys: Awaited<ReturnType<typeof generateKeyPair>>;

async function signToken(
  overrides: Record<string, unknown> = {},
  key?: KeyLike | Uint8Array,
) {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: 'staff@core.local',
    role: 'staff',
    sid: 's1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
    .setSubject((overrides.sub as string) ?? 'user-003')
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(key ?? hubKeys.privateKey);
}

beforeAll(async () => {
  hubKeys = await generateKeyPair('RS256');
  foreignKeys = await generateKeyPair('RS256');

  process.env.CORE_HUB_URL = 'http://core-hub.test';
  process.env.CORE_HUB_JWKS_URL = 'http://core-hub.test/api/v1/.well-known/jwks.json';
  process.env.CORE_HUB_ISSUER = ISSUER;
  process.env.CORE_HUB_AUDIENCE = AUDIENCE;
  process.env.JWKS_MIN_REFRESH_INTERVAL_MS = '0';
  process.env.CORE_HUB_WEB_URL = 'http://core-hub-web.test';
  process.env.SUBSYSTEM_ID = 'csmju-nexus';
  delete process.env.NODE_ENV;

  const jwk = await exportJWK(hubKeys.publicKey);

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] }),
    })),
  );

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  }).compile();

  app = moduleRef.createNestApplication();

  // ชุดเดียวกับของจริง: envelope + exception filter แต่ไม่เอา global guard
  // ของ Gateway มาด้วย เพราะมันต้องใช้ PrismaService

  // ด่านเดียวกับของจริง — `CoreHubJwtGuard` เป็น global guard ใน
  // bootstrap.ts แล้ว ไม่ได้ติดเฉพาะ route อีกต่อไป ถ้าไม่ติดตั้งที่นี่
  // `@CurrentUser()` จะไม่เจอตัวตนแล้วโยน error ออกมาเป็น 500
  //
  // ไม่เอา RolesGuard มาด้วยเพราะมันต้องใช้ PrismaService ซึ่งชุดนี้
  // ตั้งใจไม่ต่อฐานข้อมูล
  app.useGlobalGuards(
    new CoreHubJwtGuard(app.get(Reflector), app.get(CoreHubTokenVerifier)),
  );
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1', { exclude: PREFIX_EXCLUDE });

  await app.init();
});

beforeEach(() => {
  app.get(JwksService).resetForTesting();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('GET /api/v1/me', () => {
  it('token ถูกต้อง → 200 พร้อมสี่ฟิลด์ตาม contracts/openapi.yaml', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken()}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: 'user-003',
      email: 'staff@core.local',
      coreRole: 'staff',
      subsystemRole: 'EDITOR',
    });
    // auth-contract.md ข้อ 5: session.expiresAt (ISO 8601 จาก exp)
    expect(Date.parse(response.body.data.session.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('role mapping ตรงกับ subsystem.yaml ทั้งหกค่า', async () => {
    // ถ้าตารางนี้กับ default_role_mapping ในทะเบียนไม่ตรงกัน ผู้ใช้จะเข้าระบบได้
    // แต่กดอะไรไม่ได้เลย โดยไม่มี error ที่ไหนบอกสาเหตุ
    const expected = {
      student: 'GUEST',
      alumni: 'GUEST',
      staff: 'EDITOR',
      lecturer: 'EDITOR',
      guest: 'GUEST',
      admin: 'ADMIN',
    };

    for (const [coreRole, subsystemRole] of Object.entries(expected)) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('authorization', `Bearer ${await signToken({ role: coreRole })}`)
        .expect(200);

      expect(response.body.data.subsystemRole).toBe(subsystemRole);
    }
  });

  it('ไม่มี token → 401 UNAUTHORIZED', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('scheme ที่ไม่ใช่ Bearer → 401 (conformance L1-16)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);
  });

  it('token ที่เซ็นด้วยกุญแจอื่น → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken({}, foreignKeys.privateKey)}`)
      .expect(401);
  });

  it('รับ token ผ่านคุกกี้ได้ด้วย (auth-contract.md ข้อ 6)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', `csmju_nexus_access_token=${await signToken()}`)
      .expect(200);
  });

  it('มีทั้ง header และคุกกี้ → ใช้ header ก่อน', async () => {
    // สัญญาระบุลำดับนี้ไว้ตรง ๆ และสมเหตุสมผล เพราะ header คือสิ่งที่ผู้เรียก
    // ตั้งใจส่งมารอบนี้ ส่วนคุกกี้เบราว์เซอร์แนบให้เองโดยผู้เรียกไม่ได้เลือก
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken({ sub: 'from-header' })}`)
      .set('cookie', `csmju_nexus_access_token=${await signToken({ sub: 'from-cookie' })}`)
      .expect(200);

    expect(response.body.data.id).toBe('from-header');
  });

  it('role นอกรายการ → 403 FORBIDDEN ไม่ใช่ 401 (conformance L1-29)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${await signToken({ role: 'superuser' })}`)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('ไม่อ่านคุกกี้ของเว็บ Core Hub หรือชื่อคุกกี้เดิม (ข้อ 6)', async () => {
    const token = await signToken();

    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', `csmju_access_token=${token}; core_hub_access_token=${token}`)
      .expect(401);
  });

  it('ไม่มี error ภายในหลุดออกไปกับคำตอบ 401 (conformance L1-30)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', 'Bearer not-a-jwt');

    expect(response.text).not.toMatch(/stack|node_modules|PrismaClient/i);
  });
});

const STATE_COOKIE = 'csmju_nexus_sso_state';
const SESSION_COOKIE = 'csmju_nexus_access_token';

const cookiesOf = (response: request.Response): string[] => {
  const raw = response.headers['set-cookie'] as unknown;

  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
};

const cookieNamed = (response: request.Response, name: string) =>
  cookiesOf(response).find((entry) => entry.startsWith(`${name}=`));

/// มีการตั้งคุกกี้ session จริง (ไม่ใช่คุกกี้ลบ)
const setsSession = (response: request.Response) => {
  const entry = cookieNamed(response, SESSION_COOKIE);

  return Boolean(entry) && !/Max-Age=0/i.test(entry ?? '');
};

/// เริ่มการเข้าสู่ระบบแบบเบราว์เซอร์ — คืน state จาก Location และคู่คุกกี้ state
async function beginLogin(next?: string) {
  const response = await request(app.getHttpServer()).get(
    next === undefined ? '/auth/login' : `/auth/login?next=${encodeURIComponent(next)}`,
  );
  const location = new URL(response.headers.location);
  const stateCookie = cookieNamed(response, STATE_COOKIE) ?? '';

  return {
    response,
    location,
    state: location.searchParams.get('state') ?? '',
    cookie: stateCookie.split(';')[0],
    stateCookie,
  };
}

const callbackUrl = (token: string, state?: string) =>
  `/auth/callback?access_token=${token}&token_type=Bearer&expires_in=900` +
  (state === undefined ? '' : `&state=${encodeURIComponent(state)}`);

describe('GET /auth/login (auth-contract.md ข้อ 5.2)', () => {
  it('302 ไปเว็บ Core Hub /sso/authorize พร้อม subsystem และ state · ไม่ส่ง callback_url', async () => {
    const { response, location, state } = await beginLogin('/reels');

    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe('http://core-hub-web.test/sso/authorize');
    expect(location.searchParams.get('subsystem')).toBe('csmju-nexus');
    expect(location.searchParams.has('callback_url')).toBe(false);
    // ≥ 32 ไบต์ แบบ base64url = 43 ตัวอักษร
    expect(state).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('ตั้งคุกกี้ state แบบ HttpOnly · Lax · Path=/auth/callback · Max-Age ≤ 600 · ไม่ Secure นอก production', async () => {
    const { stateCookie, state } = await beginLogin('/reels');
    const maxAge = Number(/Max-Age=(\d+)/i.exec(stateCookie)?.[1]);

    expect(stateCookie.startsWith(`${STATE_COOKIE}=${state}.`)).toBe(true);
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/SameSite=Lax/);
    expect(stateCookie).toMatch(/Path=\/auth\/callback/);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(600);
    expect(stateCookie).not.toMatch(/Secure/);
  });

  it('production → คุกกี้ Secure', async () => {
    process.env.NODE_ENV = 'production';

    try {
      const { stateCookie } = await beginLogin();

      expect(stateCookie).toMatch(/Secure/);
    } finally {
      delete process.env.NODE_ENV;
    }
  });

  it('state ไม่ซ้ำกันทุกครั้ง', async () => {
    const first = await beginLogin();
    const second = await beginLogin();

    expect(first.state).not.toBe(second.state);
  });

  it('อยู่นอก prefix /api', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/login').expect(404);
  });
});

describe('GET /auth/callback — ตาราง auth-contract.md ข้อ 5.1', () => {
  it('ทุกคำตอบมี no-store และ Referrer-Policy: no-referrer', async () => {
    const responses = [
      await request(app.getHttpServer()).get('/auth/callback'),
      await request(app.getHttpServer()).get(callbackUrl(await signToken())),
      await request(app.getHttpServer()).get(callbackUrl(await signToken(), 'x')),
    ];

    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('ไม่มี access_token → 400', async () => {
    const response = await request(app.getHttpServer()).get('/auth/callback').expect(400);

    expect(response.body.success).toBe(false);
    expect(setsSession(response)).toBe(false);
  });

  it('ไม่มี state (กดจาก sidebar) → 302 /auth/login · ไม่ตั้งคุกกี้ใดเลย · ไม่แตะคุกกี้ state', async () => {
    const login = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken()))
      .set('cookie', login.cookie)
      .expect(302);

    expect(response.headers.location).toBe('/auth/login');
    // ห้ามมี Set-Cookie แม้แต่ตัวลบ state — แท็บอื่นอาจกำลังรอ callback ของตัวเอง
    expect(cookiesOf(response)).toEqual([]);
  });

  it('มี state แต่ไม่มีคุกกี้ state → 401 · ไม่ redirect · ไม่มีคุกกี้ session', async () => {
    const login = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken(), login.state))
      .set('accept', 'application/json')
      .expect(401);

    expect(response.headers.location).toBeUndefined();
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(setsSession(response)).toBe(false);
  });

  it('state ไม่ตรงกับคุกกี้ (คนละรอบ) → 401', async () => {
    const first = await beginLogin();
    const second = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken(), first.state))
      .set('cookie', second.cookie)
      .set('accept', 'application/json')
      .expect(401);

    expect(setsSession(response)).toBe(false);
  });

  it('state ไม่ผ่าน + เบราว์เซอร์ขอ text/html → หน้า HTML ภาษาไทยที่มีปุ่ม "เข้าสู่ระบบอีกครั้ง"', async () => {
    const login = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken(), login.state))
      .set('accept', 'text/html,application/xhtml+xml,*/*;q=0.8')
      .expect(401);

    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<a href="/auth/login">เข้าสู่ระบบอีกครั้ง</a>');
    expect(response.headers.location).toBeUndefined();
    expect(setsSession(response)).toBe(false);
  });

  it('มี state → เผาคุกกี้ state ทิ้งเสมอ แม้กรณีล้มเหลว (Path เดิม · Max-Age=0)', async () => {
    const first = await beginLogin();
    const second = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken(), first.state))
      .set('cookie', second.cookie)
      .set('accept', 'application/json');
    const removal = cookieNamed(response, STATE_COOKIE) ?? '';

    expect(removal).toMatch(/Max-Age=0/);
    expect(removal).toMatch(/Path=\/auth\/callback/);
  });

  it('state ตรง แต่ token ไม่ผ่านการตรวจ → 401 · ไม่มีคุกกี้ session', async () => {
    const login = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken({}, foreignKeys.privateKey), login.state))
      .set('cookie', login.cookie)
      .expect(401);

    expect(setsSession(response)).toBe(false);
  });

  it('state ตรง แต่ token อายุเกิน 15 นาที (ขั้น 9) → 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const refreshLike = await new SignJWT({ role: 'staff' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: KID })
      .setSubject('user-003')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 7 * 24 * 3600)
      .sign(hubKeys.privateKey);
    const login = await beginLogin();

    const response = await request(app.getHttpServer())
      .get(callbackUrl(refreshLike, login.state))
      .set('cookie', login.cookie)
      .expect(401);

    expect(setsSession(response)).toBe(false);
  });

  it('state ตรง แต่ azp เป็นของระบบอื่น (ขั้น 10) → 401', async () => {
    const login = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken({ azp: 'csmju-equipment' }), login.state))
      .set('cookie', login.cookie)
      .expect(401);

    expect(setsSession(response)).toBe(false);
  });

  it('state ตรง แต่ role ที่ระบบไม่รับ → 403 · ไม่มีคุกกี้ session', async () => {
    const login = await beginLogin();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken({ role: 'superuser' }), login.state))
      .set('cookie', login.cookie)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(setsSession(response)).toBe(false);
  });

  it('ผ่านทุกข้อ → คุกกี้ session (HttpOnly · Lax · Path=/ · Max-Age ≤ อายุ token) แล้ว 302 ไปหน้า next', async () => {
    const login = await beginLogin('/reels?id=7');
    const token = await signToken();
    const response = await request(app.getHttpServer())
      .get(callbackUrl(token, login.state))
      .set('cookie', login.cookie)
      .expect(302);
    const session = cookieNamed(response, SESSION_COOKIE) ?? '';
    const maxAge = Number(/Max-Age=(\d+)/i.exec(session)?.[1]);

    expect(response.headers.location).toBe('/reels?id=7');
    expect(session.startsWith(`${SESSION_COOKIE}=${token};`)).toBe(true);
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\/(;|$)/);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(900);
    expect(session).not.toMatch(/Secure/);
    // คุกกี้ state ถูกเผาในคำตอบเดียวกัน
    expect(cookieNamed(response, STATE_COOKIE)).toMatch(/Max-Age=0/);

    // คุกกี้ session อย่างเดียวเรียก /api/v1/me ได้ (conformance L3-10/11)
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', session.split(';')[0])
      .expect(200);

    expect(me.body.data.id).toBe('user-003');
  });

  it('next=//evil.example.com → ลงที่หน้า default ของระบบเอง (open redirect · L3-21)', async () => {
    const login = await beginLogin('//evil.example.com');
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken(), login.state))
      .set('cookie', login.cookie)
      .expect(302);

    expect(response.headers.location).toBe('/feed');
  });

  it('ตรวจ next ซ้ำตอน callback — คุกกี้ที่ถูกแก้ให้ชี้ออกนอกเว็บก็ยังลงที่หน้า default', async () => {
    const login = await beginLogin();
    const forged = `${STATE_COOKIE}=${login.state}.${Buffer.from('https://evil.example.com').toString('base64url')}`;
    const response = await request(app.getHttpServer())
      .get(callbackUrl(await signToken(), login.state))
      .set('cookie', forged)
      .expect(302);

    expect(response.headers.location).toBe('/feed');
  });

  it('อยู่นอก prefix /api', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?access_token=${await signToken()}`)
      .expect(404);
  });
});

describe('POST /auth/logout (auth-contract.md ข้อ 5 · 7)', () => {
  it('ลบคุกกี้ทั้งสองด้วย Path เดิม แล้ว 303 ไป {CORE_HUB_WEB_URL}/logout', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('cookie', `${SESSION_COOKIE}=${await signToken()}`)
      .expect(303);

    expect(response.headers.location).toBe('http://core-hub-web.test/logout');
    expect(response.headers['cache-control']).toBe('no-store');

    const session = cookieNamed(response, SESSION_COOKIE) ?? '';
    const state = cookieNamed(response, STATE_COOKIE) ?? '';

    expect(session).toMatch(/Max-Age=0/);
    expect(session).toMatch(/Path=\/(;|$)/);
    expect(state).toMatch(/Max-Age=0/);
    expect(state).toMatch(/Path=\/auth\/callback/);
  });

  it('ใช้ได้แม้ไม่มี token · ไม่ต้องมี content-type แบบ JSON (ฟอร์ม HTML)', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(303);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .type('form')
      .send('')
      .expect(303);
  });

  it('ไม่ส่ง token ไปที่ Core Hub (ตัวเดิมเรียก /api/v1/auth/logout ของ Core Hub)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('cookie', `${SESSION_COOKIE}=${await signToken()}`)
      .expect(303);

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('ตัวเดิมใต้ /api/v1 ถูกถอดออกแล้ว', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(404);
  });
});
