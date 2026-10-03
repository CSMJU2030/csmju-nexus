import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../src/auth/auth.module.js';
import { CoreHubJwtGuard } from '../src/auth/core-hub-jwt.guard.js';
import { CoreHubTokenVerifier } from '../src/auth/core-hub-token.verifier.js';
import { PREFIX_EXCLUDE } from '../src/bootstrap.js';
import { EnvelopeInterceptor } from '../src/common/http/envelope.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';

/// เทสต์กับ **Core Hub ตัวจริง** ไม่ใช่กุญแจที่เราสร้างเอง
///
/// `auth-sso.e2e-spec.ts` สร้างคู่กุญแจในเทสต์แล้วเซ็น token เอง ซึ่งพิสูจน์ได้
/// แค่ว่า "ตัวตรวจของเราสอดคล้องกับตัวเซ็นของเราเอง" — ถ้าเราเข้าใจสัญญาผิด
/// ทั้งสองฝั่งจะผิดเหมือนกันและเทสต์ยังเขียว ไฟล์นี้ปิดช่องว่างนั้น:
///
///   • token เซ็นโดย `csmju-core-hub` ด้วยกุญแจส่วนตัวที่เราไม่เคยเห็น
///   • กุญแจสาธารณะดึงจาก JWKS ของเขาผ่าน HTTP จริง
///   • เราเป็นฝ่ายตรวจอย่างเดียว ไม่ได้มีส่วนในการสร้าง token เลย
///
/// **ข้ามอัตโนมัติเมื่อ Core Hub ไม่ได้รันอยู่** จึงไม่ทำให้ CI แดงบนเครื่อง
/// ที่ไม่มีมัน การข้ามจะพิมพ์บอกด้วย ไม่ใช่เงียบหายไปเฉย ๆ
///
/// วิธีรันเต็ม (ดู docs/ต่อกับ-core-hub.md):
///   1. สตาร์ต csmju-core-hub ที่ :3000 พร้อม seed
///   2. ลงทะเบียน csmju-nexus + approve + activate
///   3. pnpm --filter backend test:e2e

const CORE_HUB = process.env.CORE_HUB_URL ?? 'http://localhost:3000';
const CORE_API = `${CORE_HUB}/api/v1`;
const SUBSYSTEM = process.env.SUBSYSTEM_ID ?? 'csmju-nexus';

/// vitest **ไม่ได้โหลด `.env` ให้** (ไม่มี dotenv ใน vitest.config.e2e.ts)
/// ถ้าไม่ตั้งตรงนี้ `authConfig()` จะได้ `coreHubUrl = ''` แล้ว `jwksUrl`
/// กลายเป็น path เปล่า ๆ `/api/v1/.well-known/jwks.json` ซึ่ง fetch ไปไม่ถึงไหน
/// ผลคือ token ที่ถูกต้องก็ถูกปฏิเสธ — 401 ที่ดูเหมือนตัวตรวจทำงาน
/// ทั้งที่จริงคือมันไม่เคยได้กุญแจมาเลย
///
/// ตั้งเป็นค่าเดียวกับ `.env.example` และเขียนทับเสมอ เพื่อให้ผลเทสต์ไม่ขึ้นกับ
/// ว่าเครื่องที่รันตั้ง env ไว้ว่าอย่างไร
process.env.CORE_HUB_URL = CORE_HUB;
process.env.CORE_HUB_JWKS_URL = `${CORE_API}/.well-known/jwks.json`;
process.env.CORE_HUB_ISSUER = 'core-hub';
process.env.CORE_HUB_AUDIENCE = 'csmju2030';
process.env.SUBSYSTEM_ID = SUBSYSTEM;
process.env.CORE_HUB_WEB_URL = process.env.CORE_HUB_WEB_URL ?? 'http://127.0.0.1:3100';

