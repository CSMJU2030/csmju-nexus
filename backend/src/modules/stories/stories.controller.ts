import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CoreRoles } from '../../common/auth/core-roles.decorator.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { DeliveryResultDto, StoryReplyDto } from '../channels/dto/message.dto.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import {
  CreateStoryDto,
  StoryArchiveItemDto,
  StoryInsightsDto,
  StoryItemDto,
  StoryTrayDto,
  StoryViewerDto,
} from './dto/story.dto.js';
import { StoriesService } from './stories.service.js';

@ApiTags('stories')
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'แถวสตอรี่บนสุดของฟีด จัดกลุ่มตามเจ้าของ',
    description:
      'เห็นของตัวเองและของคนที่ติดตาม · สตอรี่ที่หมดอายุถูกกรองออกตอนอ่าน จึงหายตรงเวลาแม้ตัวเก็บกวาดไม่ได้รัน · ของตัวเองอยู่ซ้ายสุด แล้วเรียงคนที่ยังมีของไม่ได้ดูขึ้นก่อน',
  })
  @ApiEnvelope(StoryTrayDto)
  tray(@CurrentUser() user: CoreHubUser) {
    return this.stories.tray(user);
  }

  @Get('archive')
  @ApiOperation({
    summary: 'คลังสตอรี่ของฉัน — ทุกชิ้นรวมที่หมดอายุแล้ว ใหม่ไปเก่า',
    description:
      'เห็นได้เฉพาะเจ้าของ · สตอรี่ไม่ถูกลบเมื่อหมดอายุแล้ว (หายจากแถวสตอรี่ แต่ยังอยู่ที่นี่และในไฮไลต์) · mediaUrl อายุ 5 นาที',
  })
  @ApiEnvelopeList(StoryArchiveItemDto)
  archive(@CurrentUser() user: CoreHubUser, @Query() query: PaginationQuery) {
    return this.stories.archive(user, query);
  }

  @Post()
  @ApiOperation({
    summary: 'โพสต์สตอรี่จากไฟล์ที่อัปโหลดเสร็จแล้ว (อายุ 24 ชั่วโมง)',
  })
  @ApiEnvelope(StoryItemDto, { status: 201, description: 'โพสต์แล้ว' })
  @ApiEnvelopeError(400, 'ไฟล์ไม่ใช่รูปหรือวิดีโอ ยังไม่ commit หรือถูกใช้ไปแล้ว')
  @ApiEnvelopeError(403, 'โพสต์จากไฟล์ของคนอื่นไม่ได้')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(user, dto);
  }

  @Post(':id/views')
  @ApiOperation({
    summary: 'บันทึกว่าดูสตอรี่แล้ว',
    description:
      'กดซ้ำไม่เพิ่มยอด · ยอดผู้ชมที่คืนมาเป็น 0 ถ้าผู้เรียกไม่ใช่เจ้าของ เพราะคนอื่นไม่ควรรู้ว่าสตอรี่นี้มีคนดูกี่คน',
  })
  @ApiEnvelopeError(404, 'ไม่พบสตอรี่ หมดอายุ หรือไม่ได้ติดตามเจ้าของ')
  markViewed(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.markViewed(user, id);
  }

  @Post(':id/replies')
  @ApiOperation({
    summary: 'ตอบกลับสตอรี่ (พิมพ์ หรือกดอิโมจิ) — ส่งเป็นข้อความเข้า DM กับเจ้าของ',
    description:
      'content หรือ emoji อย่างใดอย่างหนึ่ง · ข้อความที่ได้มี embed ชนิด STORY และ storyReply = {kind: REPLY|REACTION, emoji} · เจ้าของได้แจ้งเตือน STORY_REPLY · ตอบของตัวเองไม่ได้ · บล็อกกัน = 403',
  })
  @ApiEnvelope(DeliveryResultDto, { status: 201 })
  @ApiEnvelopeError(400, 'ส่งไม่ครบ/ส่งทั้งสองอย่าง หรือตอบสตอรี่ของตัวเอง')
  @ApiEnvelopeError(403, 'บล็อกกันอยู่')
  @ApiEnvelopeError(404, 'ไม่พบสตอรี่ หมดอายุ หรือไม่ได้ติดตามเจ้าของ')
  reply(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StoryReplyDto,
  ) {
    return this.stories.reply(user, id, dto);
  }

  @Get(':id/insights')
  @ApiOperation({ summary: 'สถิติของสตอรี่ (ผู้ชม · ตอบกลับ · อิโมจิ) — เจ้าของเท่านั้น' })
  @ApiEnvelope(StoryInsightsDto)
  @ApiEnvelopeError(403, 'ไม่ใช่สตอรี่ของผู้เรียก')
  @ApiEnvelopeError(404, 'ไม่พบสตอรี่')
  insights(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.insights(user, id);
  }

  @Get(':id/viewers')
  @ApiOperation({
    summary: 'รายชื่อผู้ชม — เจ้าของสตอรี่เท่านั้น',
  })
  @ApiEnvelopeList(StoryViewerDto)
  @ApiEnvelopeError(403, 'ดูรายชื่อผู้ชมของคนอื่นไม่ได้')
  viewers(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQuery,
  ) {
    return this.stories.viewers(user, id, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบสตอรี่ (เจ้าของ หรือผู้ดูแลองค์กร)' })
  @ApiEnvelopeError(403, 'ลบสตอรี่ของคนอื่นไม่ได้')
  async remove(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stories.remove(user, id);
  }

  /// คงเส้นทางไว้เพื่อไม่ให้สัญญาเดิมพัง (แผงผู้ดูแลและเทสต์สิทธิ์ยังเรียกอยู่)
  /// แต่ไม่ลบอะไรแล้ว — สตอรี่ที่หมดอายุคือคลังของเจ้าของและเป็นเนื้อของไฮไลต์
  /// ถ้ายังลบ ไฮไลต์บนโปรไฟล์จะว่างเปล่าในวันถัดไป
  @Post('maintenance/sweeps')
  @CoreRoles('admin')
  @ApiOperation({
    summary: 'เลิกใช้แล้ว — สตอรี่ที่หมดอายุไม่ถูกลบอีก (คืน removed: 0 เสมอ)',
    description:
      'ตั้งแต่มีคลังสตอรี่และไฮไลต์ สตอรี่หายจากระบบเมื่อเจ้าของลบเองเท่านั้น · คงเส้นทางไว้ให้ผู้เรียกเดิมไม่พัง',
    deprecated: true,
  })
  @ApiEnvelopeError(403, 'เฉพาะผู้ดูแลระดับองค์กร')
  sweep() {
    return { removed: 0 };
  }
}
