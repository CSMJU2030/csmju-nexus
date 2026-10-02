import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
} from '../../common/http/api-envelope.decorator.js';
import {
  CreateHighlightDto,
  HighlightDetailDto,
  HighlightSummaryDto,
  UpdateHighlightDto,
} from './dto/highlight.dto.js';
import { HighlightsService } from './highlights.service.js';

@ApiTags('highlights')
@Controller('highlights')
export class HighlightsController {
  constructor(private readonly highlights: HighlightsService) {}

  @Post()
  @ApiOperation({
    summary: 'สร้างไฮไลต์จากสตอรี่ของตัวเอง (รวมที่หมดอายุแล้ว)',
  })
  @ApiEnvelope(HighlightDetailDto, { status: 201 })
  @ApiEnvelopeError(400, 'ชื่อหรือรายการสตอรี่ไม่ถูกต้อง หรือหน้าปกไม่อยู่ในรายการ')
  @ApiEnvelopeError(403, 'มีสตอรี่ของคนอื่นปนมา')
  @ApiEnvelopeError(404, 'ไม่พบสตอรี่บางชิ้น')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateHighlightDto) {
    return this.highlights.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'ดูไฮไลต์พร้อมสตอรี่ทุกชิ้นตามลำดับ (ผู้ใช้ที่ล็อกอินทุกคน)',
    description: 'สตอรี่ที่หมดอายุแล้วยังเล่นได้ที่นี่ — นั่นคือหน้าที่ของไฮไลต์ · mediaUrl อายุ 5 นาที',
  })
  @ApiEnvelope(HighlightDetailDto)
  @ApiEnvelopeError(404, 'ไม่พบไฮไลต์')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.highlights.detail(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'แก้ชื่อ รายการสตอรี่ (แทนที่ทั้งชุด) หรือหน้าปก — เจ้าของเท่านั้น',
  })
  @ApiEnvelope(HighlightDetailDto)
  @ApiEnvelopeError(403, 'ไม่ใช่ไฮไลต์ของผู้เรียก หรือมีสตอรี่ของคนอื่นปนมา')
  @ApiEnvelopeError(404, 'ไม่พบไฮไลต์หรือสตอรี่บางชิ้น')
  update(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHighlightDto,
  ) {
    return this.highlights.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบไฮไลต์ (สตอรี่ยังอยู่ในคลัง) — เจ้าของเท่านั้น' })
  @ApiEnvelopeError(403, 'ไม่ใช่ไฮไลต์ของผู้เรียก')
  @ApiEnvelopeError(404, 'ไม่พบไฮไลต์')
  async remove(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.highlights.remove(user, id);
  }
}

/// ไฮไลต์ของโปรไฟล์หนึ่ง — อยู่ใต้ /profiles ตามหน้าที่ใช้ (หน้าโปรไฟล์)
/// แยก controller เพราะ ProfilesModule ไม่ควรต้องรู้จักไฟล์สตอรี่
@ApiTags('highlights')
@Controller('profiles')
export class ProfileHighlightsController {
  constructor(private readonly highlights: HighlightsService) {}

  @Get(':coreUserId/highlights')
  @ApiOperation({
    summary: 'ไฮไลต์บนโปรไฟล์ของคนหนึ่ง ใหม่ไปเก่า',
    description: 'อาเรย์ (ไม่แบ่งหน้า สูงสุด 100) · coverMediaUrl อายุ 5 นาที · null ถ้าไม่มีหน้าปก',
  })
  @ApiEnvelope(HighlightSummaryDto)
  list(@Param('coreUserId') coreUserId: string) {
    return this.highlights.listForProfile(coreUserId);
  }
}
