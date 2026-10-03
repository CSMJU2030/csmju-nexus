import { Module } from '@nestjs/common';
import { AssetBlobsController } from './asset-blobs.controller.js';
import { AssetsSweeper } from './assets-sweeper.service.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

@Module({
  controllers: [AssetsController, AssetBlobsController],
  providers: [AssetsService, AssetsSweeper],
  exports: [AssetsService],
})
export class AssetsModule {}
