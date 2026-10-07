import { Global, Module } from '@nestjs/common';
import { DatabaseStorage } from './database.storage.js';
import { STORAGE_PROVIDER } from './storage.provider.js';

/// ที่เก็บไฟล์ของระบบ: ฐานข้อมูลของระบบเอง (ตาราง stored_objects) ทั้งในเครื่องและบน server
///
/// standards deployment.md ข้อ 4.3 — ระบบไฟล์ของ container อ่านอย่างเดียว และห้ามส่งไฟล์ของผู้ใช้ไปบริการภายนอก
/// (เดิมใช้ดิสก์ในเครื่องตอน dev และ Supabase บน production — ถอดออกแล้ว · ไฟล์เดิมย้ายด้วย `pnpm --filter backend assets:import-disk`)
@Global()
@Module({
  providers: [DatabaseStorage, { provide: STORAGE_PROVIDER, useExisting: DatabaseStorage }],
  exports: [STORAGE_PROVIDER, DatabaseStorage],
})
export class StorageModule {}
