import { Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { NotificationKind } from '../../generated/prisma/enums.js';
import type { NotificationPreferenceModel } from '../../generated/prisma/models.js';
import {
  NotificationPreferencesDto,
  PREFERENCE_OF_KIND,
  UpdateNotificationPreferencesDto,
} from './dto/settings.dto.js';

/// ผลการตัดสินต่อผู้รับหนึ่งคน
export interface Delivery {
  /// บันทึกลงรายการแจ้งเตือนไหม — ปิดช่องนั้นไว้ = ไม่มีแถวเลย
  create: boolean;
  /// ผลักทาง socket ไหม — หยุดชั่วคราว (pausedUntil) = เก็บลงรายการแต่ไม่เด้ง
  push: boolean;
}

const DEFAULTS = {
  pausedUntil: null as Date | null,
  likes: 'EVERYONE',
  comments: 'EVERYONE',
  mentions: 'EVERYONE',
  commentLikes: true,
  newFollowers: true,
  reposts: true,
  storyReplies: true,
  messageRequests: true,
  groupRequests: true,
  messages: 'PRIMARY_GENERAL',
} as const;

type Prefs = Pick<NotificationPreferenceModel, keyof typeof DEFAULTS>;

const onOff = (value: boolean) => (value ? 'ON' : 'OFF') as 'ON' | 'OFF';

/// การตั้งค่าการแจ้งเตือน — **บังคับที่จุดสร้างแจ้งเตือน** (NotificationsService)
/// ไม่ใช่ซ่อนที่หน้าบ้าน: ปิดไว้แล้วต้องไม่มีแถวและไม่มี socket เลย ไม่งั้นตัวเลข
/// บนกระดิ่งยังขึ้นทั้งที่ผู้ใช้สั่งปิดแล้ว
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: CoreHubUser): Promise<NotificationPreferencesDto> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { coreUserId: user.coreUserId },
    });

    return toDto(row ?? DEFAULTS);
  }

  async update(
    user: CoreHubUser,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const toBool = (value?: 'ON' | 'OFF') =>
      value === undefined ? undefined : value === 'ON';

    const data = stripUndefined({
      pausedUntil:
        dto.pauseMinutes === undefined
          ? undefined
          : dto.pauseMinutes === null
            ? null
            : new Date(Date.now() + dto.pauseMinutes * 60_000),
      likes: dto.likes,
      comments: dto.comments,
      mentions: dto.mentions,
      commentLikes: toBool(dto.commentLikes),
      newFollowers: toBool(dto.newFollowers),
      reposts: toBool(dto.reposts),
      storyReplies: toBool(dto.storyReplies),
      messageRequests: toBool(dto.messageRequests),
      groupRequests: toBool(dto.groupRequests),
      messages: dto.messages,
    });

    const row = await this.prisma.notificationPreference.upsert({
      where: { coreUserId: user.coreUserId },
      update: data,
      create: { coreUserId: user.coreUserId, ...data },
    });

    return toDto(row);
  }

  /// ตัดสินว่าแจ้งเตือนชนิดนี้ไปถึงผู้รับแต่ละคนไหม — ดูแผนผังที่ PREFERENCE_OF_KIND
  ///
  /// คิวรีต่อชุดคงที่: การตั้งค่าของทุกคนหนึ่งคิวรี · การติดตามผู้กระทำหนึ่งคิวรี
  /// (เฉพาะช่อง FOLLOWING) · แฟ้มของห้อง (เฉพาะแจ้งเตือนเรื่องข้อความ ซึ่งผู้รับมีคนเดียวเสมอ)
  async decide(
    recipients: string[],
    input: { kind: NotificationKind; actorCoreUserId?: string; payload?: Record<string, unknown> },
  ): Promise<Map<string, Delivery>> {
    const unique = [...new Set(recipients)];
    const out = new Map<string, Delivery>();

    if (unique.length === 0) {
      return out;
    }

    const rows = await this.prisma.notificationPreference.findMany({
      where: { coreUserId: { in: unique } },
    });
    const prefsOf = new Map<string, Prefs>(rows.map((row) => [row.coreUserId, row]));

    let field = PREFERENCE_OF_KIND[input.kind];

    if (input.kind === 'REACTION' && input.payload?.targetKind === 'MESSAGE') {
      field = 'messages';
    }

    // ช่อง FOLLOWING ต้องรู้ว่าผู้รับติดตามผู้กระทำไหม — ถามทีเดียวทั้งชุด
    const needsFollow =
      input.actorCoreUserId &&
      (field === 'likes' || field === 'comments' || field === 'mentions') &&
      unique.some((r) => (prefsOf.get(r) ?? DEFAULTS)[field as 'likes'] === 'FOLLOWING');

    const followsActor = needsFollow
      ? new Set(
          (
            await this.prisma.follow.findMany({
              where: {
                followerCoreUserId: { in: unique },
                followingCoreUserId: input.actorCoreUserId!,
              },
              select: { followerCoreUserId: true },
            })
          ).map((row) => row.followerCoreUserId),
        )
      : new Set<string>();

    const now = Date.now();

    for (const recipient of unique) {
      const prefs = prefsOf.get(recipient) ?? DEFAULTS;
      const push = !prefs.pausedUntil || prefs.pausedUntil.getTime() <= now;
      let create = true;

      switch (field) {
        case 'likes':
        case 'comments':
        case 'mentions': {
          const level = prefs[field];
          create = level === 'EVERYONE' || (level === 'FOLLOWING' && followsActor.has(recipient));
          break;
        }
        case 'commentLikes':
          create = prefs.commentLikes;
          break;
        case 'newFollowers':
          create = prefs.newFollowers;
          break;
        case 'reposts':
          create = prefs.reposts;
          break;
        case 'storyReplies':
          create = prefs.storyReplies;
          break;
        case 'groupRequests':
          create = prefs.groupRequests;
          break;
        case 'messages':
          create = await this.allowsMessage(recipient, prefs, input.payload?.channelId);
          break;
        default:
          create = true;
      }

      out.set(recipient, { create, push: create && push });
    }

    return out;
  }

  /// แจ้งเตือนเรื่องข้อความตามแฟ้มของห้องในกล่องข้อความของผู้รับ
  ///
  /// คำนวณ "คำขอข้อความ" ด้วยกติกาเดียวกับ ChannelsService.present — DM/แชทกลุ่ม
  /// ที่ยังไม่เลือกแฟ้ม + ไม่ได้ติดตามคู่สนทนา/ผู้สร้าง + ยังไม่เคยพิมพ์ในห้อง
  private async allowsMessage(
    recipient: string,
    prefs: Prefs,
    channelId: unknown,
  ): Promise<boolean> {
    if (typeof channelId !== 'string') {
      return prefs.messages !== 'OFF';
    }

    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_coreUserId: { channelId, coreUserId: recipient } },
      select: {
        inboxFolder: true,
        channel: {
          select: {
            kind: true,
            createdByCoreUserId: true,
            members: {
              where: { coreUserId: { not: recipient } },
              select: { coreUserId: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!membership) {
      return false;
    }

    let folder: string = membership.inboxFolder ?? 'PRIMARY';

    if (!membership.inboxFolder && ['DM', 'GROUP_DM'].includes(membership.channel.kind)) {
      const counterpart =
        membership.channel.kind === 'DM'
          ? membership.channel.members[0]?.coreUserId
          : membership.channel.createdByCoreUserId;

      if (counterpart && counterpart !== recipient) {
        const [follows, spoke] = await Promise.all([
          this.prisma.follow.count({
            where: { followerCoreUserId: recipient, followingCoreUserId: counterpart },
          }),
          this.prisma.message.count({
            where: { channelId, authorCoreUserId: recipient },
          }),
        ]);

        if (follows === 0 && spoke === 0) {
          folder = 'REQUEST';
        }
      }
    }

    switch (folder) {
      case 'HIDDEN':
        return false;
      case 'REQUEST':
        return prefs.messageRequests;
      case 'GENERAL':
        return prefs.messages === 'PRIMARY_GENERAL';
      default:
        return prefs.messages !== 'OFF';
    }
  }
}

function toDto(row: Prefs): NotificationPreferencesDto {
  return {
    pausedUntil:
      row.pausedUntil && row.pausedUntil.getTime() > Date.now()
        ? row.pausedUntil.toISOString()
        : null,
    likes: row.likes,
    comments: row.comments,
    mentions: row.mentions,
    commentLikes: onOff(row.commentLikes),
    newFollowers: onOff(row.newFollowers),
    reposts: onOff(row.reposts),
    storyReplies: onOff(row.storyReplies),
    messageRequests: onOff(row.messageRequests),
    groupRequests: onOff(row.groupRequests),
    messages: row.messages,
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
