import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { exportJWK, importSPKI } from 'jose';
import { vi } from 'vitest';
import type { CoreRole } from '../src/auth/core-hub-token.verifier.js';

/// Core Hub จำลองสำหรับชุดทดสอบที่ไม่ต้องต่อเน็ต
///
/// **ไม่ใช่การ mock ชั้นยืนยันตัวตนของเรา** — ตัวตรวจ ตัวอ่านคุกกี้ และ guard
/// ทั้งหมดเป็นของจริงทุกบรรทัด สิ่งที่จำลองคือ *ผู้ออก token* เท่านั้น:
/// สร้างคู่กุญแจ RSA ขึ้นมาในหน่วยความจำ แล้วให้ JWKS ปล่อยกุญแจสาธารณะของมัน
///
/// token ที่ได้จึงเป็น token จริงที่ผ่านการตรวจลายเซ็นจริง ต่างจากของจริง
/// แค่ว่าใครเป็นคนถือกุญแจส่วนตัว
///
/// เทสต์ที่ยิงกับ Core Hub ตัวจริงอยู่ที่ `core-hub-live.e2e-spec.ts`
/// ซึ่งข้ามอัตโนมัติเมื่อไม่มีเซิร์ฟเวอร์ให้ต่อ

export const KID = 'core-hub-2026';
export const ISSUER = 'core-hub';
export const AUDIENCE = 'csmju2030';

/// ผู้ใช้ตั้งต้นของเทสต์ — ค่า `sub` หน้าตาแบบเดียวกับที่ Core Hub ออกจริง
/// (`user-002` ไม่ใช่ `6700001382-somsak` ซึ่งเป็นรหัสนักศึกษาที่ token ไม่มี)
export const DEFAULT_SUB = 'user-002';

let privateKey: KeyObject | null = null;

const b64url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url');

/// เซ็น JWT แบบ **synchronous**
///
/// เขียนเองด้วย `node:crypto` แทนการใช้ `SignJWT` ของ jose ซึ่งเป็น async —
/// เพราะ supertest `.set()` รับแต่สตริง ถ้าส่ง Promise เข้าไปมันจะกลายเป็น
/// header ค่า "[object Promise]" แล้วเทสต์จะได้ 401 ที่หาสาเหตุยากมาก
///
/// และเทสต์บางตัวสร้างผู้ใช้ขึ้นมาระหว่างทาง (เช่นยิงแย่งที่นั่งห้องเสียง
/// พร้อมกันแปดคน) จึงเซ็นล่วงหน้าทั้งหมดไม่ได้
function signSync(claims: Record<string, unknown>): string {
  if (!privateKey) {
    throw new Error('เรียก startCoreHubStub() ก่อน');
  }

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const payload = b64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');

  signer.update(`${header}.${payload}`);
  signer.end();

  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
}

/// เตรียม Core Hub จำลอง — เรียกใน `beforeAll` **ก่อน**สร้าง Nest app
/// เพราะ `JwksService` อ่าน env ตอนดึงกุญแจครั้งแรก
export async function startCoreHubStub(): Promise<void> {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  privateKey = (await import('node:crypto')).createPrivateKey(pair.privateKey);

  process.env.CORE_HUB_URL = 'http://core-hub.test';
  process.env.CORE_HUB_JWKS_URL =
    'http://core-hub.test/api/v1/.well-known/jwks.json';
  process.env.CORE_HUB_ISSUER = ISSUER;
  process.env.CORE_HUB_AUDIENCE = AUDIENCE;
  process.env.JWKS_MIN_REFRESH_INTERVAL_MS = '0';

  const jwk = await exportJWK(await importSPKI(pair.publicKey, 'RS256'));

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }],
      }),
    })),
  );
}

/// ค่า header `Authorization` ของผู้ใช้คนหนึ่ง
export function bearer(sub: string, role: CoreRole = 'student'): string {
  const now = Math.floor(Date.now() / 1000);

  return `Bearer ${signSync({
    sub,
    email: `${sub}@core.local`,
    role,
    sid: `sid-${sub}`,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + 900,
  })}`;
}

/// ผู้ใช้ตั้งต้น — ใช้กับคำขอที่ไม่ได้สนใจว่าใครเป็นคนเรียก
export function defaultBearer(): string {
  return bearer(DEFAULT_SUB, 'student');
}
