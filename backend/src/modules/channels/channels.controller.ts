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
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { ChannelsService } from './channels.service.js';
import {
  AddMembersDto,
  ChannelResponseDto,
  ClearChannelResponseDto,
  CreateChannelDto,
  CreateDirectChannelDto,
  SetNicknameDto,
  UpdateChannelDto,
  UpdateInboxDto,
} from './dto/channel.dto.js';

/// เพดานของคอลัมน์ `Int` ในฐานข้อมูล
///
/// **ต้องมี ไม่งั้นค่าที่เกินช่วงจะกลายเป็น 500** — Prisma ส่งต่อให้ Postgres
/// แล้ว Postgres ปฏิเสธเพราะล้นช่วง ซึ่งโผล่เป็น Internal Server Error
/// ทั้งที่เป็นข้อมูลจากผู้ใช้ที่ไม่ถูกต้อง (ต้องเป็น 400 และบอกว่าผิดตรงไหน)
///
/// เจอจริงตอนหน้าบ้านเผลอส่ง `Number.MAX_SAFE_INTEGER` ของข้อความชั่วคราว
const MAX_SEQ = 2_147_483_647;

export class MarkReadDto {
  @ApiProperty({ example: 1421, maximum: MAX_SEQ })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SEQ, { message: 'ลำดับข้อความเกินช่วงที่เป็นไปได้' })
  seq!: number;
}

export class MarkReadResponseDto {
  @ApiProperty({ example: 1421 }) lastReadSeq!: number;
}

