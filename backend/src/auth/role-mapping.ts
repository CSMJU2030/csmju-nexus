import type { Layer2Role } from '../generated/prisma/enums.js';
import type { CoreRole } from './core-hub-token.verifier.js';

/// แปลง core role ของ Core Hub (Layer 1) เป็นสิทธิ์ในระบบย่อยนี้ (Layer 2)
///
/// **ค่าในตารางนี้ต้องตรงกับ `default_role_mapping` ใน `subsystem.yaml` เป๊ะ ๆ**
/// เพราะ Core Hub ใช้ key ของตารางนั้นตัดสินว่า *ใครเข้าระบบนี้ได้*
/// ตั้งแต่ก่อน redirect ส่วนตารางนี้ตัดสินว่า *เข้ามาแล้วทำอะไรได้*
///
/// ถ้าสองที่ไม่ตรงกัน อาการจะเป็นแบบที่หาสาเหตุยากที่สุด: ผู้ใช้เข้าระบบได้
/// (Core Hub ปล่อยผ่าน) แต่กดอะไรไม่ได้เลย (เราให้สิทธิ์ต่ำกว่าที่ยื่นไว้)
/// โดยไม่มี error ที่ไหนบอกว่าเป็นเพราะทะเบียนกับโค้ดไม่ตรงกัน
///
/// เป็นไฟล์เดียวที่ตัดสินเรื่องนี้ — `common/auth/member-role.ts` เรียกมาใช้
/// ไม่ใช่เขียนตารางซ้ำ
///
/// `lecturer` ใช้สิทธิ์ชุดเดียวกับ `staff` (สร้างห้องประจำวิชา ดูแลเนื้อหา)
/// `guest` ผู้เยี่ยมชมที่ admin ของ Core Hub สร้างให้ ได้สิทธิ์เท่านักศึกษา
/// (authorization.md ข้อ 2 · standards 1.7.0)
export const DEFAULT_ROLE_MAPPING: Record<CoreRole, Layer2Role> = {
  student: 'GUEST',
  alumni: 'GUEST',
  staff: 'EDITOR',
  lecturer: 'EDITOR',
  guest: 'GUEST',
  admin: 'ADMIN',
};

/// core role ที่มีสิทธิ์ระดับเจ้าหน้าที่ในระบบนี้ (ดูแลห้อง ลบเนื้อหาที่ถูกรายงาน)
///
/// รวมไว้ที่เดียว — เดิมแต่ละไฟล์เขียน `coreRole === 'staff'` เอง พอมาตรฐาน
/// เพิ่ม `lecturer` ทุกที่ต้องตามแก้ทีละไฟล์
export const STAFF_LIKE_ROLES: readonly CoreRole[] = ['staff', 'lecturer', 'admin'];

export function isStaffLike(coreRole: CoreRole): boolean {
  return STAFF_LIKE_ROLES.includes(coreRole);
}

export function subsystemRoleFor(coreRole: CoreRole): Layer2Role {
  return DEFAULT_ROLE_MAPPING[coreRole];
}
