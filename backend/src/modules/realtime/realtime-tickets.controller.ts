import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CoreHubUser } from '../../common/auth/core-user.js';
import { ApiEnvelope } from '../../common/http/api-envelope.decorator.js';
import { SOCKET_NAMESPACE } from '../../common/realtime/events.js';
import { RealtimeTicketsService } from './realtime-tickets.service.js';

export class RealtimeTicketResponseDto {
  @ApiProperty({ description: 'ใช้ได้ครั้งเดียว อายุ 60 วินาที' })
  ticket!: string;

  @ApiProperty() expiresAt!: string;

  @ApiProperty({ example: '/realtime' })
  namespace!: string;
}

/// ขอตั๋วเข้า WebSocket
///
/// เส้นทางนี้วิ่งผ่าน API Gateway จึงรู้ตัวตนจาก header ได้ตามปกติ แล้วเราออก
/// ตั๋วให้เอาไปต่อ socket — วิธีนี้ทำให้ไม่ต้อง verify JWT เองแม้แต่นิดเดียว
/// ซึ่งเป็นข้อห้ามในกฎเหล็กหน้า 8 ของ Blueprint
@ApiTags('realtime-tickets')
@Controller('realtime-tickets')
export class RealtimeTicketsController {
  constructor(private readonly tickets: RealtimeTicketsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ขอตั๋วสำหรับต่อ WebSocket' })
  @ApiEnvelope(RealtimeTicketResponseDto, { status: 201 })
  issue(@CurrentUser() user: CoreHubUser): RealtimeTicketResponseDto {
    const issued = this.tickets.issue(user);

    return { ...issued, namespace: SOCKET_NAMESPACE };
  }
}
