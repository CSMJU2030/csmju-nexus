import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import {
  CreateMeetingDto,
  ListMeetingsQuery,
  MeetingResponseDto,
} from './dto/meeting.dto.js';
import { MeetingsService } from './meetings.service.js';

@ApiTags('meetings')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @ApiOperation({
    summary: 'นัดประชุมในห้องที่ฉันเป็นสมาชิก (ใกล้ที่สุดอยู่บนสุด)',
  })
  @ApiEnvelopeList(MeetingResponseDto)
  list(
    @CurrentUser() user: CoreHubUser,
    @Query() query: ListMeetingsQuery,
  ) {
    return this.meetings.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดนัดประชุมหนึ่งรายการ' })
  @ApiEnvelope(MeetingResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบนัด หรือไม่ได้เป็นสมาชิกห้องนั้น')
  findOne(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'นัดประชุมล่วงหน้า แล้วแจ้งสมาชิกทุกคนในห้อง' })
  @ApiEnvelope(MeetingResponseDto, { status: 201, description: 'นัดแล้ว' })
  @ApiEnvelopeError(400, 'ช่วงเวลาไม่ถูกต้อง (สั้นกว่า 5 นาที หรือยาวเกิน 8 ชั่วโมง)')
  @ApiEnvelopeError(403, 'นักศึกษาที่ไม่ใช่ผู้ดูแลห้องนัดประชุมไม่ได้')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(user, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'ยกเลิกนัด',
    description: 'ไม่ลบทิ้ง แต่เปลี่ยนสถานะเป็น CANCELLED แล้วแจ้งทุกคนในห้อง',
  })
  @ApiEnvelope(MeetingResponseDto)
  @ApiEnvelopeError(403, 'ยกเลิกได้เฉพาะนัดที่ตัวเองสร้าง')
  cancel(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.meetings.cancel(user, id);
  }
}
