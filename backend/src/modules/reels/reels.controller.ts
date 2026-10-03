import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CommentLikeDto,
  RepostStateDto,
  CreateReelCommentDto,
  CreateReelDto,
  ListReelCommentsQuery,
  ListReelsQuery,
  ReelCommentResponseDto,
  ReelResponseDto,
} from './dto/reel.dto.js';
import { LikeCountDto, ReelsService, ViewCountDto } from './reels.service.js';

/// แท็บ "รีโพสต์" บนโปรไฟล์ — อยู่ใต้ /profiles ตามหน้าที่ใช้
@ApiTags('reels')
@Controller('profiles')
export class ProfileRepostsController {
  constructor(private readonly reels: ReelsService) {}

  @Get(':coreUserId/reposts')
  @ApiOperation({
    summary: 'คลิปที่คนนี้รีโพสต์ ใหม่ไปเก่าตามเวลาที่รีโพสต์',
    description: 'รูปเดียวกับ GET /reels · ว่างเสมอถ้าบล็อกกันกับเจ้าของโปรไฟล์ · คลิปของคนที่บล็อกกันกับผู้เรียกถูกซ่อน',
  })
  @ApiEnvelopeList(ReelResponseDto)
  reposts(
    @CurrentUser() user: CoreHubUser,
    @Param('coreUserId') coreUserId: string,
    @Query() query: PaginationQuery,
  ) {
    return this.reels.repostsOf(user, coreUserId, query);
  }
}

/// URL เป็นคำนามพหูพจน์แบบ kebab-case ตามมาตรฐาน (Blueprint หน้า 7)
/// prefix /api/v1 ใส่ให้แล้วที่ main.ts
@ApiTags('reels')
@Controller('reels')
export class ReelsController {
  constructor(private readonly reels: ReelsService) {}

