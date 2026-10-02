import { Global, Module } from '@nestjs/common';
import { BlocksController } from './blocks.controller.js';
import { BlocksService } from './blocks.service.js';

/// @Global เพราะการบล็อกต้องถูกถามจากแทบทุกโมดูล (ติดตาม แชท คอมเมนต์ สตอรี่
/// ค้นหา ฟีด) — ถ้าให้แต่ละโมดูล import เองจะเกิดวงจร import ระหว่างกัน
@Global()
@Module({
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
