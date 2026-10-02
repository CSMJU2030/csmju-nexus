import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import {
  FollowDto,
  FollowEdgeDto,
  RelationDto,
  SuggestionDto,
} from './dto/follow.dto.js';
import { FollowsService } from './follows.service.js';

@ApiTags('follows')
@Controller('follows')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get('followers')
  @ApiOperation({ summary: 'คนที่ติดตามฉัน' })
  @ApiEnvelopeList(FollowEdgeDto)
  myFollowers(
    @CurrentUser() user: CoreHubUser,
    @Query() query: PaginationQuery,
  ) {
    return this.follows.followers(user.coreUserId, query);
  }

  @Get('following')
  @ApiOperation({ summary: 'คนที่ฉันติดตาม' })
  @ApiEnvelopeList(FollowEdgeDto)
  myFollowing(
    @CurrentUser() user: CoreHubUser,
    @Query() query: PaginationQuery,
  ) {
    return this.follows.following(user.coreUserId, query);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'คนที่น่าติดตาม (แบ่งหน้า) จากคนที่คนที่เราติดตามอยู่ติดตามอยู่',
    description:
      'เรียงตาม followedByCount มากไปน้อย · followedBy = คนที่ฉันติดตามซึ่งติดตามเขา (≤3) · ตัดคนที่บล็อกกันและคนที่ปิด showInSuggestions · ว่างถ้ายังไม่ได้ติดตามใคร (ตั้งใจไม่ตกไปหาอันดับยอดนิยม)',
  })
  @ApiEnvelopeList(SuggestionDto)
  suggestions(@CurrentUser() user: CoreHubUser, @Query() query: PaginationQuery) {
    return this.follows.suggestions(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'กดติดตามคนหนึ่ง (กดซ้ำไม่แจ้งเตือนซ้ำ)' })
  @ApiEnvelope(RelationDto, { status: 201, description: 'ติดตามแล้ว' })
  @ApiEnvelopeError(400, 'ติดตามตัวเองไม่ได้')
  follow(@CurrentUser() user: CoreHubUser, @Body() dto: FollowDto) {
    return this.follows.follow(user, dto.coreUserId);
  }

  @Delete(':coreUserId')
  @ApiOperation({ summary: 'เลิกติดตาม' })
  @ApiEnvelope(RelationDto)
  unfollow(
    @CurrentUser() user: CoreHubUser,
    @Param('coreUserId') coreUserId: string,
  ) {
    return this.follows.unfollow(user, coreUserId);
  }
}
