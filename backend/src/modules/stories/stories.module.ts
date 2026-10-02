import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { FollowsModule } from '../follows/follows.module.js';
import {
  HighlightsController,
  ProfileHighlightsController,
} from './highlights.controller.js';
import { HighlightsService } from './highlights.service.js';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';

@Module({
  // ตอบกลับสตอรี่ = ข้อความใน DM จึงต้องใช้ ChannelsService/MessagesService
  imports: [FollowsModule, ChannelsModule],
  controllers: [StoriesController, HighlightsController, ProfileHighlightsController],
  // ไม่มี StoriesSweeper แล้ว — สตอรี่ที่หมดอายุย้ายไปอยู่ในคลังของเจ้าของ
  // แทนการถูกลบ (ดู doc ของ Story ใน schema) จึงไม่มีอะไรต้องเก็บกวาดตามเวลา
  providers: [StoriesService, HighlightsService],
  exports: [StoriesService],
})
export class StoriesModule {}
