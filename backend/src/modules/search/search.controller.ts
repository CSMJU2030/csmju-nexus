import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import { ApiEnvelope } from '../../common/http/api-envelope.decorator.js';
import { SearchAllResponseDto, SearchQuery } from './dto/search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'ค้นคลิป กระทู้ คน และข้อความแชท',
    description:
      'kind=all คืนตัวอย่างทุกหมวดพร้อมยอดรวม (ไม่แบ่งหน้า) · ระบุหมวดเดียวจะแบ่งหน้าปกติ · ข้อความแชทค้นได้เฉพาะห้องที่ผู้เรียกเป็นสมาชิก',
  })
  @ApiEnvelope(SearchAllResponseDto)
  run(@CurrentUser() user: CoreHubUser, @Query() query: SearchQuery) {
    const kind = query.kind ?? 'all';

    return kind === 'all'
      ? this.search.searchAll(user, query)
      : this.search.searchOne(user, query);
  }
}
