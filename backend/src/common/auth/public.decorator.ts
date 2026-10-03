import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'csmju:isPublic';

/// เปิดให้เรียกได้โดยไม่ต้องมีตัวตนจาก Gateway
/// ใช้ได้กับ GET /health เท่านั้นตามมาตรฐาน — route อื่นห้ามใช้
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
