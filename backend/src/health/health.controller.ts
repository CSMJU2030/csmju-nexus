import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator.js';
import { PrismaService } from '../common/prisma/prisma.service.js';

/// `GET /api/health` — เส้นทางบังคับตาม contracts/vocabulary.json
/// (`requiredRoutes.health`) และ conformance L1-01
///
/// **อยู่นอก prefix `/api/v1` โดยเจตนา** — มาตรฐานกำหนดให้ health
/// ไม่มีเลขเวอร์ชัน เพราะตัวตรวจสถานะต้องเรียกได้เหมือนเดิมตลอดไป
/// แม้ API ธุรกิจจะขึ้น v2 แล้ว (`naming.api.healthPath`)
///
/// เดิมเส้นทางนี้เป็น `/health` เฉย ๆ ตามสัญญาฉบับที่ถูกยกเลิกไปแล้ว
/// สคริปต์ static ยังผ่านเพราะมันดูแค่ชื่อ controller แต่ conformance
/// ยิงที่ `/api/health` จริง จึงจะแดงถ้าไม่ย้าย
@ApiTags('health')
@Controller('api')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'ตรวจสถานะระบบย่อยและการเชื่อมต่อฐานข้อมูล' })
  async check() {
    const startedAt = Date.now();
    let database = 'up';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',

      /// ชื่อฟิลด์ต้องเป็น `service` ไม่ใช่ `subsystem` — conformance L1-03
      /// อ่าน `data.service` แล้วเทียบกับชื่อที่ลงทะเบียนไว้กับ Core Hub
      /// ค่าต้องตรงกับ `name:` ใน subsystem.yaml เป๊ะ ๆ (data-dictionary ข้อ 7)
      service: 'csmju-nexus',
      standardsVersion: '1.8.4',
      database,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}
