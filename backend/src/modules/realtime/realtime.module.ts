import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { VoiceModule } from '../voice/voice.module.js';
import { ChannelMembersController } from './channel-members.controller.js';
import { EventsGateway } from './events.gateway.js';
import { PresenceController } from './presence.controller.js';
import { RealtimeTicketsController } from './realtime-tickets.controller.js';
import { RealtimeTicketsService } from './realtime-tickets.service.js';

@Module({
  imports: [forwardRef(() => ChannelsModule), forwardRef(() => VoiceModule)],
  controllers: [RealtimeTicketsController, PresenceController, ChannelMembersController],
  providers: [RealtimeTicketsService, EventsGateway],
  exports: [EventsGateway, RealtimeTicketsService],
})
export class RealtimeModule {}
