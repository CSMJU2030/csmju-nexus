import { SetMetadata } from '@nestjs/common';
import type { CoreRole } from './core-user.js';

export const CORE_ROLES_KEY = 'csmju:coreRoles';

/// จำกัด route ตามสิทธิ์ระดับองค์กร เช่น @CoreRoles('staff', 'admin')
export const CoreRoles = (...roles: CoreRole[]) =>
  SetMetadata(CORE_ROLES_KEY, roles);
