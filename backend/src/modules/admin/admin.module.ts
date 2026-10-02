import { Module } from '@nestjs/common';
import {
  AdminOverviewController,
  AuditLogsController,
  MembersAdminController,
} from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [
    AuditLogsController,
    MembersAdminController,
    AdminOverviewController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
