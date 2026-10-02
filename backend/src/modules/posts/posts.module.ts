import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { ReactionsModule } from '../reactions/reactions.module.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  imports: [FollowsModule, ReactionsModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
