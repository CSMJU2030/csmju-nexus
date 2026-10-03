import { Logger } from '@nestjs/common';

/// structured log ของเหตุการณ์ยืนยันตัวตนและสิทธิ์ (logging.md · contracts/log-events.json)
///
/// **JSON บรรทัดเดียว** ต่อหนึ่งเหตุการณ์ — `Logger` ของ Nest พิมพ์ object
/// แบบหลายบรรทัด ซึ่ง grep รวม log ของทุกระบบย่อยไม่ได้ จึงแปลงเป็นสตริงเอง
///
/// ชื่อ event และ `reason` เป็นรายการปิด ใส่ได้เฉพาะค่าที่อยู่ในสัญญา
/// และ **ห้ามมี** token · header Authorization/Cookie · URL ที่มี query ·
/// ชื่อหรืออีเมล — ระบุตัวผู้ใช้ด้วย `sub` อย่างเดียว (`mustNeverLog`)

export type AuthEvent =
  | 'subsystem.started'
  | 'jwt.verification.success'
  | 'jwt.verification.failure'
  | 'jwks.refresh'
  | 'jwks.refresh.failure'
  | 'jwks.unknown_kid'
  | 'authorization.role_mapping_failed'
  | 'authorization.denied';

const logger = new Logger('AuthEvents');

type Level = 'log' | 'warn' | 'error' | 'debug';

export function logAuthEvent(
  level: Level,
  event: AuthEvent,
  fields: Record<string, unknown>,
): void {
  logger[level](JSON.stringify({ event, ...fields, at: new Date().toISOString() }));
}
