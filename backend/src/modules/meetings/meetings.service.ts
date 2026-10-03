import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { canAdministerChannel } from '../../common/auth/member-role.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateMeetingDto,
  ListMeetingsQuery,
  MAX_MEETING_MS,
  MeetingResponseDto,
  MIN_MEETING_MS,
  toMeetingResponse,
} from './dto/meeting.dto.js';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly notifications: NotificationsService,
  ) {}

  /// นัดประชุมล่วงหน้าในห้องหนึ่ง แล้วแจ้งสมาชิกทุกคนในห้อง
  ///
  /// ไม่มีตารางผู้ได้รับเชิญแยก — สมาชิกของห้องคือผู้ได้รับเชิญ
  /// เหตุผล: ถ้ามีสองรายการ (สมาชิกห้อง กับ ผู้ได้รับเชิญ) มันจะไม่ตรงกันทันที
  /// ที่มีคนเข้าหรือออกจากห้อง แล้วจะเกิดเคส "อยู่ในห้องแต่เข้าประชุมไม่ได้"
  async create(
    user: CoreHubUser,
    dto: CreateMeetingDto,
  ): Promise<MeetingResponseDto> {
    const membership = await this.channels.requireMembership(
      user,
      dto.channelId,
    );

    // นักศึกษาที่ไม่ใช่ผู้ดูแลห้องนัดประชุมไม่ได้ เพราะการนัดยิงแจ้งเตือน
    // ถึงทุกคนในห้อง ซึ่งเป็นช่องสแปมถ้าเปิดให้ใครก็นัดได้
    if (!canAdministerChannel(membership.role, user)) {
      throw new ForbiddenException(
        'เฉพาะผู้ดูแลห้องหรืออาจารย์เท่านั้นที่นัดประชุมได้',
      );
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const span = endsAt.getTime() - startsAt.getTime();

    if (span <= 0) {
      throw new BadRequestException('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    }

    if (span < MIN_MEETING_MS) {
      throw new BadRequestException('นัดประชุมสั้นสุด 5 นาที');
    }

    if (span > MAX_MEETING_MS) {
      throw new BadRequestException(
        'นัดประชุมยาวสุด 8 ชั่วโมง — ถ้าใส่วันที่ผิดให้ตรวจปีอีกครั้ง',
      );
    }

    const meeting = await this.prisma.meeting.create({
      data: {
        channelId: dto.channelId,
        title: dto.title,
        agenda: dto.agenda ?? null,
        startsAt,
        endsAt,
        createdByCoreUserId: user.coreUserId,
      },
    });

    const members = await this.prisma.channelMember.findMany({
      where: { channelId: dto.channelId },
      select: { coreUserId: true },
    });

    await this.notifications.pushMany(
      members.map((m) => m.coreUserId),
      {
        kind: 'MEETING_INVITE',
        refId: meeting.id,
        actorCoreUserId: user.coreUserId,
        payload: {
          channelId: dto.channelId,
          title: dto.title,
          startsAt: startsAt.toISOString(),
        },
      },
    );

    return toMeetingResponse(meeting);
  }

  /// นัดประชุมในห้องที่ฉันเป็นสมาชิก
  ///
  /// เห็นได้เฉพาะห้องของตัวเอง — ถ้าคืนทั้งระบบจะกลายเป็นตารางสอนของทุกคน
  /// ที่ใครก็อ่านได้ รวมทั้งนัดคุยส่วนตัวระหว่างอาจารย์กับนักศึกษา
  async list(
    user: CoreHubUser,
    query: ListMeetingsQuery,
  ): Promise<Paginated<MeetingResponseDto>> {
    const memberships = await this.prisma.channelMember.findMany({
      where: {
        coreUserId: user.coreUserId,
        ...(query.channelId ? { channelId: query.channelId } : {}),
      },
      select: { channelId: true },
    });

    if (memberships.length === 0) {
      return new Paginated([], query.meta(0));
    }

    const upcomingOnly = query.upcomingOnly !== 'false';

    const where = {
      channelId: { in: memberships.map((m) => m.channelId) },
      ...(upcomingOnly
        ? { endsAt: { gte: new Date() }, status: { not: 'CANCELLED' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.meeting.findMany({
        where,
        // นัดที่ใกล้ที่สุดอยู่บนสุด ต่างจากฟีดที่เรียงใหม่ไปเก่า
        orderBy: { startsAt: upcomingOnly ? 'asc' : 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return new Paginated(rows.map(toMeetingResponse), query.meta(total));
  }

  async findOne(
    user: CoreHubUser,
    id: string,
  ): Promise<MeetingResponseDto> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });

    if (!meeting) {
      throw new NotFoundException('ไม่พบนัดประชุมนี้');
    }

    // สิทธิ์การเห็นนัดยืมมาจากสมาชิกของห้อง — คืน 404 ถ้าไม่ได้อยู่ในห้อง
    await this.channels.requireMembership(user, meeting.channelId);

    return toMeetingResponse(meeting);
  }

  /// ยกเลิกนัด — ไม่ลบแถว เพราะคนที่จดไว้ในปฏิทินต้องเห็นว่ามันถูกยกเลิก
  /// ไม่ใช่เห็นว่ามันหายไปเฉย ๆ แล้วยังไปรอตามเวลาเดิม
  async cancel(user: CoreHubUser, id: string): Promise<MeetingResponseDto> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });

    if (!meeting) {
      throw new NotFoundException('ไม่พบนัดประชุมนี้');
    }

    const membership = await this.channels.requireMembership(
      user,
      meeting.channelId,
    );

    const isOwner = meeting.createdByCoreUserId === user.coreUserId;
    const canModerate =
      membership.role === 'MODERATOR' || user.coreRole === 'admin';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ยกเลิกได้เฉพาะนัดที่ตัวเองสร้าง');
    }

    if (meeting.status === 'CANCELLED') {
      return toMeetingResponse(meeting);
    }

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    const members = await this.prisma.channelMember.findMany({
      where: { channelId: meeting.channelId },
      select: { coreUserId: true },
    });

    await this.notifications.pushMany(
      members.map((m) => m.coreUserId),
      {
        kind: 'MEETING_INVITE',
        refId: meeting.id,
        actorCoreUserId: user.coreUserId,
        payload: {
          channelId: meeting.channelId,
          title: meeting.title,
          cancelled: true,
        },
      },
    );

    return toMeetingResponse(updated);
  }
}
