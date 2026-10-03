import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ChannelsController, DirectChannelsController } from './channels.controller.js';
import { CallLogService } from './call-log.service.js';
import { ChannelsService } from './channels.service.js';
import { EmbedsService } from './embeds.service.js';
import { SharesController } from './shares.controller.js';
import { SharesService } from './shares.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [forwardRef(() => RealtimeModule)],
  controllers: [
    ChannelsController,
    DirectChannelsController,
    MessagesController,
    SharesController,
  ],
  providers: [ChannelsService, MessagesService, EmbedsService, SharesService, CallLogService],
  exports: [ChannelsService, MessagesService, EmbedsService, CallLogService],
})
export class ChannelsModule {}
