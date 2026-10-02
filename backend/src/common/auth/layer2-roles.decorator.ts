import { SetMetadata } from '@nestjs/common';
import type { Layer2Role } from '../../generated/prisma/enums.js';

export const LAYER2_ROLES_KEY = 'csmju:layer2Roles';

/// จำกัด route ตามสิทธิ์ระดับระบบย่อย เช่น @Layer2Roles('ADMIN')
/// ค่าเหล่านี้เป็น Local Data นิยามเองได้ (Blueprint หน้า 11)
export const Layer2Roles = (...roles: Layer2Role[]) =>
  SetMetadata(LAYER2_ROLES_KEY, roles);
