import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
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
import { CloseFriendsService } from './close-friends.service.js';
import { CloseFriendDto } from './dto/close-friend.dto.js';
import {
  AudienceCountsDto,
  NotificationPreferencesDto,
  PrivacyDto,
  UpdateNotificationPreferencesDto,
  UpdatePrivacyDto,
} from './dto/settings.dto.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { PrivacyService } from './privacy.service.js';

/// การตั้งค่าของบัญชีตัวเอง — ทุก endpoint เป็นของผู้เรียกเท่านั้น
@ApiTags('settings')
@Controller('me')
export class SettingsController {
  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get('notification-preferences')
  @ApiOperation({ summary: 'การตั้งค่าการแจ้งเตือนของฉัน (ไม่เคยตั้ง = ค่าเริ่มต้นเปิดทุกอย่าง)' })
  @ApiEnvelope(NotificationPreferencesDto)
  getPreferences(@CurrentUser() user: CoreHubUser) {
    return this.preferences.get(user);
  }

  @Patch('notification-preferences')
  @ApiOperation({
    summary: 'แก้การตั้งค่าการแจ้งเตือน (ส่งเฉพาะช่องที่จะแก้)',
    description:
      'pauseMinutes: 15|60|120|480 = หยุดชั่วคราว (ยังเก็บลงรายการแต่ไม่เด้ง socket) · null = เลิกหยุด · ช่องที่เป็น OFF = ไม่สร้างแจ้งเตือนชนิดนั้นเลย',
  })
  @ApiEnvelope(NotificationPreferencesDto)
  @ApiEnvelopeError(400, 'ค่าไม่ถูกต้อง')
  updatePreferences(
    @CurrentUser() user: CoreHubUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.update(user, dto);
  }

  @Get('privacy')
  @ApiOperation({ summary: 'ความเป็นส่วนตัวของบัญชี' })
  @ApiEnvelope(PrivacyDto)
  getPrivacy(@CurrentUser() user: CoreHubUser) {
    return this.privacy.get(user);
  }

  @Patch('privacy')
  @ApiOperation({
    summary: 'แก้ความเป็นส่วนตัว (ส่งเฉพาะช่องที่จะแก้)',
    description:
      'commentsFrom บังคับที่การคอมเมนต์คลิปและโพสต์ (403) · showActivityStatus = false → ไม่เห็นสถานะของใครและไม่มีใครเห็นของเรา · showInSuggestions = false → ไม่โผล่ในคนที่น่าติดตามของคนอื่น',
  })
  @ApiEnvelope(PrivacyDto)
  @ApiEnvelopeError(400, 'ค่าไม่ถูกต้อง')
  updatePrivacy(@CurrentUser() user: CoreHubUser, @Body() dto: UpdatePrivacyDto) {
    return this.privacy.update(user, dto);
  }

  @Get('audience-counts')
  @ApiOperation({ summary: 'จำนวนคนที่ฉันติดตาม · ติดตามฉัน · ติดตามกันทั้งสองทาง' })
  @ApiEnvelope(AudienceCountsDto)
  audienceCounts(@CurrentUser() user: CoreHubUser) {
    return this.privacy.audienceCounts(user);
  }
}

@ApiTags('close-friends')
@Controller('close-friends')
export class CloseFriendsController {
  constructor(private readonly closeFriends: CloseFriendsService) {}

  @Get()
  @ApiOperation({ summary: 'เพื่อนสนิทของฉัน (ใหม่ไปเก่า) — อีกฝ่ายไม่รู้ว่าอยู่ในรายชื่อ' })
  @ApiEnvelopeList(CloseFriendDto)
  list(@CurrentUser() user: CoreHubUser, @Query() query: PaginationQuery) {
    return this.closeFriends.list(user, query);
  }

  @Put(':coreUserId')
  @ApiOperation({ summary: 'เพิ่มเป็นเพื่อนสนิท (เพิ่มซ้ำไม่ผิด)' })
  @ApiEnvelope(CloseFriendDto)
  @ApiEnvelopeError(400, 'เพิ่มตัวเองไม่ได้')
  @ApiEnvelopeError(403, 'บล็อกกันอยู่')
  add(@CurrentUser() user: CoreHubUser, @Param('coreUserId') coreUserId: string) {
    return this.closeFriends.add(user, coreUserId);
  }

  @Delete(':coreUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เอาออกจากเพื่อนสนิท (ไม่อยู่ในรายชื่อก็ไม่ผิด)' })
  async remove(@CurrentUser() user: CoreHubUser, @Param('coreUserId') coreUserId: string) {
    await this.closeFriends.remove(user, coreUserId);
  }
}
