import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/// สร้างเอกสาร OpenAPI จากตัวแอปจริง
///
/// อยู่ในไฟล์แยกเพราะมีสองที่ที่ต้องใช้ชุดเดียวกัน:
///   1. main.ts — เขียน openapi.json ออกทุกครั้งที่บูต
///   2. scripts/check-openapi.ts — ตรวจใน CI ว่าไฟล์ที่ commit ไว้ตรงกับโค้ด
///
/// ถ้าปล่อยให้ทั้งสองที่สร้างเอกสารด้วยการตั้งค่าของตัวเอง ตัวตรวจจะเทียบ
/// เอกสารที่ไม่เหมือนของจริง แล้วมันจะแดงหรือเขียวโดยไม่มีความหมาย
export function buildOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CS Nexus — csmju-nexus')
      .setDescription(
        'ระบบย่อยภายใต้ CSMJU2030 · ตัวตนมาจาก JWT ของ Core Hub ' +
          'ที่ระบบนี้ตรวจลายเซ็นเองด้วย JWKS ทุก request ' +
          '(RS256 · iss=core-hub · aud=csmju2030 · kid=core-hub-2026) ' +
          'ส่ง token มาได้สองทาง: Authorization: Bearer หรือคุกกี้ csmju_nexus_access_token (ตั้งโดย /auth/callback)',
      )
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addCookieAuth('csmju_nexus_access_token')
      .setVersion('1.0.0')
      .build(),
  );
}

export const OPENAPI_FILE = 'openapi.json';
