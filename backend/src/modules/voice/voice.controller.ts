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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import {
  IceServerDto,
  JoinVoiceDto,
  JoinVoiceResponseDto,
  ListVoiceSessionsQuery,
  UpdateVoiceStateDto,
  VoiceOccupantsDto,
  VoiceSessionDto,
} from './dto/voice.dto.js';
import { VoiceService } from './voice.service.js';

/// ห้องคอลเสียงแบบ always-on (Blueprint ของ AIE 4 หน้า 1)
/// เข้า-ออกอิสระ ไม่ต้องมีใครกดเริ่มห้อง
@ApiTags('voice-sessions')
@Controller('voice-sessions')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /// รายการเซิร์ฟเวอร์ช่วยเจาะ NAT ที่การโทรจริงใช้
  ///
  /// แยกเป็น endpoint ของตัวเองเพื่อให้หน้าบ้าน "ตรวจก่อนโทร" ได้โดยไม่ต้อง
  /// เข้าห้องเสียงจริง (ซึ่งจะจองที่นั่งและเปิด session ทิ้งไว้เปล่า ๆ)
  ///
  /// ไม่มีความลับในนี้: URL ของ STUN เป็นสาธารณะ ส่วน credential ของ TURN
  /// เป็นค่าชั่วคราวที่ออกให้ผู้ใช้ที่ยืนยันตัวตนแล้วเท่านั้น ซึ่งเป็นสิ่งที่
  /// เบราว์เซอร์ต้องได้รับอยู่แล้วตอนโทร
  @Get('ice-servers')
  @ApiOperation({
    summary: 'เซิร์ฟเวอร์ช่วยเจาะ NAT — ใช้ตรวจว่าเครือข่ายนี้โทรได้ไหม',
  })
  @ApiEnvelope(IceServerDto)
  iceServers() {
    return this.voice.iceServers();
  }

  @Get()
  @ApiOperation({
    summary: 'ห้องเสียงที่กำลังเปิดอยู่ (เห็นเฉพาะห้องที่ตัวเองเป็นสมาชิก)',
  })
  @ApiEnvelopeList(VoiceSessionDto)
  async list(
    @CurrentUser() user: CoreHubUser,
    @Query() query: ListVoiceSessionsQuery,
  ) {
    return this.voice.listActive(user, query.channelId);
  }

  @Post()
  @ApiOperation({
    summary: 'เข้าห้องเสียง — คืนรายชื่อคนในห้องและ ICE server สำหรับ WebRTC',
  })
  @ApiEnvelope(JoinVoiceResponseDto, { status: 201 })
  @ApiEnvelopeError(409, 'ห้องเต็มตามเพดานของ mesh P2P')
  @ApiEnvelopeError(404, 'ไม่ได้เป็นสมาชิกห้องนี้')
  join(@CurrentUser() user: CoreHubUser, @Body() dto: JoinVoiceDto) {
    return this.voice.join(user, dto.channelId);
  }

  @Patch(':id/participants/me')
  @ApiOperation({
    summary: 'แจ้งสถานะของตัวเองในห้องเสียง (ปิดไมค์ · ปิดหูฟัง · กล้อง)',
    description: 'คืนรายชื่อคนในห้องเสียงทั้งห้อง และกระจาย socket voice:occupants ถึงสมาชิกทุกคนของห้อง',
  })
  @ApiEnvelope(VoiceOccupantsDto)
  @ApiEnvelopeError(404, 'ไม่ได้อยู่ในห้องเสียงนี้')
  updateState(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoiceStateDto,
  ) {
    return this.voice.updateState(user, id, dto);
  }

  @Delete(':id/participants/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ออกจากห้องเสียง' })
  async leave(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.voice.leave(user, id);
  }
}
