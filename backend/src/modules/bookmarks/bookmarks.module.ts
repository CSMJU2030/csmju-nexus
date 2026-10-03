import { Module } from '@nestjs/common';
import { BookmarkCollectionsController } from './bookmark-collections.controller.js';
import { BookmarkCollectionsService } from './bookmark-collections.service.js';
import { BookmarksController } from './bookmarks.controller.js';
import { BookmarksService } from './bookmarks.service.js';

@Module({
  controllers: [BookmarksController, BookmarkCollectionsController],
  providers: [BookmarksService, BookmarkCollectionsService],
  exports: [BookmarksService],
})
export class BookmarksModule {}
