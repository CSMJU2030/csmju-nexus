import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessageReactorsController, ReactionsController } from './reactions.controller.js';
import { ReactionsService } from './reactions.service.js';

/// forwardRef ด้วยเหตุผลเดียวกับ VoiceModule — ChannelsModule อยู่ในวงจร
/// Channels → Realtime → Voice → Channels อยู่แล้ว การ import ตรง ๆ จาก
/// โมดูลนอกวงจรยังปลอดภัย แต่ใส่ไว้กันไม่ให้พังถ้าวันหนึ่งมีคนเพิ่ม
/// ReactionsModule เข้าไปในฝั่ง Channels
@Module({
  imports: [forwardRef(() => ChannelsModule)],
  controllers: [ReactionsController, MessageReactorsController],
  providers: [ReactionsService],
  exports: [ReactionsService],
})
export class ReactionsModule {}
