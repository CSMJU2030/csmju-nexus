import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/// @Global เพราะเกือบทุกโมดูลต้องยิงแจ้งเตือน (ไลก์ คอมเมนต์ ติดตาม เมนชัน
/// รีแอ็กชัน นัดประชุม) ถ้าไม่ทำ global จะต้องไป import ในทุกโมดูล
/// แล้วเสี่ยงเกิดวงจร import เพิ่มขึ้นทุกครั้งที่มีฟีเจอร์ใหม่
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
