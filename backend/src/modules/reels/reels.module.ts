import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { FollowsModule } from '../follows/follows.module.js';
import { ProfileRepostsController, ReelsController } from './reels.controller.js';
import { ReelsService } from './reels.service.js';

@Module({
  imports: [AssetsModule, FollowsModule],
  controllers: [ReelsController, ProfileRepostsController],
  providers: [ReelsService],
  // "กิจกรรมของคุณ" ต้องคืนคลิปรูปเดียวกับฟีด (รวม commentCount)
  exports: [ReelsService],
})
export class ReelsModule {}