export class AddMembersResponseDto {
  @ApiProperty({ example: 3 }) added!: number;
}

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @ApiOperation({
    summary: 'กล่องข้อความของฉัน: ปักหมุดก่อน แล้วเรียงตามความเคลื่อนไหวล่าสุด',
    description:
      'ทุกแถวบอก inboxFolder (PRIMARY/GENERAL/HIDDEN/REQUEST) ให้หน้าบ้านแยกแท็บเอง · ห้องที่ลบแชทไปแล้วและยังไม่มีข้อความใหม่ไม่อยู่ในรายการ',
  })
  @ApiEnvelopeList(ChannelResponseDto)
  list(@CurrentUser() user: CoreHubUser, @Query() query: PaginationQuery) {
    return this.channels.listMine(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'สร้างห้องกลุ่ม ห้องประจำวิชา หรือห้องเสียง' })
  @ApiEnvelope(ChannelResponseDto, { status: 201 })
  @ApiEnvelopeError(403, 'นักศึกษาสร้างห้องประจำวิชาไม่ได้')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateChannelDto) {
    return this.channels.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดห้อง (ต้องเป็นสมาชิก)' })
  @ApiEnvelope(ChannelResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  findOne(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channels.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'แก้ชื่อหรือวัตถุประสงค์ของห้อง (ผู้สร้าง ผู้ดูแลห้อง หรือผู้ดูแลระบบ)',
  })
  @ApiEnvelope(ChannelResponseDto)
  @ApiEnvelopeError(403, 'ไม่ใช่ผู้สร้างหรือผู้ดูแลห้อง')
  update(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channels.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ลบห้องทั้งห้อง พร้อมข้อความ ห้องเสียง และนัดประชุม (กู้คืนไม่ได้)',
    description:
      'ผู้สร้างห้อง ผู้ดูแลห้อง หรือผู้ดูแลระบบเท่านั้น · ลบแชทส่วนตัวไม่ได้ · บันทึกสิ่งที่ถูกลบไว้ใน audit log',
  })
  @ApiEnvelopeError(403, 'ไม่ใช่ผู้สร้างหรือผู้ดูแลห้อง หรือเป็นแชทส่วนตัว')
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  async remove(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.channels.remove(user, id);
  }

  @Patch(':id/inbox')
  @ApiOperation({
    summary: 'จัดห้องในกล่องข้อความของฉัน — ย้ายแฟ้ม ปักหมุด ปิดเสียง',
    description:
      'มีผลกับผู้เรียกคนเดียว · folder: PRIMARY / GENERAL / HIDDEN (ย้ายคำขอข้อความไป PRIMARY = ยอมรับคำขอ) · pinned: ปักไว้บนสุด · muted: ไม่สร้างแจ้งเตือนเรื่องข้อความ (MENTION, THREAD_REPLY, REACTION บนข้อความ) แต่ยังนับยังไม่อ่าน',
  })
  @ApiEnvelope(ChannelResponseDto)
  @ApiEnvelopeError(400, 'ไม่ได้ส่งอะไรมาให้แก้ หรือค่าไม่ถูกต้อง')
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  updateInbox(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInboxDto,
  ) {
    return this.channels.updateInbox(user, id, dto);
  }

  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ลบแชท (เฉพาะฝั่งฉัน) แบบ Instagram',
    description:
      'ไม่ลบข้อความจริง — ข้อความก่อนเวลานี้จะไม่ถูกส่งให้ผู้เรียกอีก (รายการข้อความ เธรด ปักหมุด) อีกฝ่ายยังเห็นครบ · ห้องหายจากกล่องข้อความจนกว่าจะมีข้อความใหม่ · ยังไม่อ่านถูกล้าง',
  })
  @ApiEnvelope(ClearChannelResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  clear(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channels.clear(user, id);
  }

  @Put(':id/members/:coreUserId/nickname')
  @ApiOperation({
    summary: 'ตั้งหรือลบชื่อเล่นของสมาชิกในแชทนี้ (DM/แชทกลุ่ม)',
    description:
      'สมาชิกทุกคนตั้งให้ใครในห้องก็ได้ รวมตัวเอง · nickname: null = ลบ · กระจาย socket channel:updated พร้อม nicknames ทั้งห้อง',
  })
  @ApiEnvelope(ChannelResponseDto)
  @ApiEnvelopeError(400, 'ไม่ใช่ DM/แชทกลุ่ม หรือชื่อเล่นยาวเกิน 40')
  @ApiEnvelopeError(404, 'ไม่พบห้อง ไม่ได้เป็นสมาชิก หรือคนนี้ไม่ได้อยู่ในห้อง')
  setNickname(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('coreUserId') coreUserId: string,
    @Body() dto: SetNicknameDto,
  ) {
    return this.channels.setNickname(user, id, coreUserId, dto.nickname);
  }

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ทำเครื่องหมายว่ายังไม่ได้อ่าน',
    description:
      'ถอยหมุดอ่านไปก่อนข้อความล่าสุดหนึ่งข้อความ → unreadCount ≥ 1 และ markedUnread = true · ล้างเองเมื่อบันทึกหมุดอ่านครั้งถัดไป',
  })
  @ApiEnvelope(ChannelResponseDto)
  @ApiEnvelopeError(400, 'ห้องยังไม่มีข้อความ')
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  markUnread(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channels.markUnread(user, id);
  }

  @Post(':id/members')
  @ApiOperation({
    summary: 'เพิ่มสมาชิกเข้าห้อง (ผู้ดูแลห้อง อาจารย์ เจ้าหน้าที่ หรือผู้ดูแลระบบ)',
    description:
      'คนที่อยู่ในห้องแล้วข้ามให้ (added นับเฉพาะคนใหม่) · คนใหม่ได้แจ้งเตือน CHANNEL_INVITE · กระจาย socket channel:members ให้แผงสมาชิกอัปเดตทันที',
  })
  @ApiEnvelope(AddMembersResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'เป็นแชทส่วนตัว หรือแชทกลุ่มเกิน 32 คน')
  @ApiEnvelopeError(403, 'ไม่ใช่ผู้ดูแลห้องหรือบุคลากร')
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  addMembers(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.channels.addMembers(user, id, dto);
  }

  @Delete(':id/members/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ออกจากห้อง',
    description: 'กระจาย socket channel:members (removed = ผู้เรียก) ให้คนที่ยังอยู่ในห้อง',
  })
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  async leave(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.channels.leave(user, id);
  }

  /// ต้องประกาศ **หลัง** `:id/members/me` — ไม่งั้น "me" ถูกจับเป็น coreUserId
  @Delete(':id/members/:coreUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'นำสมาชิกคนอื่นออกจากห้อง (ผู้ดูแลห้อง อาจารย์ เจ้าหน้าที่ หรือผู้ดูแลระบบ)',
    description:
      'ห้องกลุ่ม ห้องประจำวิชา ห้องเสียง และแชทกลุ่ม · นำผู้ดูแลห้องออกได้เฉพาะผู้สร้างห้องหรือผู้ดูแลระบบ · นำผู้สร้างห้องออกได้เฉพาะผู้ดูแลระบบ · บันทึก audit log · กระจาย socket channel:members แล้วเตะคนนั้นออกจากห้องของ socket',
  })
  @ApiEnvelopeError(400, 'เป็นแชทส่วนตัว หรือพยายามนำตัวเองออก (ใช้ DELETE /members/me)')
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์นำคนนี้ออก')
  @ApiEnvelopeError(404, 'ไม่พบห้อง ไม่ได้เป็นสมาชิก หรือคนนี้ไม่ได้อยู่ในห้อง')
  async removeMember(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('coreUserId') coreUserId: string,
  ) {
    await this.channels.removeMember(user, id, coreUserId);
  }

  @Post(':id/read-markers')
  @ApiOperation({ summary: 'บันทึกว่าอ่านถึงข้อความลำดับใดแล้ว' })
  @ApiEnvelope(MarkReadResponseDto, { status: 201 })
  markRead(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.channels.markRead(user, id, dto.seq);
  }
}

@ApiTags('direct-channels')
@Controller('direct-channels')
export class DirectChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post()
  @ApiOperation({
    summary: 'เปิดแชทส่วนตัว หรือสร้างแชทกลุ่ม',
    description:
      'peerCoreUserId หรือ peerCoreUserIds ที่มีคนเดียว = แชทส่วนตัว (คืนห้องเดิมถ้ามี) · peerCoreUserIds 2-31 คน = สร้างแชทกลุ่มใหม่ (GROUP_DM) ผู้เรียกเป็นผู้ดูแล ตั้งชื่อด้วย name ได้',
  })
  @ApiEnvelope(ChannelResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'สร้างห้องกับตัวเองไม่ได้ ไม่ได้ระบุคน หรือเกิน 32 คน')
  create(
    @CurrentUser() user: CoreHubUser,
    @Body() dto: CreateDirectChannelDto,
  ) {
    return this.channels.createOrFindDirect(user, dto);
  }
}
