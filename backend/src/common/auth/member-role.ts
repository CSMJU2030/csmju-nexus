import type { PrismaService } from '../prisma/prisma.service.js';
import type { CoreHubUser, CoreRole } from './core-user.js';
import type { Layer2Role } from '../../generated/prisma/enums.js';
import { isStaffLike, subsystemRoleFor } from '../../auth/role-mapping.js';

/// default_role_mapping ตาม subsystem.yaml — อ่านจากตารางเดียวใน
/// auth/role-mapping.ts ไม่เขียนซ้ำ (เดิมซ้ำกันสองที่ แล้วตกหล่น lecturer/guest)
export function defaultLayer2Role(coreRole: CoreRole): Layer2Role {
  return subsystemRoleFor(coreRole);
}

/// ใครทำสิ่งที่กระทบทั้งห้องได้ (เพิ่มสมาชิก · นัดประชุม)
///
/// จุดเดียวที่ตัดสินเรื่องนี้ เพราะเดิมเขียนซ้ำสองที่แล้วเขียนผิดเหมือนกัน
/// ทั้งสองที่: เงื่อนไขคือ "ไม่ใช่ผู้ดูแลห้อง **และ** เป็นนักศึกษา" จึงห้าม
/// ได้เฉพาะนักศึกษา — ศิษย์เก่าที่เป็นสมาชิกธรรมดาผ่านฉลุย แล้วดึงใครก็ได้
/// เข้าห้องส่วนตัว ซึ่งคนที่ถูกดึงเข้ามาอ่านประวัติแชททั้งห้องได้ทันที
///
/// ข้อความ error ที่เขียนไว้ว่า "เฉพาะผู้ดูแลห้องหรืออาจารย์" คือเจตนาจริง
/// โค้ดต่างหากที่ไม่ตรงกับมัน
export function canAdministerChannel(
  channelRole: string,
  user: CoreHubUser,
): boolean {
  return (
    channelRole === 'MODERATOR' || isStaffLike(user.coreRole)
  );
}

/// หาแถวสมาชิกของผู้เรียก และปรับสิทธิ์ให้ตรงกับ coreRole ถ้าจำเป็น
///
/// จุดเดียวในระบบที่ตัดสินว่า "คนนี้มีสิทธิ์ Layer 2 อะไร" — ทั้ง RolesGuard
/// และ GET /subsystem-members/me เรียกตัวนี้ ไม่เขียนตรรกะซ้ำสองที่
///
/// เหตุผลที่ต้องปรับ: เราไม่เก็บ coreRole (หน้า 10) จึงรู้ค่าจริงเฉพาะ
/// ตอนเจ้าตัวยิง request เข้ามา ถ้าแถวถูกสร้างโดยคนอื่น (เช่นผู้ดูแลตั้ง
/// โควตาล่วงหน้า) มันจะได้ค่าเริ่มต้น GUEST ซึ่งผิดสำหรับอาจารย์ —
/// การมาถึงของ request แรกคือโอกาสเดียวที่จะแก้ให้ถูก
///
/// เขียนฐานข้อมูลเฉพาะเมื่อค่าไม่ตรง ไม่ใช่ทุก request
export async function resolveMember(prisma: PrismaService, user: CoreHubUser) {
  const expected = defaultLayer2Role(user.coreRole);

  // โอกาสเดียวกันนี้คือโอกาสเดียวที่เรารู้อีเมลของเจ้าตัว (มันอยู่ใน token
  // ที่เพิ่งผ่านการตรวจลายเซ็น) จึงเก็บชื่อที่อ่านออกไว้ด้วยเลย
  // ไม่งั้นทุกหน้าจะแสดงคนเป็น "user-002" ตลอดไป
  //
  // ไม่ await ให้ค้างคำขอ — ถ้าล้มเหลวก็แค่ยังไม่มีชื่อ ไม่ใช่เรื่องที่ควร
  // ทำให้ผู้ใช้เปิดหน้าไม่ได้
  void ensureProfileName(prisma, user).catch(() => undefined);

  // upsert ไม่ใช่ findUnique-แล้ว-create เพราะหน้าแรกของแอปยิงหลายคำขอพร้อมกัน
  // (GET /subsystem-members/me และทุก route ที่มี @Layer2Roles ต่างก็เรียกตัวนี้)
  // ทั้งคู่เห็นว่ายังไม่มีแถว ต่างก็ create แล้วตัวที่สองชน unique constraint
  // กลายเป็น 500 ในคำขอแรกสุดของผู้ใช้ใหม่ทุกคน — ช่วงเวลาที่แย่ที่สุดที่จะพัง
  const existing = await prisma.subsystemMember.upsert({
    where: { coreUserId: user.coreUserId },
    create: { coreUserId: user.coreUserId, layer2Role: expected },
    update: {},
  });

  // ผู้ดูแลตั้งค่านี้ด้วยมือ = เจตนาของคน ห้ามเขียนทับด้วยการแปลงอัตโนมัติ
  if (existing.layer2RoleExplicit || existing.layer2Role === expected) {
    return existing;
  }

  return prisma.subsystemMember.update({
    where: { coreUserId: user.coreUserId },
    data: { layer2Role: expected },
  });
}

/// ชื่อที่พออ่านออกจากอีเมลในโทเคน
///
/// `staff@core.local` → `staff` · `6700001382@mju.ac.th` → `6700001382`
/// (ซึ่งก็คือรหัสนักศึกษาจริง)
///
/// ใช้เพราะ **token ของ Core Hub ไม่มีชื่อคน** มีแค่ `sub` `email` `role`
/// และ `GET /api/v1/users/:id` ของ Core Hub ก็ไม่ได้ส่งชื่อมาด้วย
/// (ตรวจแล้วเมื่อ 27 ก.ย. 2569 — คืนแค่ id/email/role)
/// ชื่อจริงอยู่ในตาราง `Person` ซึ่งระบบย่อยเรียกไม่ได้ (403)
///
/// ขอ endpoint ที่แปลง `sub` เป็นชื่อไว้แล้ว — docs/ถึง-PM-สิ่งที่ต้องเพิ่ม.md ข้อ 1
/// ระหว่างนี้ส่วนหน้าที่ของอีเมลอ่านง่ายกว่า `user-002` มาก
export function nameFromEmail(email: string): string | null {
  const local = email.split('@')[0]?.trim();

  return local ? local : null;
}

/// ทำให้ผู้ใช้ที่เพิ่งเข้ามามีชื่อในแคชโปรไฟล์
///
/// `create` อย่างเดียว ไม่ `update` — ถ้าวันหนึ่ง Core Hub เปิดให้ซิงก์ชื่อจริง
/// ได้แล้ว ชื่อนั้นต้องชนะชื่อที่เดาจากอีเมล
///
/// `syncedAt` จึงปล่อยให้เป็นค่าเริ่มต้น และหน้าบ้านยังบอกผู้ใช้ตามตรงว่า
/// "ยังไม่เคยซิงก์ชื่อจริงจาก Core"
export async function ensureProfileName(
  prisma: PrismaService,
  user: CoreHubUser,
): Promise<void> {
  const displayName = nameFromEmail(user.email);

  if (!displayName) return;

  await prisma.profileCache.upsert({
    where: { coreUserId: user.coreUserId },
    create: { coreUserId: user.coreUserId, displayName },
    update: {},
  });
}