  @Get()
  @ApiOperation({
    summary: 'ฟีดคลิปสั้น เรียงใหม่ไปเก่า',
    description:
      'feed=following = เฉพาะคนที่ติดตาม · authorCoreUserId = หน้าโปรไฟล์ของคนนั้น',
  })
  @ApiEnvelopeList(ReelResponseDto)
  list(@CurrentUser() user: CoreHubUser, @Query() query: ListReelsQuery) {
    return this.reels.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดคลิปเดียว' })
  @ApiEnvelope(ReelResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบคลิป')
  findOne(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'โพสต์คลิปใหม่จากไฟล์ที่อัปโหลดเสร็จแล้ว' })
  @ApiEnvelope(ReelResponseDto, { status: 201, description: 'สร้างคลิปสำเร็จ' })
  @ApiEnvelopeError(400, 'ไฟล์ยังไม่พร้อม หรือไม่ใช่วิดีโอ')
  @ApiEnvelopeError(403, 'ไฟล์นี้ไม่ใช่ของผู้เรียก')
  create(@CurrentUser() user: CoreHubUser, @Body() dto: CreateReelDto) {
    return this.reels.create(user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบคลิป (เจ้าของ หรือ admin ระดับองค์กร)' })
  @ApiEnvelopeError(403, 'ลบคลิปของคนอื่นไม่ได้')
  async remove(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.reels.remove(user, id);
  }

  @Post(':id/likes')
  @ApiOperation({ summary: 'กดไลก์คลิป (กดซ้ำไม่เพิ่มยอด)' })
  @ApiEnvelope(LikeCountDto)
  like(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.like(user, id);
  }

  @Delete(':id/likes')
  @ApiOperation({ summary: 'เลิกไลก์คลิป' })
  @ApiEnvelope(LikeCountDto)
  unlike(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.unlike(user, id);
  }

  @Post(':id/reposts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'รีโพสต์คลิป (รีโพสต์ซ้ำไม่เพิ่มยอด) — เจ้าของได้แจ้งเตือน REEL_REPOST ครั้งแรก',
  })
  @ApiEnvelope(RepostStateDto)
  @ApiEnvelopeError(400, 'รีโพสต์คลิปของตัวเองไม่ได้')
  @ApiEnvelopeError(404, 'ไม่พบคลิป (หรือบล็อกกันกับเจ้าของ)')
  repost(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.repost(user, id);
  }

  @Delete(':id/reposts')
  @ApiOperation({ summary: 'เลิกรีโพสต์ (เรียกซ้ำได้)' })
  @ApiEnvelope(RepostStateDto)
  @ApiEnvelopeError(404, 'ไม่พบคลิป')
  unrepost(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.unrepost(user, id);
  }

  @Post(':id/views')
  @ApiOperation({
    summary: 'บันทึกว่าดูคลิปแล้ว',
    description:
      'นับคนที่เคยดู ไม่ใช่จำนวนครั้งที่เล่น — คนเดิมเรียกซ้ำยอดไม่ขยับ จึงปั่นด้วยการรีเฟรชไม่ได้',
  })
  @ApiEnvelope(ViewCountDto, { status: 201, description: 'บันทึกแล้ว' })
  @ApiEnvelopeError(404, 'ไม่พบคลิปนี้')
  markViewed(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.markViewed(user, id);
  }

  @Get(':id/comments')
  @ApiOperation({
    summary: 'ความคิดเห็นใต้คลิป',
    description:
      'ไม่ส่ง parentId = ความคิดเห็นระดับบนสุด ใหม่สุดก่อน · ส่ง parentId = คำตอบของความคิดเห็นนั้น เก่าไปใหม่ · ทุกแถวมี replyCount, likeCount, likedByMe',
  })
  @ApiEnvelopeList(ReelCommentResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบคลิป หรือไม่พบความคิดเห็นต้นเรื่อง')
  listComments(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListReelCommentsQuery,
  ) {
    return this.reels.listComments(user, id, query);
  }

  @Post(':id/comments')
  @ApiOperation({
    summary: 'คอมเมนต์ใต้คลิป หรือตอบกลับความคิดเห็น (parentId)',
    description:
      'ตอบได้ชั้นเดียว — parentId ต้องเป็นความคิดเห็นระดับบนสุดของคลิปเดียวกัน · เจ้าของคลิปและเจ้าของความคิดเห็นที่ถูกตอบได้แจ้งเตือน REEL_COMMENT',
  })
  @ApiEnvelope(ReelCommentResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'ตอบคำตอบซ้อนไม่ได้')
  @ApiEnvelopeError(404, 'ไม่พบคลิป หรือไม่พบความคิดเห็นที่จะตอบ')
  addComment(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReelCommentDto,
  ) {
    return this.reels.addComment(user, id, dto);
  }

  @Post(':id/comments/:commentId/likes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'กดใจความคิดเห็น (กดซ้ำไม่เพิ่มยอด)' })
  @ApiEnvelope(CommentLikeDto)
  @ApiEnvelopeError(404, 'ไม่พบความคิดเห็นนี้')
  likeComment(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.reels.likeComment(user, id, commentId);
  }

  @Delete(':id/comments/:commentId/likes')
  @ApiOperation({ summary: 'เลิกกดใจความคิดเห็น (เรียกซ้ำได้)' })
  @ApiEnvelope(CommentLikeDto)
  @ApiEnvelopeError(404, 'ไม่พบความคิดเห็นนี้')
  unlikeComment(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.reels.unlikeComment(user, id, commentId);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ลบความคิดเห็น (เจ้าของ หรือผู้ดูแล)',
    description: 'ลบความคิดเห็นระดับบนสุด = คำตอบทั้งหมดหายไปด้วย · ลบคำตอบ = replyCount ของต้นเรื่องลดลง',
  })
  @ApiEnvelopeError(403, 'ลบความคิดเห็นของคนอื่นไม่ได้')
  async removeComment(
    @CurrentUser() user: CoreHubUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.reels.removeComment(user, id, commentId);
  }
}
