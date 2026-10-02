/// แปลงคีย์ของ JSON ที่เก็บไว้ในฐานข้อมูลให้เป็น camelCase ตอนส่งออกทาง API
///
/// ใช้กับคอลัมน์ Json แบบอิสระเท่านั้น (payload ของแจ้งเตือน · metadata ของ audit log)
/// ซึ่งแถวเก่าบันทึกคีย์เป็น snake_case ไว้แล้ว — api-conventions.md ข้อ 3 บังคับให้ฟิลด์
/// ใน JSON เป็น camelCase เสมอ จึงแปลงตอนอ่านแทนการย้ายข้อมูลเดิม
///
/// ไม่ใช่ interceptor ครอบทั้งระบบ — DTO อื่นทุกตัวตั้งชื่อเป็น camelCase ตรง ๆ
/// เพื่อให้ OpenAPI ตรงกับของจริง ตัวนี้แตะเฉพาะก้อน JSON ที่ไม่มี schema ตายตัว
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value === null || typeof value !== 'object') return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase()),
      camelizeKeys(inner),
    ]),
  );
}
