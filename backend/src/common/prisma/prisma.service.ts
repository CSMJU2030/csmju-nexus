import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

/// Blueprint หน้า 13: Backend เป็นจุดเดียวที่ถือ DB connection
/// frontend ห้ามต่อฐานข้อมูลโดยตรงเด็ดขาด
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env ก่อน');
    }

    // Prisma 7 บังคับใช้ driver adapter สำหรับทุก SQL provider
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
