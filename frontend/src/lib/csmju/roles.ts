import type { CoreRole } from './session';

/// role ที่ได้สิทธิ์ระดับเจ้าหน้าที่ในระบบนี้ — ต้องตรงกับ
/// `backend/src/auth/role-mapping.ts` (`STAFF_LIKE_ROLES`)
///
/// อาจารย์ (`lecturer`) ใช้สิทธิ์ชุดเดียวกับเจ้าหน้าที่ (ทั้งคู่ → EDITOR · standards 1.6.0+)
/// แยกไฟล์จาก session.tsx เพื่อให้เทสต์ที่ mock session ทั้งโมดูลไม่ต้อง mock ตัวนี้ด้วย
export function isStaffLike(role: CoreRole): boolean {
  return role === 'staff' || role === 'lecturer' || role === 'admin';
}
