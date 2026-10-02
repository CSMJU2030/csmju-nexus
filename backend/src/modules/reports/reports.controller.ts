import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import {
  CreateReportDto,
  ListReportsQuery,
  ReportResponseDto,
  ResolveReportDto,
} from './dto/report.dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'รายงานเนื้อหาหรือผู้ใช้ที่ไม่เหมาะสม' })
  @ApiEnvelope(ReportResponseDto, { status: 201, description: 'รับเรื่องแล้ว' })
  @ApiEnvelopeError(404, 'ไม่พบสิ่งที่รายงาน')
  @ApiEnvelopeError(409, 'รายงานเรื่องนี้ไว้แล้ว')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'เรื่องที่ฉันเคยรายงาน และสถานะล่าสุด' })
  @ApiEnvelopeList(ReportResponseDto)
  listMine(
    @CurrentUser() user: CoreHubUser,
    @Query() query: ListReportsQuery,
  ) {
    return this.reports.listMine(user, query);
  }

  @Get()
  @CoreRoles('staff', 'admin')
  @ApiOperation({
    summary: 'คิวเรื่องร้องเรียนสำหรับผู้ดูแล (เก่าสุดก่อน)',
    description: 'เฉพาะบุคลากรและผู้ดูแลระดับองค์กร',
  })
  @ApiEnvelopeList(ReportResponseDto)
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์ดูคิวร้องเรียน')
  list(@Query() query: ListReportsQuery) {
    return this.reports.listForModerators(query);
  }

  @Patch(':id')
  @CoreRoles('staff', 'admin')
  @ApiOperation({ summary: 'ปิดเรื่อง — จัดการแล้ว หรือไม่เข้าข่าย' })
  @ApiEnvelope(ReportResponseDto)
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์ปิดเรื่อง')
  @ApiEnvelopeError(409, 'เรื่องนี้ถูกปิดไปแล้ว')
  resolve(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(user, id, dto);
  }
}
