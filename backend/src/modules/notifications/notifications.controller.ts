import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ListNotificationsQuery,
  NotificationResponseDto,
  UnreadCountDto,
} from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'การแจ้งเตือนของฉัน เรียงใหม่ไปเก่า' })
  @ApiEnvelopeList(NotificationResponseDto)
  list(
    @CurrentUser() user: CoreHubUser,
    @Query() query: ListNotificationsQuery,
  ) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'จำนวนที่ยังไม่อ่าน สำหรับตัวเลขแดงบนกระดิ่ง',
    description:
      'แยกเป็น endpoint ของตัวเองเพราะหน้าบ้านต้องการแค่เลขเดียวทุกครั้งที่เปลี่ยนหน้า ไม่ควรต้องโหลดรายการทั้งหน้ามาเพื่อนับ',
  })
  @ApiEnvelope(UnreadCountDto)
  unreadCount(@CurrentUser() user: CoreHubUser) {
    return this.notifications.unreadCount(user);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด' })
  markAllRead(@CurrentUser() user: CoreHubUser) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'ทำเครื่องหมายว่าอ่านแล้วหนึ่งรายการ' })
  @ApiEnvelope(UnreadCountDto)
  @ApiEnvelopeError(404, 'ไม่พบการแจ้งเตือนนี้')
  markRead(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user, id);
  }
}