const SESSION_COOKIE = `${SUBSYSTEM.replace(/-/g, '_')}_access_token`;
const STATE_COOKIE = `${SUBSYSTEM.replace(/-/g, '_')}_sso_state`;

/// บัญชีจาก `prisma/seed.ts` ของ Core Hub — เป็นบัญชี development ที่เขา
/// ประกาศไว้ใน README ข้อ 7 ไม่ใช่รหัสผ่านจริงของใคร
const SEED_ACCOUNTS = [
  { email: 'student@core.local', password: 'password2', core: 'student', ours: 'GUEST' },
  { email: 'staff@core.local', password: 'password3', core: 'staff', ours: 'EDITOR' },
  { email: 'admin@core.local', password: 'password1', core: 'admin', ours: 'ADMIN' },
] as const;

let app: INestApplication;

/// เริ่มที่ /auth/login แบบเบราว์เซอร์ (SSO 1.1) — คืน state กับคู่คุกกี้ state
/// เพื่อให้ callback ผ่านด่าน state แล้วไปถึงการตรวจ token จริง
async function beginLogin(): Promise<{ state: string; cookie: string }> {
  const response = await request(app.getHttpServer()).get('/auth/login');
  const state = new URL(response.headers.location).searchParams.get('state') ?? '';
  const raw = response.headers['set-cookie'] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(`${STATE_COOKIE}=`))!.split(';')[0];

  return { state, cookie };
}
let reachable = false;
let skipReason = '';

/// token ที่ Core Hub ออกให้ แยกตาม core role
const ssoTokens = new Map<string, string>();

