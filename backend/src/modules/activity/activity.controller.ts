import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
  refs,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { PaginationMeta } from '../../common/http/envelope.js';
import { ActivityService } from './activity.service.js';
import {
  AccountHistoryItemDto,
  AccountHistoryQuery,
  ActivityLikesQuery,
  ActivityMediaQuery,
  ActivityQuery,
  LikedReelDto,
  MyCommentDto,
  MyMediaDto,
  MyStoryReplyDto,
  ReactedPostDto,
  RepostedReelDto,
} from './dto/activity.dto.js';

const FILTERS =
  'order=newest|oldest (ค่าเริ่มต้น newest) · from/to = วันที่ ISO รวมทั้งวันตามเวลากรุงเทพฯ · ค่าไม่ถูกต้อง = 400 VALIDATION_ERROR';

@ApiTags('activity')
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('likes')
  @ApiOperation({
    summary: 'กิจกรรมของคุณ → การกดถูกใจ',
    description:
      `target=REEL (ค่าเริ่มต้น) = คลิปที่ฉันกดไลก์ รูปเดียวกับ GET /reels + targetKind, likedAt, thumbnailUrl · ` +
      `target=POST = โพสต์ที่ฉันกดรีแอ็กชัน หนึ่งแถวต่อโพสต์ (อิโมจิล่าสุด) · authorCoreUserId = เฉพาะของคนนี้ · ${FILTERS}`,
  })
  @ApiExtraModels(LikedReelDto, ReactedPostDto, PaginationMeta)
  @ApiOkResponse({
    description: 'สำเร็จ พร้อมข้อมูลแบ่งหน้า (ชนิดของแถวขึ้นกับ target)',
    schema: {
      type: 'object',
      required: ['success', 'data', 'meta'],
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            oneOf: [
              { $ref: getSchemaPath(LikedReelDto) },
              { $ref: getSchemaPath(ReactedPostDto) },
            ],
          },
        },
        meta: refs(PaginationMeta)[0],
      },
    },
  })
  @ApiEnvelopeError(400, 'ตัวกรองไม่ถูกต้อง')
  likes(@CurrentUser() user: CoreHubUser, @Query() query: ActivityLikesQuery) {
    return this.activity.likes(user, query);
  }

  @Get('comments')
  @ApiOperation({
    summary: 'กิจกรรมของคุณ → ความคิดเห็นของฉัน ทั้งใต้คลิปและใต้กระทู้',
    description: `ไม่รวมที่ลบไปแล้ว · authorCoreUserId = เฉพาะใต้ของคนนี้ · ${FILTERS}`,
  })
  @ApiEnvelopeList(MyCommentDto)
  @ApiEnvelopeError(400, 'ตัวกรองไม่ถูกต้อง')
  comments(@CurrentUser() user: CoreHubUser, @Query() query: ActivityQuery) {
    return this.activity.comments(user, query);
  }

  @Get('reposts')
  @ApiOperation({
    summary: 'กิจกรรมของคุณ → คลิปที่ฉันรีโพสต์',
    description: `รูปเดียวกับ GET /reels + targetKind, repostedAt, thumbnailUrl · authorCoreUserId = เจ้าของคลิป · ${FILTERS}`,
  })
  @ApiEnvelopeList(RepostedReelDto)
  @ApiEnvelopeError(400, 'ตัวกรองไม่ถูกต้อง')
  reposts(@CurrentUser() user: CoreHubUser, @Query() query: ActivityQuery) {
    return this.activity.reposts(user, query);
  }

  @Get('story-replies')
  @ApiOperation({
    summary: 'กิจกรรมของคุณ → การตอบกลับสตอรี่ (พิมพ์ตอบและกดอิโมจิ)',
    description: `authorCoreUserId = เฉพาะสตอรี่ของคนนี้ · ${FILTERS}`,
  })
  @ApiEnvelopeList(MyStoryReplyDto)
  @ApiEnvelopeError(400, 'ตัวกรองไม่ถูกต้อง')
  storyReplies(@CurrentUser() user: CoreHubUser, @Query() query: ActivityQuery) {
    return this.activity.storyReplies(user, query);
  }

  @Get('media')
  @ApiOperation({
    summary: 'กิจกรรมของคุณ → รูปภาพและวิดีโอ (โพสต์หรือคลิปของฉันเอง)',
    description: `kind=REEL (ค่าเริ่มต้น) หรือ POST · คลิปมี thumbnailUrl เป็น signed URL ของวิดีโอ อายุ 5 นาที · โพสต์ยังแนบรูปไม่ได้ thumbnailUrl จึงเป็น null · ${FILTERS}`,
  })
  @ApiEnvelopeList(MyMediaDto)
  @ApiEnvelopeError(400, 'ตัวกรองไม่ถูกต้อง')
  media(@CurrentUser() user: CoreHubUser, @Query() query: ActivityMediaQuery) {
    return this.activity.media(user, query);
  }

  @Get('account-history')
  @ApiOperation({
    summary: 'กิจกรรมของคุณ → ประวัติบัญชี',
    description:
      'จาก audit log ของผู้เรียกเท่านั้น: BIO_CHANGED/BIO_REMOVED, WEBSITE_CHANGED (detail = เว็บไซต์ใหม่ หรือ null เมื่อลบ), COVER_CHANGED/COVER_REMOVED, CONTENT_DELETED (detail = POST|REEL|STORY), ROOM_CREATED (detail = ชื่อห้อง) + JOINED หนึ่งแถวซึ่งเก่าสุดเสมอ · ไม่มีรหัสผ่าน/อีเมล/ชื่อผู้ใช้ เพราะ Core Hub เป็นเจ้าของ · order=newest|oldest',
  })
  @ApiEnvelopeList(AccountHistoryItemDto)
  @ApiEnvelopeError(400, 'order ไม่ถูกต้อง')
  accountHistory(
    @CurrentUser() user: CoreHubUser,
    @Query() query: AccountHistoryQuery,
  ) {
    return this.activity.accountHistory(user, query);
  }
}
