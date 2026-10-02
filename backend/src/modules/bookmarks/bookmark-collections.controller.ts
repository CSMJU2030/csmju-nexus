import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { BookmarkCollectionsService } from './bookmark-collections.service.js';
import {
  BookmarkCollectionDto,
  CreateBookmarkCollectionDto,
  RenameBookmarkCollectionDto,
} from './dto/bookmark-collection.dto.js';
import { BookmarkResponseDto, CreateBookmarkDto } from './dto/bookmark.dto.js';

@ApiTags('bookmark-collections')
@Controller('bookmark-collections')
export class BookmarkCollectionsController {
  constructor(private readonly collections: BookmarkCollectionsService) {}

  @Get()
  @ApiOperation({
    summary: 'คอลเลกชันของที่บันทึกไว้ของฉัน (ใหม่ไปเก่า)',
    description: 'cover = ของชิ้นล่าสุดที่ใส่ ({targetKind, targetId}) หรือ null ถ้าว่าง · เห็นได้เฉพาะเจ้าของ',
  })
  @ApiEnvelopeList(BookmarkCollectionDto)
  list(@CurrentUser() user: CoreHubUser, @Query() query: PaginationQuery) {
    return this.collections.list(user, query);
  }

  @Post()
  @ApiOperation({
    summary: 'สร้างคอลเลกชัน (ใส่ของที่บันทึกไว้แล้วมาพร้อมกันได้)',
  })
  @ApiEnvelope(BookmarkCollectionDto, { status: 201 })
  @ApiEnvelopeError(400, 'ชื่อไม่ถูกต้อง หรือมีของที่ยังไม่ได้บันทึก')
  create(
    @CurrentUser() user: CoreHubUser,
    @Body() dto: CreateBookmarkCollectionDto,
  ) {
    return this.collections.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'เปลี่ยนชื่อคอลเลกชัน' })
  @ApiEnvelope(BookmarkCollectionDto)
  @ApiEnvelopeError(404, 'ไม่พบคอลเลกชัน (หรือไม่ใช่ของผู้เรียก)')
  rename(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameBookmarkCollectionDto,
  ) {
    return this.collections.rename(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบคอลเลกชัน — ของข้างในยังอยู่ในที่บันทึกไว้' })
  @ApiEnvelopeError(404, 'ไม่พบคอลเลกชัน (หรือไม่ใช่ของผู้เรียก)')
  async remove(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.collections.remove(user, id);
  }

  @Get(':id/items')
  @ApiOperation({
    summary: 'ของในคอลเลกชัน (ใส่ล่าสุดก่อน) — รูปเดียวกับ GET /bookmarks',
  })
  @ApiEnvelopeList(BookmarkResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบคอลเลกชัน (หรือไม่ใช่ของผู้เรียก)')
  items(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQuery,
  ) {
    return this.collections.items(user, id, query);
  }

  @Post(':id/items')
  @ApiOperation({
    summary: 'ใส่ของที่บันทึกไว้แล้วเข้าคอลเลกชัน (ใส่ซ้ำได้ ไม่ผิด)',
  })
  @ApiEnvelope(BookmarkResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'ยังไม่ได้บันทึกสิ่งนี้')
  @ApiEnvelopeError(404, 'ไม่พบคอลเลกชัน (หรือไม่ใช่ของผู้เรียก)')
  addItem(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBookmarkDto,
  ) {
    return this.collections.addItem(user, id, dto);
  }

  @Delete(':id/items')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'เอาออกจากคอลเลกชัน (ยังบันทึกไว้เหมือนเดิม)',
    description: 'ระบุด้วย query ?targetKind=&targetId=',
  })
  @ApiEnvelopeError(404, 'ไม่พบคอลเลกชัน (หรือไม่ใช่ของผู้เรียก)')
  async removeItem(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CreateBookmarkDto,
  ) {
    await this.collections.removeItem(user, id, query);
  }
}
