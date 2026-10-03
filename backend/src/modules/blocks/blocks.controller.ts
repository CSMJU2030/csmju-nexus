import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { BlocksService } from './blocks.service.js';
import { BlockDto, CreateBlockDto } from './dto/block.dto.js';

@ApiTags('blocks')
@Controller('blocks')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'คนที่ฉันบล็อกไว้ (ใหม่ไปเก่า)' })
  @ApiEnvelopeList(BlockDto)
  list(@CurrentUser() user: CoreHubUser, @Query() query: PaginationQuery) {
    return this.blocks.listMine(user, query);
  }

  @Post()
  @ApiOperation({
    summary: 'บล็อก (บล็อกซ้ำไม่ผิด)',
    description:
      'ผลทั้งสองทาง: เลิกติดตามกันทั้งคู่ · ติดตามกันไม่ได้ · เปิด/ส่ง DM 1:1 ไม่ได้ · คอมเมนต์คลิป/โพสต์ของกันไม่ได้ · ตอบสตอรี่ไม่ได้ · ซ่อนจากค้นหา คนที่น่าติดตาม ฟีด แถวสตอรี่ โน้ต · โปรไฟล์ของผู้บล็อกตอบ 404 กับคนที่ถูกบล็อก · แชทกลุ่มยังใช้ได้ตามปกติ',
  })
  @ApiEnvelope(BlockDto, { status: 201 })
  @ApiEnvelopeError(400, 'บล็อกตัวเองไม่ได้')
  block(@CurrentUser() user: CoreHubUser, @Body() dto: CreateBlockDto) {
    return this.blocks.block(user, dto.coreUserId);
  }

  @Delete(':coreUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เลิกบล็อก (ไม่ได้บล็อกอยู่ก็ไม่ผิด) — การติดตามเดิมไม่กลับมาเอง' })
  async unblock(
    @CurrentUser() user: CoreHubUser,
    @Param('coreUserId') coreUserId: string,
  ) {
    await this.blocks.unblock(user, coreUserId);
  }
}
