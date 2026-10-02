import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator.js';
import type { CoreHubUser } from './core-hub-token.verifier.js';
import type { RequestWithCoreUser } from './core-hub-jwt.guard.js';
import { subsystemRoleFor } from './role-mapping.js';

/// `GET /api/v1/me` — เส้นทางบังคับตาม contracts/vocabulary.json
///
/// รูปร่างของคำตอบถูกล็อกไว้ที่ `contracts/openapi.yaml` (`MeEnvelope`)
/// สี่ฟิลด์บังคับ — `id` · `email` · `coreRole` · `subsystemRole` และ `session` ที่ไม่บังคับ
/// conformance L1-08..12 อ่านทั้งสี่ตัวแล้วเทียบกับ claim ใน token ที่มันถืออยู่
///
/// `id` คือค่า `sub` ตรง ๆ ไม่ใช่ id ในฐานข้อมูลเรา — ตัวตนกลางมีที่เดียว
/// คือ Core Hub ถ้าคืน id ของเราไป ระบบย่อยอื่นจะเอาไปอ้างอิงข้ามระบบไม่ได้
///
/// ไม่ต้องติด guard เอง — `CoreHubJwtGuard` เป็น global guard แล้ว
/// (เดิมต้องติดเฉพาะ route นี้ ระหว่างที่ด่านเก่าของ Gateway ยังคุมอยู่)
@ApiTags('auth')
@Controller('me')
export class MeController {
  @Get()
  @ApiOperation({ summary: 'ตัวตนของผู้ใช้ปัจจุบันจาก token ที่ตรวจแล้ว' })
  me(@CurrentUser() user: CoreHubUser, @Req() request: RequestWithCoreUser) {
    const expiresAtMs = request.coreSessionExpiresAtMs;

    return {
      id: user.coreUserId,
      email: user.email,
      coreRole: user.coreRole,

      // แปลงสด ไม่อ่านจากฐานข้อมูล เพราะ core role เปลี่ยนที่ Core Hub ได้
      // ตลอดเวลา ถ้าอ่านค่าที่เคยบันทึกไว้ คนที่เพิ่งถูกลดสิทธิ์จะยังใช้สิทธิ์เดิม
      // ได้จนกว่าจะมีอะไรไปแก้แถวนั้น
      subsystemRole: subsystemRoleFor(user.coreRole),

      // ไม่บังคับตาม MeEnvelope (contracts/openapi.yaml) — ให้หน้าบ้านรู้ว่า
      // token หมดเมื่อไร จะได้ต่ออายุผ่าน /auth/login ก่อนผู้ใช้กรอกฟอร์มค้าง
      // (auth-contract.md ข้อ 7) · คิดจาก `exp` ที่ผ่านการตรวจลายเซ็นแล้ว
      ...(expiresAtMs
        ? { session: { expiresAt: new Date(expiresAtMs).toISOString() } }
        : {}),
    };
  }
}
