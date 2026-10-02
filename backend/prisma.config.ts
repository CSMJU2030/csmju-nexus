import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // ไม่ใช้ env('DATABASE_URL') เพราะมัน throw ทันทีที่โหลด config ถ้าไม่มีตัวแปร
    // ทำให้ `prisma generate` (ไม่ต้องต่อฐานข้อมูลเลย) พังใน CI ของ org ที่ไม่มี
    // DATABASE_URL — คำสั่งที่ต่อฐานข้อมูลจริง (migrate · db) ยังฟ้องเองถ้าค่าว่าง
    url: process.env.DATABASE_URL ?? '',
  },
});
