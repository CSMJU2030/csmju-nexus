import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PrismaClient } from '../generated/prisma/client.js';

/// ย้ายไฟล์รุ่นเก่าจากดิสก์ (LOCAL_STORAGE_DIR/<bucket>/<objectPath>) เข้าตาราง stored_objects — ใช้ครั้งเดียวบนเครื่อง dev
///
///   pnpm --filter backend assets:import-disk
///
/// รันซ้ำได้: ข้ามไฟล์ที่ย้ายแล้ว · ไฟล์ที่ไม่มีบนดิสก์หรือใหญ่เกิน 10 MB จะรายงานไว้ ไม่ลบแถวทิ้ง
/// ไม่ต้องใช้บน server (ฐานบน server เริ่มใหม่ ไฟล์อยู่ในฐานตั้งแต่อัปโหลด)
const MAX_BYTES = 10 * 1024 * 1024;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) throw new Error('ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env ก่อน');

  const root = resolve(process.env.LOCAL_STORAGE_DIR ?? './storage-dev');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let moved = 0;
  let skipped = 0;
  const missing: string[] = [];
  const tooLarge: string[] = [];

  try {
    // path ซ้ำได้ (สำเนาจากการส่งต่อชี้ไฟล์เดียวกัน) — ย้ายครั้งเดียวต่อ bucket+path
    const rows = await prisma.asset.findMany({ distinct: ['bucket', 'objectPath'], select: { bucket: true, objectPath: true } });

    for (const { bucket, objectPath } of rows) {
      const exists = await prisma.storedObject.findUnique({ where: { bucket_objectPath: { bucket, objectPath } }, select: { bucket: true } });

      if (exists) {
        skipped++;
        continue;
      }

      const file = resolve(join(root, bucket, objectPath));

      // กัน path traversal จากค่าในฐาน
      if (!file.startsWith(root + sep)) {
        missing.push(`${bucket}/${objectPath}`);
        continue;
      }

      let bytes: Buffer;

      try {
        bytes = await readFile(file);
      } catch {
        missing.push(`${bucket}/${objectPath}`);
        continue;
      }

      if (bytes.length > MAX_BYTES) {
        tooLarge.push(`${bucket}/${objectPath} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
        continue;
      }

      await prisma.storedObject.create({
        data: {
          bucket,
          objectPath,
          content: bytes as unknown as Uint8Array<ArrayBuffer>,
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      });
      moved++;
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`ย้ายเข้าฐาน ${moved} ไฟล์ · มีอยู่แล้ว ${skipped} · ไม่พบบนดิสก์ ${missing.length} · ใหญ่เกิน 10 MB ${tooLarge.length}`);
  for (const path of tooLarge) console.log(`  ใหญ่เกิน: ${path}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
