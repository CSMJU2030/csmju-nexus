/// ตัวตนของผู้เรียก สำหรับโค้ดในชั้น common และ modules
///
/// ไฟล์นี้ไม่ได้นิยามอะไรเอง — เป็นหน้าต่างบานเดียวที่ทั้งระบบมองผ่านไปยัง
/// ชั้น auth จริง ๆ เพื่อไม่ให้ 41 ไฟล์ต้องรู้ว่าตัวตนมาจากไหน
///
/// เดิมไฟล์นี้ชื่อ `gateway-user.ts` และนิยาม `GatewayUser` เองจาก header
/// `X-User-Id` ที่ API Gateway แนบมา — **สถาปัตยกรรมนั้นไม่มีอยู่จริง**
/// (auth-contract.md ข้อ 1) ตัวตนตอนนี้มาจาก JWT ของ Core Hub ที่ผ่านการ
/// ตรวจลายเซ็นด้วย JWKS ทุก request
///
/// สิ่งที่หายไปจากของเดิมคือ `faculty` เพราะ token ของ Core Hub ไม่มี claim นี้
/// (data-dictionary.md ข้อ 1.2) — ระบบย่อยเดาเองไม่ได้ และไม่ควรเดา

export { CurrentUser } from '../../auth/current-user.decorator.js';

export {
  CORE_ROLES,
  type CoreRole,
  type CoreHubUser,
} from '../../auth/core-hub-token.verifier.js';

export type { RequestWithCoreUser } from '../../auth/core-hub-jwt.guard.js';
