import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
} from '../../common/http/api-envelope.decorator.js';
import { CreateShareDto, DeliveryResultDto } from './dto/message.dto.js';
import { SharesService } from './shares.service.js';

@ApiTags('shares')
@Controller('shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Post()
  @ApiOperation({
    summary: 'แชร์โพสต์ คลิป หรือสตอรี่เข้าแชท (1-20 ปลายทาง · หนึ่งข้อความต่อปลายทาง)',
    description:
      'ข้อความที่ได้มี embed = {kind, targetId, authorCoreUserId, title, preview, thumbnailUrl, thumbnailKind, available} · message = ข้อความแนบ (ไม่บังคับ ≤1000) · แชร์ได้เฉพาะสิ่งที่ผู้เรียกเห็นได้ · peerCoreUserIds เปิด DM ให้อัตโนมัติ',
  })
  @ApiEnvelope(DeliveryResultDto, { status: 201 })
  @ApiEnvelopeError(400, 'ไม่มีปลายทาง หรือเกิน 20 ปลายทาง')
  @ApiEnvelopeError(403, 'บล็อกกันกับคนปลายทาง')
  @ApiEnvelopeError(404, 'ไม่พบสิ่งที่จะแชร์ เห็นไม่ได้ หรือไม่ได้เป็นสมาชิกห้องปลายทาง')
  share(@CurrentUser() user: CoreHubUser, @Body() dto: CreateShareDto) {
    return this.shares.share(user, dto);
  }
}
