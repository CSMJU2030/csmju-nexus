import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  AuditLogResponseDto,
  ListAuditLogsQuery,
  ListMembersQuery,
  MAX_QUOTA_BYTES,
  MemberResponseDto,
  toAuditLogResponse,
  toMemberResponse,
  UpdateMemberQuotaDto,
  UpdateMemberRoleDto,
} from './dto/admin.dto.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /// Audit log ของระบบย่อย
  ///
  /// Blueprint หน้า 3 กำหนดให้ Admin Panel กลางดู Audit Log ของระบบย่อยได้
  /// ตาราง audit_logs มีการเขียนลงอยู่แล้วตั้งแต่โมดูลแรก (ลบคลิป ลบข้อความ
  /// ลบโพสต์ ปิดเรื่องร้องเรียน) แต่ไม่มีทางอ่านออกมาเลยจนถึงรอบนี้ —
  /// เท่ากับเก็บหลักฐานไว้ในลิ้นชักที่เปิดไม่ได้
  async listAuditLogs(
    query: ListAuditLogsQuery,
  ): Promise<Paginated<AuditLogResponseDto>> {
    const since = query.since ? new Date(query.since) : undefined;
    const until = query.until ? new Date(query.until) : undefined;

    if (since && until && since > until) {
      throw new BadRequestException('since ต้องมาก่อน until');
    }

    const where = {
      ...(query.actorCoreUserId ? { actorCoreUserId: query.actorCoreUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(since || until
        ? {
            createdAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lte: until } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return new Paginated(rows.map(toAuditLogResponse), query.meta(total));
  }

  async listMembers(
    query: ListMembersQuery,
  ): Promise<Paginated<MemberResponseDto>> {
    const where = {
      ...(query.layer2Role ? { layer2Role: query.layer2Role } : {}),
      ...(query.q
        ? { coreUserId: { contains: query.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.subsystemMember.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.subsystemMember.count({ where }),
    ]);

    return new Paginated(rows.map(toMemberResponse), query.meta(total));
  }

  /// เปลี่ยนสิทธิ์ Layer 2 ของคนหนึ่ง
  ///
  /// สิทธิ์ Layer 2 เป็น Local Data ของระบบย่อยเรา (Blueprint หน้า 11)
  /// จึงแก้ที่นี่ได้ ต่างจาก Layer 1 ที่ต้องไปแก้ที่ Admin Panel กลาง
  ///
  /// `RolesGuard` สร้างแถวให้ตาม default mapping ตอนเจอผู้ใช้ครั้งแรก
  /// แต่หลังจากนั้นไม่มีอะไรเขียนคอลัมน์นี้อีกเลย — แปลว่าถ้าอาจารย์อยากตั้ง
  /// นักศึกษาคนหนึ่งเป็นผู้ช่วยสอน (EDITOR) จะทำไม่ได้เลยจนถึงรอบนี้
  async updateRole(
    actor: CoreHubUser,
    coreUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<MemberResponseDto> {
    // กันตัดขาตัวเอง: ผู้ดูแลคนสุดท้ายลดสิทธิ์ตัวเองแล้วจะไม่มีใครแก้กลับได้
    if (coreUserId === actor.coreUserId && dto.layer2Role !== 'ADMIN') {
      const admins = await this.prisma.subsystemMember.count({
        where: { layer2Role: 'ADMIN' },
      });

      if (admins <= 1) {
        throw new ForbiddenException(
          'คุณเป็นผู้ดูแลคนสุดท้ายของระบบย่อยนี้ — ตั้งคนอื่นเป็น ADMIN ก่อนจึงลดสิทธิ์ตัวเองได้',
        );
      }
    }

    const before = await this.prisma.subsystemMember.findUnique({
      where: { coreUserId },
    });

    return this.prisma.$transaction(async (tx) => {
      // explicit = true บอกว่านี่คือเจตนาของคน ไม่ใช่ค่าที่แปลงมาจาก
      // coreRole — resolveMember จะไม่เขียนทับค่านี้อีก
      const member = await tx.subsystemMember.upsert({
        where: { coreUserId },
        update: { layer2Role: dto.layer2Role, layer2RoleExplicit: true },
        create: {
          coreUserId,
          layer2Role: dto.layer2Role,
          layer2RoleExplicit: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: actor.coreUserId,
          actorCoreRole: actor.coreRole,
          action: 'member.role_change',
          targetKind: 'MEMBER',
          targetId: coreUserId,
          metadata: {
            from: before?.layer2Role ?? null,
            to: dto.layer2Role,
            reason: dto.reason ?? null,
          },
        },
      });

      return toMemberResponse(member);
    });
  }

  /// ตั้งโควตาพื้นที่เก็บไฟล์ให้คนหนึ่ง
  ///
  /// จำเป็นเพราะค่าเริ่มต้น 200 MB พอสำหรับนักศึกษา แต่ไม่พอสำหรับอาจารย์
  /// ที่อัปคลิปสอน และเดิมไม่มีทางเพิ่มให้เลยนอกจากไปแก้ฐานข้อมูลด้วยมือ
  ///
  /// ใช้ upsert เหมือน updateRole เพราะแถวใน subsystem_members เกิดแบบ lazy
  /// (ตอนผู้ใช้เรียก GET /me ครั้งแรก หรือตอนแตะ route ที่ต้องใช้สิทธิ์ Layer 2)
  /// ถ้าบังคับให้แถวมีอยู่ก่อน จะ **ตั้งโควตาล่วงหน้าก่อนเปิดเทอมไม่ได้** —
  /// ซึ่งเป็นเวลาเดียวที่คนจะทำงานนี้จริง คือเตรียมให้อาจารย์ก่อนเริ่มสอน
  ///
  /// ผลข้างเคียงที่ยอมรับ: พิมพ์ coreUserId ผิดจะได้แถวเปล่าค่าเริ่มต้นเพิ่มมา
  /// ซึ่งไม่มีผลอะไรเพราะไม่มีใครล็อกอินเข้ามาใช้มัน และเห็นได้ใน audit log
  async updateQuota(
    actor: CoreHubUser,
    coreUserId: string,
    dto: UpdateMemberQuotaDto,
  ): Promise<MemberResponseDto> {
    if (dto.storageQuotaBytes > MAX_QUOTA_BYTES) {
      throw new BadRequestException(
        `โควตาสูงสุดที่ตั้งได้คือ ${MAX_QUOTA_BYTES} ไบต์ (5 GB) — พื้นที่ของฟรีเทียร์มีจำกัด`,
      );
    }

    const before = await this.prisma.subsystemMember.findUnique({
      where: { coreUserId },
    });

    // ตั้งโควตาต่ำกว่าที่ใช้ไปแล้วได้ แต่ต้องรู้ตัวว่าเกิดอะไรขึ้น:
    // เขาจะอัปโหลดใหม่ไม่ได้จนกว่าจะลบของเก่าออก ซึ่งเป็นพฤติกรรมที่ถูกต้อง
    // ของการลดโควตา จึงไม่บล็อก แต่ใส่ไว้ใน audit log ให้เห็นชัด
    const belowUsage =
      BigInt(dto.storageQuotaBytes) < (before?.storageUsedBytes ?? 0n);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subsystemMember.upsert({
        where: { coreUserId },
        update: { storageQuotaBytes: BigInt(dto.storageQuotaBytes) },
        create: {
          coreUserId,
          storageQuotaBytes: BigInt(dto.storageQuotaBytes),
        },
      });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: actor.coreUserId,
          actorCoreRole: actor.coreRole,
          action: 'member.quota_change',
          targetKind: 'MEMBER',
          targetId: coreUserId,
          metadata: {
            from: before?.storageQuotaBytes.toString() ?? null,
            to: dto.storageQuotaBytes.toString(),
            used: (before?.storageUsedBytes ?? 0n).toString(),
            below_current_usage: belowUsage,
            // true = ตั้งล่วงหน้าก่อนเจ้าตัวเข้าระบบครั้งแรก
            pre_provisioned: before === null,
            reason: dto.reason ?? null,
          },
        },
      });

      return toMemberResponse(updated);
    });
  }

  /// สรุปตัวเลขของระบบย่อยสำหรับหน้าแดชบอร์ดผู้ดูแล
  async overview() {
    const [
      members,
      reels,
      posts,
      messages,
      channels,
      openReports,
      storage,
      activeVoice,
    ] = await Promise.all([
      this.prisma.subsystemMember.count(),
      this.prisma.reel.count(),
      this.prisma.post.count(),
      this.prisma.message.count({ where: { deletedAt: null } }),
      this.prisma.channel.count(),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.subsystemMember.aggregate({
        _sum: { storageUsedBytes: true },
      }),
      this.prisma.voiceSession.count({ where: { endedAt: null } }),
    ]);

    return {
      subsystem: 'csmju-nexus',
      standardsVersion: '1.2.0',
      memberCount: members,
      reelCount: reels,
      postCount: posts,
      messageCount: messages,
      channelCount: channels,
      openReportCount: openReports,
      // ผลรวมเป็น BigInt เพราะรวมกันเกิน 2^53 ได้ ส่งเป็น string ตามมาตรฐาน
      storageUsedBytes: (storage._sum.storageUsedBytes ?? 0n).toString(),
      activeVoiceSessionCount: activeVoice,
      defaultRoleMapping: {
        admin: RolesGuard.defaultLayer2Role('admin'),
        staff: RolesGuard.defaultLayer2Role('staff'),
        student: RolesGuard.defaultLayer2Role('student'),
        alumni: RolesGuard.defaultLayer2Role('alumni'),
      },
    };
  }
}
