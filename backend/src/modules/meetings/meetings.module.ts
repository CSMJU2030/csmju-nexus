import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';

@Module({
  imports: [forwardRef(() => ChannelsModule)],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
