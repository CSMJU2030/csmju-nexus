import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CoreHubUser } from './core-hub-token.verifier.js';
import type { RequestWithCoreUser } from './core-hub-jwt.guard.js';

/// ดึงตัวตนที่ผ่านการตรวจลายเซ็นแล้ว — `@CurrentUser() user: CoreHubUser`
///
/// โยน error แทนการคืน undefined เมื่อไม่มีตัวตน เพราะการไปถึงจุดนี้ได้
/// แปลว่า route นี้หลุดจาก CoreHubJwtGuard ซึ่งเป็นช่องโหว่ ไม่ใช่กรณีปกติ
/// ที่ควรปล่อยให้โค้ดข้างหลังเดาเอาเองว่าจะทำยังไงต่อ
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CoreHubUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithCoreUser>();

    if (!request.coreUser) {
      throw new Error(
        'ไม่พบ coreUser ใน request — route นี้ยังไม่ได้ผ่าน CoreHubJwtGuard',
      );
    }

    return request.coreUser;
  },
);
