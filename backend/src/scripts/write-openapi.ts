import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { AppModule } from '../app.module.js';
import { applyGlobalPrefix, configureApp } from '../bootstrap.js';
import { buildOpenApiDocument, OPENAPI_FILE } from '../openapi.js';

/// เขียน openapi.json ใหม่โดยไม่ต้องเปิดเซิร์ฟเวอร์
///
/// เดิมไฟล์นี้เกิดเฉพาะตอนบูตด้วย `npm start` ซึ่งต้องมีพอร์ตว่างและต้องรอ
/// สคริปต์นี้ให้สั่งตรง ๆ ได้ก่อน commit — คู่กับ check-openapi ที่ตรวจใน CI
async function main(): Promise<void> {
  // CI ของ org (API-01) รันสคริปต์นี้โดยไม่มี DATABASE_URL — PrismaService จะ throw
  // ตั้งแต่ตอนสร้าง ทั้งที่สคริปต์นี้แค่อ่าน metadata ของ controller ไม่ได้ต่อฐานข้อมูล
  // (ไม่เรียก app.init() จึงไม่มี $connect) — ค่าสำรองนี้ไม่มีรหัสผ่านและไม่ถูกใช้ต่อจริง
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/openapi_placeholder';

  const app = await NestFactory.create(AppModule, { logger: false });

  configureApp(app);

  // ต้องตั้ง prefix ก่อนสร้างเอกสาร ไม่งั้นทุก path จะขาด /api/v1
  // และไม่ตรงกับที่เซิร์ฟเวอร์เสิร์ฟจริง (ดูเหตุผลใน bootstrap.ts)
  applyGlobalPrefix(app);

  const document = buildOpenApiDocument(app);

  await app.close();
  await writeFile(OPENAPI_FILE, JSON.stringify(document, null, 2), 'utf8');

  const paths = Object.keys(document.paths ?? {}).length;
  const schemas = Object.keys(document.components?.schemas ?? {}).length;

  console.log(`เขียน ${OPENAPI_FILE} แล้ว · ${paths} path · ${schemas} schema`);
}

await main();
