import { NestFactory } from '@nestjs/core';
import { readFile } from 'node:fs/promises';
import { AppModule } from '../app.module.js';
import { applyGlobalPrefix, configureApp } from '../bootstrap.js';
import { buildOpenApiDocument, OPENAPI_FILE } from '../openapi.js';

/// ตรวจว่า openapi.json ที่ commit ไว้ตรงกับโค้ดจริง
///
/// Blueprint หน้า 13: "API Contract ต้องซิงก์กับ openapi.json เสมอ"
/// main.ts เขียนไฟล์ออกทุกครั้งที่บูต แต่นั่นช่วยได้เฉพาะเครื่องที่รันจริง —
/// ถ้าใครเพิ่ม endpoint แล้ว commit โดยไม่ได้บูต ไฟล์ใน repo จะเก่ากว่าโค้ด
/// แล้วระบบย่อยอื่นที่อ่าน contract ของเราจะเขียนโค้ดผิดโดยไม่รู้ตัว
///
/// สคริปต์นี้จึงรันใน CI: สร้างเอกสารจากโค้ดปัจจุบัน เทียบกับไฟล์ที่ commit
/// ถ้าไม่ตรงให้ CI แดงพร้อมบอกว่า path ไหนเพิ่ม/หาย/เปลี่ยน
async function main(): Promise<void> {
  // ปิด log ของ Nest เพื่อให้ผลลัพธ์ของสคริปต์อ่านง่ายใน CI
  const app = await NestFactory.create(AppModule, { logger: false });

  configureApp(app);

  // ต้องตั้ง prefix ก่อนสร้างเอกสาร ไม่งั้นทุก path จะขาด /api/v1
  // และไม่ตรงกับที่เซิร์ฟเวอร์เสิร์ฟจริง (ดูเหตุผลใน bootstrap.ts)
  applyGlobalPrefix(app);

  const generated = buildOpenApiDocument(app);

  await app.close();

  let committed: unknown;

  try {
    committed = JSON.parse(await readFile(OPENAPI_FILE, 'utf8'));
  } catch {
    console.error(
      `ไม่พบ ${OPENAPI_FILE} — รัน "npm run openapi" แล้ว commit ไฟล์ที่ได้`,
    );
    process.exit(1);
  }

  const a = JSON.stringify(committed, null, 2);
  const b = JSON.stringify(generated, null, 2);

  if (a === b) {
    const paths = Object.keys(generated.paths ?? {}).length;
    const schemas = Object.keys(generated.components?.schemas ?? {}).length;

    console.log(`openapi.json ตรงกับโค้ด · ${paths} path · ${schemas} schema`);

    return;
  }

  console.error(`openapi.json ไม่ตรงกับโค้ด — รัน "npm run openapi" แล้ว commit\n`);
  // cast ผ่าน unknown เพราะ PathItemObject ของ swagger ไม่มี index signature
  report(committed as Spec, generated as unknown as Spec);
  process.exit(1);
}

interface Spec {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

/// บอกให้ชัดว่าอะไรต่างกัน ไม่ใช่แค่ "ไม่ตรง"
///
/// ข้อความ "ไฟล์ไม่ตรง" เฉย ๆ ทำให้คนต้องไปเปิด diff ของไฟล์ยาวสองพันบรรทัด
/// เอง ซึ่งเป็นเหตุผลที่คนเลิกอ่าน error ของ CI
function report(committed: Spec, generated: Spec): void {
  const oldPaths = new Set(Object.keys(committed.paths ?? {}));
  const newPaths = new Set(Object.keys(generated.paths ?? {}));

  const added = [...newPaths].filter((p) => !oldPaths.has(p));
  const removed = [...oldPaths].filter((p) => !newPaths.has(p));
  const changed = [...newPaths].filter(
    (p) =>
      oldPaths.has(p) &&
      JSON.stringify(committed.paths?.[p]) !==
        JSON.stringify(generated.paths?.[p]),
  );

  const oldSchemas = new Set(Object.keys(committed.components?.schemas ?? {}));
  const newSchemas = new Set(Object.keys(generated.components?.schemas ?? {}));

  print('path ที่เพิ่มในโค้ดแต่ยังไม่มีในไฟล์', added);
  print('path ที่หายจากโค้ดแต่ยังอยู่ในไฟล์', removed);
  print('path ที่เนื้อหาเปลี่ยน', changed);
  print(
    'schema ที่เพิ่ม',
    [...newSchemas].filter((s) => !oldSchemas.has(s)),
  );
  print(
    'schema ที่หาย',
    [...oldSchemas].filter((s) => !newSchemas.has(s)),
  );

  if (
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    oldSchemas.size === newSchemas.size
  ) {
    console.error(
      '  (ต่างกันที่ส่วนอื่นของเอกสาร เช่น version หรือคำอธิบาย)',
    );
  }
}

function print(label: string, items: string[]): void {
  if (items.length === 0) {
    return;
  }

  console.error(`${label} (${items.length}):`);

  for (const item of items.slice(0, 20)) {
    console.error(`  - ${item}`);
  }

  if (items.length > 20) {
    console.error(`  ... และอีก ${items.length - 20} รายการ`);
  }

  console.error('');
}

await main();
