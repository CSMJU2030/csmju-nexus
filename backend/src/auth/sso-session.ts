import { randomBytes, timingSafeEqual } from 'node:crypto';

/// คุกกี้ของ Central SSO (auth-contract.md ข้อ 5.1 · 5.2 · standards 1.7.0)
///
/// ระบบนี้ **ไม่มี session ของตัวเอง** — session คือ token ของ Core Hub
/// ที่ `/auth/callback` ตรวจครบ 10 ขั้นแล้ว เก็บในคุกกี้ HttpOnly อายุเท่า token
/// หมดอายุเมื่อไร หน้าบ้านพาทั้งหน้าไป `/auth/login` แล้ว Core Hub ต่ออายุให้เอง
///
/// คุกกี้ตัวที่สองถือ `state` ของการเข้าสู่ระบบหนึ่งครั้ง (ใช้ได้ครั้งเดียว)
/// ซึ่งเป็นสิ่งเดียวที่บอกได้ว่า callback ที่มาถึงเป็นของการเข้าสู่ระบบที่
/// เบราว์เซอร์นี้เริ่มเอง — กัน login CSRF

/// ชื่อคุกกี้ขึ้นต้นด้วยชื่อระบบ (`-` → `_`) เพราะตอนพัฒนาทุกระบบรันบน
/// `localhost` และคุกกี้ไม่แยกตามพอร์ต ถ้าสองระบบใช้ชื่อเดียวกันจะทับกัน
/// (คุกกี้ `csmju_*` ของเว็บ Core Hub ก็มาถึงที่นี่ด้วย และต้องไม่อ่าน — ข้อ 6)
export function ssoCookieNames(subsystemId: string): {
  session: string;
  state: string;
} {
  const prefix = subsystemId.replace(/-/g, '_');

  return { session: `${prefix}_access_token`, state: `${prefix}_sso_state` };
}

/// คุกกี้ state ถูกส่งกลับมาเฉพาะที่ callback ซึ่งเป็นที่เดียวที่อ่านมัน
export const SSO_STATE_COOKIE_PATH = '/auth/callback';

/// เวลาที่ให้ผู้ใช้อยู่ที่ Core Hub ได้ (jwt-contract.json `stateTtlMaxSec`)
export const SSO_STATE_TTL_SEC = 600;

/// อ่านคุกกี้หนึ่งตัวจาก header `Cookie` ดิบ
///
/// ไม่ใช้ `cookie-parser` เพราะไม่อยู่ใน whitelist ของ ARC-02
/// คุกกี้คือข้อมูลที่ผู้ใช้แก้เองได้ — `%` ที่เข้ารหัสผิดทำให้
/// `decodeURIComponent` โยน URIError ซึ่งถ้าหลุดออกไปจะกลายเป็น 500
/// แทน 401 จึงถือว่าคุกกี้ที่อ่านไม่ออกเท่ากับไม่มีคุกกี้
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();

    if (value.length === 0) return null;

    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

function serialise(
  name: string,
  value: string,
  attributes: Record<string, string | boolean>,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  for (const [key, attribute] of Object.entries(attributes)) {
    if (attribute === false) continue;

    parts.push(attribute === true ? key : `${key}=${attribute}`);
  }

  return parts.join('; ');
}

function seconds(value: number): string {
  return String(Math.max(0, Math.floor(value)));
}

/// คุกกี้ session — token ที่ตรวจแล้ว อยู่ได้นานเท่าตัว token เท่านั้น
export function buildSessionCookie(
  name: string,
  token: string,
  maxAgeSec: number,
  secure: boolean,
): string {
  return serialise(name, token, {
    Path: '/',
    HttpOnly: true,
    SameSite: 'Lax',
    'Max-Age': seconds(maxAgeSec),
    Secure: secure,
  });
}

/// คุกกี้ state — ค่าคือ `<state>.<next แบบ base64url>`
///
/// หน้าที่จะกลับไปเดินทางคู่กับ state ของมันเอง แท็บอื่นที่เริ่มเข้าสู่ระบบ
/// อีกรอบจึงพาแท็บนี้ไปที่อื่นไม่ได้ · state เป็น base64url ไม่มีจุด
/// จุดแรกจึงแบ่งสองส่วนได้แน่นอน
export function buildStateCookie(
  name: string,
  state: string,
  landing: string,
  secure: boolean,
): string {
  const value = `${state}.${Buffer.from(landing, 'utf8').toString('base64url')}`;

  return serialise(name, value, {
    Path: SSO_STATE_COOKIE_PATH,
    HttpOnly: true,
    SameSite: 'Lax',
    'Max-Age': seconds(SSO_STATE_TTL_SEC),
    Secure: secure,
  });
}

/// อ่านคุกกี้ state กลับ — `landing` ที่ได้ **ต้องตรวจด้วย `safeNextPath` ซ้ำ**
/// ก่อนใช้ เพราะมันกลับมาจากคุกกี้ (auth-contract.md ข้อ 5.2)
export function readStateCookie(
  cookieHeader: string | undefined,
  name: string,
): { state: string; landing: string } | null {
  const raw = readCookie(cookieHeader, name);

  if (!raw) return null;

  const dot = raw.indexOf('.');
  const state = dot === -1 ? raw : raw.slice(0, dot);
  const landing =
    dot === -1
      ? ''
      : Buffer.from(raw.slice(dot + 1), 'base64url').toString('utf8');

  return state.length > 0 ? { state, landing } : null;
}

/// ลบคุกกี้ — `Path` ต้องตรงกับตอนตั้ง ไม่งั้นเบราว์เซอร์ถือเป็นคนละตัว
/// แล้วตัวเดิมจะไม่ถูกลบ
export function buildCookieRemoval(
  name: string,
  path: string,
  secure: boolean,
): string {
  return serialise(name, '', {
    Path: path,
    HttpOnly: true,
    SameSite: 'Lax',
    'Max-Age': '0',
    Expires: 'Thu, 01 Jan 1970 00:00:00 GMT',
    Secure: secure,
  });
}

/// สุ่ม 32 ไบต์ (256 บิต) เข้ารหัส base64url ให้ผ่าน query string ได้ตรงตัว
export function createSsoState(): string {
  return randomBytes(32).toString('base64url');
}

/// เทียบแบบ constant-time — เวลาที่ใช้เทียบไม่บอกว่าตรงกันกี่ตัวอักษร
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length || left.length === 0) return false;

  return timingSafeEqual(left, right);
}
