import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';

/// forwardRef เพราะวงจรของโมดูลคือ Channels → Realtime → Voice → Channels
/// ถ้า import ตรง ๆ ESM จะพังตอนบูตด้วย "Cannot access before initialization"
@Module({
  imports: [forwardRef(() => ChannelsModule)],
  controllers: [VoiceController],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