async function coreLogin(email: string, password: string): Promise<string> {
  const response = await fetch(`${CORE_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as {
    success?: boolean;
    data?: { access_token?: string };
  };

  const token = body?.data?.access_token;

  if (!token) {
    throw new Error(
      `login ${email} ล้มเหลว (${response.status}) — seed ฐานข้อมูล Core Hub แล้วหรือยัง`,
    );
  }

  return token;
}

/// ขอ token สำหรับระบบย่อยเรา ผ่านเส้นทางเดียวกับที่เบราว์เซอร์จริงใช้
async function ssoHandoff(coreToken: string): Promise<string> {
  const response = await fetch(
    `${CORE_API}/auth/sso/handoff?subsystem=${encodeURIComponent(SUBSYSTEM)}`,
    { headers: { Authorization: `Bearer ${coreToken}` } },
  );

  const body = (await response.json()) as {
    success?: boolean;
    data?: { access_token?: string };
    error?: { message?: string };
  };

  if (!body?.data?.access_token) {
    throw new Error(
      `handoff ล้มเหลว (${response.status}): ${body?.error?.message ?? 'ไม่ทราบสาเหตุ'}` +
        ` — ลงทะเบียน "${SUBSYSTEM}" แล้ว approve + activate หรือยัง`,
    );
  }

  return body.data.access_token;
}

/// ตรวจว่า Core Hub อยู่ไหม **ตอนโหลดไฟล์** ไม่ใช่ใน `beforeAll`
///
/// ต่างกันตรงที่ `describe.skipIf()` ต้องรู้คำตอบตั้งแต่ตอนลงทะเบียนเทสต์
/// ถ้าไปตรวจใน `beforeAll` แล้วใช้ `if (!reachable) return` ในแต่ละเคส
/// รายงานจะขึ้นว่า **"8 passed"** ทั้งที่ไม่ได้ตรวจอะไรเลยสักข้อ —
/// เทสต์เขียวหลอกแบบนั้นแย่กว่าไม่มีเทสต์ เพราะมันบอกว่าปลอดภัยแล้ว
/// แบบนี้จะขึ้นว่า "8 skipped" ตามจริง
try {
  const probe = await fetch(`${CORE_API}/.well-known/jwks.json`, {
    signal: AbortSignal.timeout(3000),
  });

  if (!probe.ok) {
    skipReason = `JWKS ตอบ ${probe.status}`;
  } else {
    for (const account of SEED_ACCOUNTS) {
      const core = await coreLogin(account.email, account.password);
      ssoTokens.set(account.core, await ssoHandoff(core));
    }

    reachable = true;
  }
} catch (error) {
  skipReason = error instanceof Error ? error.message : String(error);
}

if (!reachable) {
  console.warn(
    `\n  ⚠ ข้ามเทสต์ชุด "Core Hub ตัวจริง" — ${skipReason}` +
      `\n    ตั้งใจให้ข้าม ไม่ใช่ล้มเหลว · วิธีเปิดใช้: docs/ต่อกับ-core-hub.md\n`,
  );
}

beforeAll(async () => {
  if (!reachable) return;

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  }).compile();

  app = moduleRef.createNestApplication();

  // ชุดเดียวกับของจริง แต่ไม่เอา global guard ของ Gateway มาด้วย เพราะมัน
  // ต้องใช้ PrismaService · `PREFIX_EXCLUDE` นำเข้ามาจาก bootstrap ไม่พิมพ์ซ้ำ
  // ถ้าค่าหลุดจากกันเมื่อไหร่ เทสต์ชุดนี้จะแดงทันที

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
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe.skipIf(!reachable)('Core Hub ตัวจริง — JWKS', () => {
  it('ตอบเป็น RFC 7517 ดิบ ไม่ห่อ envelope', async () => {
    const response = await fetch(`${CORE_API}/.well-known/jwks.json`);
    const body = (await response.json()) as Record<string, unknown>;

    // ห่อ envelope เมื่อไหร่ jose จะอ่านไม่ออก และทุกระบบย่อยพังพร้อมกัน
    expect(Object.keys(body)).toEqual(['keys']);
    expect(body).not.toHaveProperty('success');
  });

  it('กุญแจเป็น RSA/RS256 kid=core-hub-2026 และไม่มีส่วนลับติดมา', async () => {
    const response = await fetch(`${CORE_API}/.well-known/jwks.json`);
    const { keys } = (await response.json()) as { keys: Record<string, unknown>[] };

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', kid: 'core-hub-2026', use: 'sig' });

    // `d` `p` `q` คือส่วนของกุญแจส่วนตัว — หลุดมาแปลว่าปลอม token ได้ทั้งแพลตฟอร์ม
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(keys[0]).not.toHaveProperty(secret);
    }
  });
});

describe.skipIf(!reachable)('Core Hub ตัวจริง — token ที่เขาเซ็น ผ่านตัวตรวจของเรา', () => {
  it('รูปร่าง token ตรงกับสัญญา auth-contract ข้อ 3', async () => {
    const token = ssoTokens.get('student')!;
    const [rawHeader, rawPayload] = token.split('.');
    const decode = (part: string) =>
      JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

    expect(decode(rawHeader)).toMatchObject({ alg: 'RS256', kid: 'core-hub-2026' });

    const payload = decode(rawPayload);

    expect(payload).toMatchObject({ iss: 'core-hub', aud: 'csmju2030' });
    for (const claim of ['sub', 'email', 'role', 'sid', 'iat', 'exp']) {
      expect(payload).toHaveProperty(claim);
    }

    // สัญญาบอก 15 นาที — เผื่อ 1 วินาทีสำหรับเวลาที่เดินระหว่างเซ็นกับอ่าน
    expect((payload.exp as number) - (payload.iat as number)).toBeCloseTo(900, -1);
  });

  it.each(SEED_ACCOUNTS.map((a) => [a.core, a.ours] as const))(
    'callback (มี state ตรงกับคุกกี้) รับ token จริงของ %s แล้วแปลงเป็น %s',
    async (core, ours) => {
      const login = await beginLogin();
      const response = await request(app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', login.cookie)
        .query({ access_token: ssoTokens.get(core)!, token_type: 'Bearer', state: login.state });

      expect(response.status).toBe(302);

      const cookies = response.headers['set-cookie'] as unknown as string[] | undefined;
      const session = cookies?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));

      expect(session).toMatch(/HttpOnly/i);

      const me = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Cookie', session!.split(';')[0]);

      expect(me.body.data.coreRole).toBe(core);
      expect(me.body.data.subsystemRole).toBe(ours);
    },
  );

  it('callback ไม่มี state (แบบกดจาก sidebar) → 302 /auth/login และไม่ตั้งคุกกี้', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/callback')
      .query({ access_token: ssoTokens.get('student')!, token_type: 'Bearer' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/auth/login');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('/api/v1/me รับทั้งคุกกี้และ Bearer ของ token จริง', async () => {
    const token = ssoTokens.get('staff')!;

    const viaBearer = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);

    expect(viaBearer.status).toBe(200);
    expect(viaBearer.body.data.subsystemRole).toBe('EDITOR');

    const viaCookie = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);

    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.data.id).toBe(viaBearer.body.data.id);
    expect(viaCookie.body.data.subsystemRole).toBe(viaBearer.body.data.subsystemRole);
  });
});

describe.skipIf(!reachable)('Core Hub ตัวจริง — token ที่ถูกดัดแปลงต้องไม่ผ่าน', () => {
  /// ทุกเคสสร้างจาก token จริง แล้วแก้ทีละส่วน — จึงต่างจาก token ที่ถูกต้อง
  /// เพียงจุดเดียว ถ้าเคสไหนผ่านได้ แปลว่าตัวตรวจไม่ได้ตรวจส่วนนั้นจริง
  function mutations(token: string): Array<[string, string]> {
    const [header, payload, signature] = token.split('.');
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;

    return [
      ['ลายเซ็นถูกแก้', `${header}.${payload}.${signature.slice(0, -4)}AAAA`],
      ['เลื่อนขั้นเป็น admin', `${header}.${b64({ ...claims, role: 'admin' })}.${signature}`],
      ['สวมรอยเป็นคนอื่น', `${header}.${b64({ ...claims, sub: 'user-001' })}.${signature}`],
      ['alg=none', `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`],
      [
        'alg=HS256',
        `${b64({ alg: 'HS256', typ: 'JWT', kid: 'core-hub-2026' })}.${payload}.${signature}`,
      ],
      ['kid ที่ไม่มีใน JWKS', `${b64({ alg: 'RS256', typ: 'JWT', kid: 'ของปลอม' })}.${payload}.${signature}`],
      ['iss ผิด', `${header}.${b64({ ...claims, iss: 'evil' })}.${signature}`],
      ['aud ผิด', `${header}.${b64({ ...claims, aud: 'another-app' })}.${signature}`],
      [
        'หมดอายุแล้ว',
        `${header}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) - 3600 })}.${signature}`,
      ],
      ['ไม่ใช่ JWT', 'ขยะ'],
    ];
  }

  it('ทุกแบบได้ 401 และ **ไม่มีคุกกี้ session ติดกลับไป** (state ถูกต้อง)', async () => {
    for (const [label, token] of mutations(ssoTokens.get('student')!)) {
      const login = await beginLogin();
      const response = await request(app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', login.cookie)
        .set('Accept', 'application/json')
        .query({ access_token: token, state: login.state });

      expect(response.status, label).toBe(401);

      // ข้อสำคัญที่สุดของทั้งไฟล์: ตั้งคุกกี้ก่อนตรวจเมื่อไหร่ ใครก็ยิง
      // /auth/callback?access_token=อะไรก็ได้ แล้วได้ session ติดมือกลับไป
      // (มีได้แค่คุกกี้ที่ลบ state ซึ่งตั้งก่อนตรวจตามข้อ 5.1)
      const cookies = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];

      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`)), label).toBe(false);
    }
  });
});
