import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AssetsService } from './assets.service.js';

/// ทุก 30 นาที — ถี่พอที่ขยะไม่ทับถม และห่างพอที่ไม่รบกวนฐานข้อมูล
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/// รอสักครู่หลังบูตก่อนกวาดรอบแรก เพื่อไม่ให้แข่งกับ traffic ตอน deploy ใหม่
const FIRST_SWEEP_DELAY_MS = 60 * 1000;

/// ตัวเก็บกวาดรายการอัปโหลดที่ค้างสถานะ PENDING ไฟล์ของเนื้อหาที่ถูกลบ (DELETED)
/// และรีแอ็กชันที่เป้าหมายหายไปแล้ว
///
/// ทำไมต้องมี: ท่ออัปโหลดสามจังหวะสร้างแถว PENDING ตอนขอ signed URL
/// ถ้าผู้ใช้ปิดแท็บกลางทาง จังหวะที่สาม (commit) จะไม่เกิด แล้วแถวนั้น
/// กับไฟล์ใน storage จะค้างอยู่ตลอดไป — `AssetsService.sweepStalePending()`
/// เขียนไว้แต่เดิมแต่ไม่มีใครเรียก จึงเป็นโค้ดที่ไม่เคยทำงาน
///
/// ใช้ setInterval ไม่ใช่ @nestjs/schedule เพื่อไม่เพิ่ม dependency —
/// backend ตัวนี้เป็นเซิร์ฟเวอร์ที่รันค้าง (ไม่ใช่ serverless) จึงถือ timer ได้
///
/// ถ้ารันหลาย instance ตัวกวาดจะทำงานซ้ำกัน ซึ่งไม่เป็นไรเพราะการลบ
/// เป็น idempotent (แถวที่หายไปแล้วก็ลบไม่เจอ) แต่ถ้าอยากให้ทำงานตัวเดียว
/// ต้องมี lock ที่ฐานข้อมูล — TODO(PL) เมื่อสเกลเป็นหลาย instance
@Injectable()
export class AssetsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssetsSweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;

  constructor(private readonly assets: AssetsService) {}

  onModuleInit(): void {
    this.firstRun = setTimeout(() => {
      void this.sweep();

      this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
      // ไม่ให้ timer กันโพรเซสไม่ให้จบ เวลาสั่งปิดเซิร์ฟเวอร์
      this.timer.unref();
    }, FIRST_SWEEP_DELAY_MS);

    this.firstRun.unref();

    this.logger.log(
      `ตัวเก็บกวาดไฟล์ค้างเริ่มทำงาน — รอบละ ${SWEEP_INTERVAL_MS / 60000} นาที`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstRun) {
      clearTimeout(this.firstRun);
    }

    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /// เรียกได้จากทั้ง timer และ endpoint ของผู้ดูแล
  ///
  /// ไม่ปล่อยให้ error หลุดออกไป เพราะ error ใน setInterval ที่ไม่มีใครจับ
  /// จะทำให้โพรเซสตายทั้งตัว — พาไฟล์แชทและห้องเสียงทั้งระบบล่มไปด้วย
  ///
  /// สามงานแยก try/catch กัน — งานหนึ่งล้มต้องไม่ทำให้อีกสองงานไม่ได้ทำ
  async sweep(): Promise<{ removed: number; purged: number; orphanReactions: number }> {
    return {
      removed: await this.safely('รายการอัปโหลดที่ค้าง', () => this.assets.sweepStalePending()),
      purged: await this.safely('ไฟล์ของเนื้อหาที่ถูกลบ', () => this.assets.purgeDeleted()),
      orphanReactions: await this.safely('รีแอ็กชันที่เป้าหมายหายไป', () =>
        this.assets.sweepOrphanReactions(),
      ),
    };
  }

  private async safely(label: string, job: () => Promise<number>): Promise<number> {
    try {
      return await job();
    } catch (error) {
      this.logger.error(
        `เก็บกวาด${label}ไม่สำเร็จ: ${
          error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'
        }`,
      );

      return 0;
    }
  }
}
