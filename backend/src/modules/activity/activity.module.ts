import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { ReelsModule } from '../reels/reels.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

@Module({
  imports: [ReelsModule, ChannelsModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
