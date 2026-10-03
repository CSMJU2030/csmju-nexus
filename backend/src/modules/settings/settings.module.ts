import { Global, Module } from '@nestjs/common';
import { CloseFriendsService } from './close-friends.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { PrivacyService } from './privacy.service.js';
import { CloseFriendsController, SettingsController } from './settings.controller.js';

/// @Global เพราะ NotificationsService (global) ต้องถามการตั้งค่าการแจ้งเตือน
/// ทุกครั้งที่สร้างแจ้งเตือน และคลิป/โพสต์ต้องถาม commentsFrom — ถ้าให้แต่ละ
/// โมดูล import เองจะเกิดวงจรกับ NotificationsModule
@Global()
@Module({
  controllers: [SettingsController, CloseFriendsController],
  providers: [PrivacyService, NotificationPreferencesService, CloseFriendsService],
  exports: [PrivacyService, NotificationPreferencesService, CloseFriendsService],
})
export class SettingsModule {}
