import { Global, Logger, Module } from '@nestjs/common';
import { LocalDiskStorage } from './local-disk.storage.js';
import { STORAGE_PROVIDER } from './storage.provider.js';
import { SupabaseStorage } from './supabase.storage.js';

/// เลือกที่เก็บไฟล์จาก env: มี SUPABASE_URL → ใช้ Supabase, ไม่มี → ใช้ดิสก์ในเครื่อง
///
/// ตั้งใจให้ dev รันได้ทันทีโดยไม่ต้องรอ credential ของใคร แต่ production
/// ต้องมี Supabase เพราะดิสก์ของ container หายทุกครั้งที่ deploy
@Global()
@Module({
  providers: [
    LocalDiskStorage,
    {
      provide: STORAGE_PROVIDER,
      inject: [LocalDiskStorage],
      useFactory: (localDisk: LocalDiskStorage) => {
        const logger = new Logger('StorageModule');
        const hasSupabase =
          Boolean(process.env.SUPABASE_URL) &&
          Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

        if (hasSupabase) {
          logger.log('ใช้ Supabase Storage');
          return new SupabaseStorage();
        }

        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            'production ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY — ' +
              'ดิสก์ของ container หายทุกครั้งที่ deploy',
          );
        }

        return localDisk;
      },
    },
  ],
  exports: [STORAGE_PROVIDER, LocalDiskStorage],
})
export class StorageModule {}
