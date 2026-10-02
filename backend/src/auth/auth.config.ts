/// ค่าตั้งต้นของชั้นยืนยันตัวตน — อ่านจาก env ตาม contracts/vocabulary.json
///
/// `requiredEnvVars` ในสัญญากำหนดห้าตัวนี้ไว้ ห้ามพิมพ์ค่าลงโค้ดเอง
/// (auth-contract.md ข้อ 2: "ให้โค้ดอ่านจากไฟล์/env ไม่ใช่พิมพ์ค่าเอง")
///
/// อ่านเป็นฟังก์ชัน ไม่ใช่ค่าคงที่ระดับโมดูล เพราะชุดทดสอบต้องสลับค่า env
/// ระหว่างเคสได้ ถ้าอ่านตอน import ค่าจะถูกตรึงไว้ตั้งแต่ไฟล์แรกที่โหลด

export interface AuthConfig {
  coreHubUrl: string;
  /// เว็บของ Core Hub (ไม่ใช่ API) — ที่ `/auth/login` ส่งเบราว์เซอร์ไป
  /// และที่ `/auth/logout` พาไปออกจากระบบทั้งหมด (auth-contract.md ข้อ 5)
  coreHubWebUrl: string;
  jwksUrl: string;
  issuer: string;
  audience: string;
  subsystemId: string;
  jwksCacheTtlMs: number;
  jwksMinRefreshIntervalMs: number;
  jwksRequestTimeoutMs: number;
  clockToleranceSec: number;
  /// คุกกี้ตั้ง `Secure` เฉพาะ production (auth-contract.md ข้อ 5.1 · 5.2)
  secureCookies: boolean;
}

/// อายุสูงสุดของ access token ตามสัญญา (contracts/jwt-contract.json
/// `maxTokenLifetimeSeconds` + `clockToleranceSeconds`) — ขั้น 9 ของการตรวจ
///
/// เป็นค่าคงที่ของสัญญา ไม่ใช่ค่าที่ปรับได้ จึงไม่อ่านจาก env
export const MAX_TOKEN_LIFETIME_SEC = 900;
export const TOKEN_LIFETIME_TOLERANCE_SEC = 60;

function num(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function authConfig(): AuthConfig {
  const coreHubUrl = (process.env.CORE_HUB_URL ?? '').replace(/\/+$/, '');

  return {
    coreHubUrl,

    // server จริงใช้ URL เดียวกันทั้ง API และเว็บ (connect-core-hub.md ข้อ 4)
    // แต่ Core Hub ในเครื่องแยกพอร์ต (API :3000 · เว็บ :3100) จึงต้องตั้งแยก
    // ไม่ตั้ง = ใช้ CORE_HUB_URL ซึ่งถูกต้องสำหรับ server จริง
    coreHubWebUrl: (process.env.CORE_HUB_WEB_URL ?? coreHubUrl).replace(
      /\/+$/,
      '',
    ),

    // สัญญากำหนดเส้นทาง JWKS ไว้ตายตัวที่ /api/v1/.well-known/jwks.json
    // แต่ยอมให้ override ได้ เพราะ Dev Server อาจวางไว้คนละที่ระหว่างทดสอบ
    jwksUrl:
      process.env.CORE_HUB_JWKS_URL ??
      `${coreHubUrl}/api/v1/.well-known/jwks.json`,

    issuer: process.env.CORE_HUB_ISSUER ?? 'core-hub',
    audience: process.env.CORE_HUB_AUDIENCE ?? 'csmju2030',
    subsystemId: process.env.SUBSYSTEM_ID ?? 'csmju-nexus',

    jwksCacheTtlMs: num('JWKS_CACHE_TTL_MS', 600_000),
    jwksMinRefreshIntervalMs: num('JWKS_MIN_REFRESH_INTERVAL_MS', 30_000),
    jwksRequestTimeoutMs: num('JWKS_REQUEST_TIMEOUT_MS', 5_000),

    // สัญญาข้อ 4 ยอมให้เหลื่อมได้ "ไม่เกิน 60 วินาที" — ตัวเลขนี้คือเพดาน
    // ไม่ใช่ค่าที่แนะนำ เทมเพลตของมาตรฐานตั้งไว้ 5 จึงใช้ค่านั้นเป็นค่าเริ่มต้น
    clockToleranceSec: Math.min(num('JWT_CLOCK_TOLERANCE_SEC', 5), 60),

    secureCookies: process.env.NODE_ENV === 'production',
  };
}
