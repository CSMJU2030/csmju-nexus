import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { ReportTarget } from '../../generated/prisma/enums.js';
import {
  CreateReportDto,
  ListReportsQuery,
  ReportResponseDto,
  ResolveReportDto,
  toReportResponse,
} from './dto/report.dto.js';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /// แจ้งรายงานเนื้อหา
  ///
  /// unique(reporter, targetKind, targetId) ทำให้คนเดิมรายงานเรื่องเดิมซ้ำไม่ได้
  /// ซึ่งกันทั้งการกดพลาดและการปั่นยอดรายงานเพื่อกลั่นแกล้งคนอื่น
  async create(
    user: CoreHubUser,
    dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    if (dto.targetKind === 'SYSTEM') {
      return this.createSystemReport(user, dto);
    }

    await this.assertTargetExists(dto.targetKind, dto.targetId);

    if (dto.targetKind === 'USER' && dto.targetId === user.coreUserId) {
      throw new BadRequestException('รายงานตัวเองไม่ได้');
    }

    const existing = await this.prisma.report.findUnique({
      where: {
        reporterCoreUserId_targetKind_targetId: {
          reporterCoreUserId: user.coreUserId,
          targetKind: dto.targetKind,
          targetId: dto.targetId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'คุณรายงานเรื่องนี้ไว้แล้ว ผู้ดูแลกำลังตรวจสอบ',
      );
    }

    const report = await this.prisma.report.create({
      data: {
        reporterCoreUserId: user.coreUserId,
        targetKind: dto.targetKind,
        targetId: dto.targetId,
        reason: dto.reason,
      },
    });

    return toReportResponse(report);
  }

  /// "รายงานปัญหา" ของตัวแอป (เมนู ≡ แบบ Instagram)
  ///
  /// ต่างจากรายงานเนื้อหาสองข้อ:
  ///   1. ไม่มีสิ่งที่ต้องตรวจว่ามีอยู่จริง — ผู้ใช้กำลังบอกว่า "แอปพัง"
  ///   2. **รายงานซ้ำได้** — คนเดียวเจอปัญหาหลายเรื่องในหลายวันได้ตามปกติ แต่
  ///      unique(reporter, kind, targetId) ของตารางจะทำให้คนหนึ่งรายงานได้
  ///      ครั้งเดียวตลอดชีวิต จึงต่อท้าย targetId ด้วยรหัสสุ่มแปดหลัก
  ///      (`app` → `app#1a2b3c4d`) แทนการรื้อกฎ unique ที่กันการปั่นรายงานเนื้อหา
  ///
  /// ไปอยู่คิวเดียวกับรายงานเนื้อหา (GET /reports) เพื่อให้ผู้ดูแลเห็นที่เดียว
  private async createSystemReport(
    user: CoreHubUser,
    dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    const report = await this.prisma.report.create({
      data: {
        reporterCoreUserId: user.coreUserId,
        targetKind: 'SYSTEM',
        targetId: `${dto.targetId}#${randomUUID().slice(0, 8)}`,
        reason: dto.reason,
      },
    });

    return toReportResponse(report);
  }

  /// รายงานที่ฉันเคยแจ้ง — ผู้ใช้ทั่วไปเห็นได้แค่ของตัวเอง
  async listMine(
    user: CoreHubUser,
    query: ListReportsQuery,
  ): Promise<Paginated<ReportResponseDto>> {
    const where = {
      reporterCoreUserId: user.coreUserId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetKind ? { targetKind: query.targetKind } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.report.count({ where }),
    ]);

    return new Paginated(rows.map(toReportResponse), query.meta(total));
  }

  /// คิวของผู้ดูแล — default เอาเฉพาะที่ยังไม่จัดการ
  async listForModerators(
    query: ListReportsQuery,
  ): Promise<Paginated<ReportResponseDto>> {
    const where = {
      status: query.status ?? 'OPEN',
      ...(query.targetKind ? { targetKind: query.targetKind } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        // เก่าสุดก่อน — คิวร้องเรียนต้องเป็น FIFO ไม่ใช่ให้เรื่องใหม่แซง
        orderBy: { createdAt: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.report.count({ where }),
    ]);

    return new Paginated(rows.map(toReportResponse), query.meta(total));
  }

  /// ปิดเรื่อง — บันทึกลง audit log ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ
  ///
  /// Blueprint หน้า 3 กำหนดให้ Admin Panel กลางอ่าน audit log ของระบบย่อยได้
  /// การตัดสินเรื่องร้องเรียนคือสิ่งที่ต้องตรวจย้อนหลังได้มากที่สุดในระบบ
  async resolve(
    user: CoreHubUser,
    id: string,
    dto: ResolveReportDto,
  ): Promise<ReportResponseDto> {
    const report = await this.prisma.report.findUnique({ where: { id } });

    if (!report) {
      throw new NotFoundException('ไม่พบรายงานนี้');
    }

    if (report.status !== 'OPEN') {
      throw new ConflictException(
        `รายงานนี้ถูกปิดไปแล้วโดย ${report.resolvedByCoreUserId ?? 'ผู้ดูแล'}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedByCoreUserId: user.coreUserId,
          resolvedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: `report.${dto.status.toLowerCase()}`,
          targetKind: report.targetKind,
          targetId: report.targetId,
          metadata: {
            report_id: id,
            reporter_core_user_id: report.reporterCoreUserId,
            note: dto.note ?? null,
          },
        },
      });

      return toReportResponse(updated);
    });
  }

  /// ตรวจว่าสิ่งที่รายงานมีอยู่จริง
  ///
  /// ถ้าไม่ตรวจ คิวของผู้ดูแลจะเต็มไปด้วยเรื่องที่เปิดดูไม่ได้ แล้วเวลาของ
  /// คนตรวจจะหมดไปกับการยืนยันว่า "ของชิ้นนี้ไม่มีอยู่จริง" ทีละเรื่อง
  private async assertTargetExists(
    kind: ReportTarget,
    id: string,
  ): Promise<void> {
    const exists = await this.targetExists(kind, id);

    if (!exists) {
      throw new NotFoundException('ไม่พบสิ่งที่รายงาน อาจถูกลบไปแล้ว');
    }
  }

  private async targetExists(
    kind: ReportTarget,
    id: string,
  ): Promise<boolean> {
    const select = { id: true };

    switch (kind) {
      case 'REEL':
        return Boolean(
          await this.prisma.reel.findUnique({ where: { id }, select }),
        );
      case 'POST':
        return Boolean(
          await this.prisma.post.findUnique({ where: { id }, select }),
        );
      case 'MESSAGE':
        return Boolean(
          await this.prisma.message.findUnique({ where: { id }, select }),
        );
      case 'COMMENT': {
        // คอมเมนต์อยู่สองตาราง (ใต้คลิป และใต้กระทู้) — ยอมรับทั้งสอง
        const [onReel, onPost] = await Promise.all([
          this.prisma.reelComment.findUnique({ where: { id }, select }),
          this.prisma.postComment.findUnique({ where: { id }, select }),
        ]);

        return Boolean(onReel ?? onPost);
      }
      case 'USER':
      default:
        // USER: targetId คือ coreUserId ไม่ใช่ uuid — คนที่ยังไม่เคยเข้าระบบย่อย
        // นี้จะไม่มีแถวใน subsystem_members จึงยังรายงานไม่ได้ ซึ่งถูกต้องแล้ว
        // เพราะเขาไม่มีเนื้อหาอะไรในระบบเราให้ต้องรายงาน
        return Boolean(
          await this.prisma.subsystemMember.findUnique({
            where: { coreUserId: id },
            select: { coreUserId: true },
          }),
        );
    }
  }
}
