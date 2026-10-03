import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CoreHubUser,
} from '../../common/auth/core-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
} from '../../common/http/api-envelope.decorator.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { FollowsService } from '../follows/follows.service.js';
import {
  MyProfileDto,
  ProfileDetailDto,
  ResolveProfilesQuery,
  UpdateMyProfileDto,
} from './dto/profile.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly follows: FollowsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'แปลง coreUserId หลายตัวเป็นชื่อที่แสดง ในคำขอเดียว',
    description:
      'ไม่มี endpoint นี้ หน้าบ้านจะต้องยิงทีละคนตอนเรนเดอร์ฟีด = 20 คำขอต่อหนึ่งหน้า',
  })
  resolve(@Query() query: ResolveProfilesQuery) {
    const coreUserIds = (query.coreUserIds ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);

    return this.profiles.resolveMany(coreUserIds);
  }

  @Get('me')
  @ApiOperation({
    summary: 'โปรไฟล์ของฉัน พร้อมสถิติ สิทธิ์ และข้อมูลที่แก้ได้เอง',
    description:
      'managedByCore บอกว่า field ไหนแก้ที่ระบบย่อยนี้ไม่ได้ เพราะ Core เป็นแหล่งความจริง (Blueprint หน้า 10)',
  })
  @ApiEnvelope(MyProfileDto)
  me(@CurrentUser() user: CoreHubUser) {
    return this.profiles.me(user);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'แก้โปรไฟล์ของตัวเอง (เฉพาะส่วนที่เป็นของระบบย่อยนี้)',
    description:
      'แก้ได้แค่ bio และรูปปก · ชื่อที่แสดง รูปโปรไฟล์ คณะ และสิทธิ์ระดับองค์กร ต้องไปแก้ที่ Core เพราะระบบย่อยที่เก็บชื่อซ้ำจะล้าสมัยทันทีที่ Core แก้',
  })
  @ApiEnvelope(MyProfileDto)
  @ApiEnvelopeError(400, 'รูปปกไม่ใช่ไฟล์รูป หรือยังไม่ commit')
  @ApiEnvelopeError(403, 'ใช้ไฟล์ของคนอื่นเป็นรูปปกไม่ได้')
  updateMine(
    @CurrentUser() user: CoreHubUser,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.profiles.updateMine(user, dto);
  }

  @Get(':coreUserId')
  @ApiOperation({
    summary: 'โปรไฟล์ของคนหนึ่ง พร้อมสถิติและความสัมพันธ์กับผู้เรียก',
  })
  @ApiEnvelope(ProfileDetailDto)
  @ApiEnvelopeError(400, 'รูปแบบ coreUserId ไม่ถูกต้อง')
  detail(
    @CurrentUser() user: CoreHubUser,
    @Param('coreUserId') coreUserId: string,
  ) {
    return this.profiles.detail(user, coreUserId);
  }

  @Get(':coreUserId/followers')
  @ApiOperation({ summary: 'คนที่ติดตามผู้ใช้คนนี้' })
  followers(
    @Param('coreUserId') coreUserId: string,
    @Query() query: PaginationQuery,
  ) {
    return this.follows.followers(coreUserId, query);
  }

  @Get(':coreUserId/following')
  @ApiOperation({ summary: 'คนที่ผู้ใช้คนนี้ติดตาม' })
  following(
    @Param('coreUserId') coreUserId: string,
    @Query() query: PaginationQuery,
  ) {
    return this.follows.following(coreUserId, query);
  }
}
