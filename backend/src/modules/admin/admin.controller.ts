import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import { CoreRoles } from '../../common/auth/core-roles.decorator.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { AdminService } from './admin.service.js';
import {
  AuditLogResponseDto,
  ListAuditLogsQuery,
  ListMembersQuery,
  MemberResponseDto,
  UpdateMemberQuotaDto,
  UpdateMemberRoleDto,
} from './dto/admin.dto.js';

/// Audit log — เปิดให้ผู้ดูแลระดับองค์กรอ่าน (Blueprint หน้า 3)
///
/// แยกเป็น controller ของตัวเองเพราะ URL ต้องเป็น /api/v1/audit-logs
/// ตามกฎคำนามพหูพจน์ ไม่ใช่ /api/v1/admin/audit-logs
@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @CoreRoles('admin')
  @ApiOperation({
    summary: 'อ่าน audit log ของระบบย่อยนี้ (ผู้ดูแลองค์กร)',
    description:
      'กรองได้ตามผู้กระทำ การกระทำ และช่วงเวลา · การกระทำที่บันทึกไว้: reel.delete, post.delete, message.delete, report.resolved, report.rejected, member.role_change, member.quota_change',
  })
  @ApiEnvelopeList(AuditLogResponseDto)
  @ApiEnvelopeError(403, 'เฉพาะผู้ดูแลระดับองค์กร')
  list(@Query() query: ListAuditLogsQuery) {
    return this.admin.listAuditLogs(query);
  }
}

/// การจัดการสมาชิกของระบบย่อย — ต่อจาก MembersController ที่มีแค่ GET /me
@ApiTags('subsystem-members')
@Controller('subsystem-members')
export class MembersAdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @CoreRoles('staff', 'admin')
  @ApiOperation({ summary: 'รายชื่อสมาชิกระบบย่อยพร้อมสิทธิ์และโควตา' })
  @ApiEnvelopeList(MemberResponseDto)
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์ดูรายชื่อสมาชิก')
  list(@Query() query: ListMembersQuery) {
    return this.admin.listMembers(query);
  }

  @Patch(':coreUserId/role')
  @CoreRoles('admin')
  @ApiOperation({
    summary: 'เปลี่ยนสิทธิ์ Layer 2 ของสมาชิก',
    description:
      'แก้ได้เฉพาะสิทธิ์ในระบบย่อยนี้ (Layer 2) เพราะเป็น Local Data ตาม Blueprint หน้า 11 · สิทธิ์ระดับองค์กร (Layer 1) ต้องไปแก้ที่ Admin Panel กลาง',
  })
  @ApiEnvelope(MemberResponseDto)
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์ หรือเป็นผู้ดูแลคนสุดท้ายที่ลดสิทธิ์ตัวเอง')
  updateRole(
    @CurrentUser() user: CoreHubUser,
    @Param('coreUserId') coreUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.admin.updateRole(user, coreUserId, dto);
  }

  @Patch(':coreUserId/storage-quota')
  @CoreRoles('admin')
  @ApiOperation({
    summary: 'ตั้งโควตาพื้นที่เก็บไฟล์ให้สมาชิก',
    description:
      'ค่าเริ่มต้น 200 MB พอสำหรับนักศึกษา แต่ไม่พอสำหรับอาจารย์ที่อัปคลิปสอน · เพดานที่ตั้งได้คือ 5 GB · ตั้งล่วงหน้าก่อนเจ้าตัวเข้าระบบครั้งแรกได้ เพื่อเตรียมไว้ก่อนเปิดเทอม',
  })
  @ApiEnvelope(MemberResponseDto)
  @ApiEnvelopeError(400, 'เกินเพดาน 5 GB')
  updateQuota(
    @CurrentUser() user: CoreHubUser,
    @Param('coreUserId') coreUserId: string,
    @Body() dto: UpdateMemberQuotaDto,
  ) {
    return this.admin.updateQuota(user, coreUserId, dto);
  }
}

/// ตัวเลขรวมของระบบย่อย — ให้ Admin Panel กลางดึงไปแสดงได้
@ApiTags('admin')
@Controller('admin-overview')
export class AdminOverviewController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @CoreRoles('staff', 'admin')
  @ApiOperation({ summary: 'สรุปตัวเลขของระบบย่อยสำหรับแดชบอร์ดผู้ดูแล' })
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์')
  overview() {
    return this.admin.overview();
  }
}
