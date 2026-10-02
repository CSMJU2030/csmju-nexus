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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { EventsGateway } from '../realtime/events.gateway.js';
import {
  DeliveryResultDto,
  EditMessageDto,
  ForwardMessageDto,
  ListMessagesQuery,
  MessageResponseDto,
  SendMessageDto,
} from './dto/message.dto.js';
import { MessagesService } from './messages.service.js';

/// REST ของข้อความมีไว้สองกรณี: โหลดประวัติตอนเปิดห้อง และเติมช่วงที่ขาด
/// ตอน socket หลุดแล้วต่อใหม่ (ด้วย afterSeq) การส่งข้อความปกติใช้ socket
/// แต่ก็เปิด POST ไว้ให้ client ที่ต่อ socket ไม่ได้ยังส่งได้
@ApiTags('messages')
@Controller('channels/:channelId/messages')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly events: EventsGateway,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'ประวัติข้อความในห้อง — ใส่ afterSeq เพื่อเติมเฉพาะช่วงที่ขาดหลังต่อ socket ใหม่',
  })
  @ApiEnvelopeList(MessageResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  list(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query() query: ListMessagesQuery,
  ) {
    return this.messages.list(user, channelId, query);
  }

  @Post()
  @ApiOperation({ summary: 'ส่งข้อความ (ทางเลือกสำรองของ socket)' })
  @ApiEnvelope(MessageResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'ข้อความว่าง หรือไฟล์แนบยังไม่พร้อม')
  @ApiEnvelopeError(403, 'แนบไฟล์ของคนอื่นไม่ได้')
  async send(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.messages.send(user, channelId, dto);

    // กระจายให้คนที่เปิดห้องอยู่เห็นทันที เหมือนส่งผ่าน socket
    this.events.broadcastMessage(channelId, message);

    return message;
  }

  @Get('pinned')
  @ApiOperation({
    summary: 'ข้อความที่ปักหมุดในห้องนี้ — แผงประกาศของห้อง',
  })
  @ApiEnvelopeList(MessageResponseDto)
  listPinned(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query() query: PaginationQuery,
  ) {
    return this.messages.listPinned(user, channelId, query);
  }

  @Get(':messageId/thread')
  @ApiOperation({
    summary: 'คำตอบทั้งหมดในเธรดของข้อความนี้ (เก่าไปใหม่)',
  })
  @ApiEnvelopeList(MessageResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบข้อความต้นเธรด')
  listThread(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query() query: PaginationQuery,
  ) {
    return this.messages.listThread(user, channelId, messageId, query);
  }

  @Patch(':messageId')
  @ApiOperation({
    summary: 'แก้ข้อความของตัวเอง ภายใน 15 นาทีหลังส่ง',
    description:
      'ผู้ดูแลห้องแก้ข้อความคนอื่นไม่ได้โดยตั้งใจ — ลบได้ แต่แก้ไม่ได้ เพราะการแก้คำพูดของคนอื่นแล้วยังแสดงชื่อเขาเป็นผู้เขียนคือการปลอมคำพูด',
  })
  @ApiEnvelope(MessageResponseDto)
  @ApiEnvelopeError(400, 'เกิน 15 นาทีแล้ว')
  @ApiEnvelopeError(403, 'แก้ข้อความของคนอื่นไม่ได้')
  edit(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messages.edit(user, channelId, messageId, dto);
  }

  @Post(':messageId/forwards')
  @ApiOperation({
    summary: 'ส่งต่อข้อความไปห้องอื่นหรือคนอื่น (1-20 ปลายทาง)',
    description:
      'คัดลอกข้อความ ไฟล์แนบ (สำเนาแถวที่ชี้ไฟล์เดิม ไม่นับโควตาซ้ำ) และการ์ดที่แชร์ แล้วติดป้าย forwarded · peerCoreUserIds เปิด DM ให้อัตโนมัติ · ต้องเป็นสมาชิกห้องต้นทางและทุกห้องปลายทาง · DM 1:1 กับคนที่บล็อกกัน = 403',
  })
  @ApiEnvelope(DeliveryResultDto, { status: 201 })
  @ApiEnvelopeError(400, 'ไม่มีปลายทาง เกิน 20 ปลายทาง หรือส่งหาตัวเอง')
  @ApiEnvelopeError(403, 'บล็อกกันอยู่')
  @ApiEnvelopeError(404, 'ไม่พบข้อความ หรือไม่ได้เป็นสมาชิกห้องต้นทาง/ปลายทาง')
  forward(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.messages.forward(user, channelId, messageId, dto);
  }

  @Put(':messageId/pin')
  @ApiOperation({ summary: 'ปักหมุดข้อความ (ผู้ดูแลห้องและอาจารย์)' })
  @ApiEnvelope(MessageResponseDto)
  @ApiEnvelopeError(400, 'ห้องนี้ปักหมุดครบเพดานแล้ว')
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์ปักหมุด')
  pin(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messages.setPinned(user, channelId, messageId, true);
  }

  @Delete(':messageId/pin')
  @ApiOperation({ summary: 'ถอนหมุด' })
  @ApiEnvelope(MessageResponseDto)
  unpin(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messages.setPinned(user, channelId, messageId, false);
  }

  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบข้อความ (เจ้าของ ผู้ดูแลห้อง หรือ admin องค์กร)' })
  @ApiEnvelopeError(403, 'ลบข้อความของคนอื่นไม่ได้')
  async remove(
    @CurrentUser() user: CoreHubUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    await this.messages.remove(user, channelId, messageId);
    this.events.notifyMessageDeleted(channelId, messageId);
  }
}
