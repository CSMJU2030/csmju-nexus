import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../common/storage/storage.provider.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import {
  DeliveryResultDto,
  StoryReplyDto,
} from '../channels/dto/message.dto.js';
import { MessagesService } from '../channels/messages.service.js';
import { FollowsService } from '../follows/follows.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  STORY_TTL_MS,
  StoryArchiveItemDto,
  StoryInsightsDto,
  StoryItemDto,
  StoryTrayDto,
  StoryViewerDto,
  type CreateStoryDto,
} from './dto/story.dto.js';

/// อายุของ signed URL ที่แนบไปกับรายการสตอรี่
///
/// ยาวกว่าของไฟล์แนบทั่วไป (120 วินาที) เพราะแถวสตอรี่ถูกโหลดตอนเปิดฟีด
/// แล้วผู้ใช้อาจเลื่อนอ่านฟีดสักพักก่อนกดดู — 120 วินาทีจะหมดอายุก่อนถึงมือ
/// ห้านาทีคือจุดที่พอสำหรับพฤติกรรมจริง โดยที่ลิงก์ยังรั่วไปใช้ต่อนานไม่ได้
const STORY_URL_TTL_SECONDS = 300;

/// ออก URL ของไฟล์สตอรี่ — จุดเดียวที่ใช้ทั้งแถวสตอรี่ คลังสตอรี่ และไฮไลต์
/// อายุเท่ากันทุกที่ และเรนเดอร์ในหน้าเสมอ (ไม่บังคับดาวน์โหลด)
export async function signStoryMedia(
  storage: StorageProvider,
  asset: { bucket: string; objectPath: string; fileName: string },
): Promise<string> {
  const signed = await storage.createDownloadUrl(asset.bucket, asset.objectPath, {
    ttlSeconds: STORY_URL_TTL_SECONDS,
    fileName: asset.fileName,
    asAttachment: false,
  });

  return signed.url;
}

/// เพดานจำนวนสตอรี่ที่ดึงมาแสดงในแถวบนสุดหนึ่งครั้ง
///
/// ไม่ใช่เพดานจำนวนที่โพสต์ได้ — แค่จำกัดว่าหนึ่งหน้าจอจะโหลดมากี่ชิ้น
const TRAY_STORY_LIMIT = 300;

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly follows: FollowsService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly blocks: BlocksService,
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
  ) {}

  /// โพสต์สตอรี่จากไฟล์ที่อัปโหลดเสร็จแล้ว
  ///
  /// ตรวจสามอย่างที่ท่ออัปโหลดตรวจไม่ได้แทนเรา:
  ///   1. ไฟล์เป็นของผู้เรียกจริง — ไม่งั้นเอา assetId ของคนอื่นมาโพสต์ได้
  ///   2. commit แล้ว (READY) — ไม่งั้นสตอรี่จะชี้ไปที่ไฟล์ที่ยังไม่มีเนื้อ
  ///   3. ยังไม่ถูกใช้ที่อื่น — unique(assetId) กันไว้ที่ระดับฐานข้อมูลอีกชั้น
  async create(user: CoreHubUser, dto: CreateStoryDto): Promise<StoryItemDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.assetId },
      include: { reel: { select: { id: true } }, story: { select: { id: true } } },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบไฟล์นี้');
    }

    if (asset.ownerCoreUserId !== user.coreUserId) {
      throw new ForbiddenException('โพสต์สตอรี่จากไฟล์ของคนอื่นไม่ได้');
    }

    if (asset.status !== 'READY') {
      throw new BadRequestException(
        'ไฟล์ยังอัปโหลดไม่เสร็จ — เรียก commit ให้สำเร็จก่อน',
      );
    }

    if (asset.kind !== 'IMAGE' && asset.kind !== 'VIDEO') {
      throw new BadRequestException('สตอรี่รับเฉพาะรูปภาพและวิดีโอ');
    }

    if (asset.reel || asset.story) {
      throw new BadRequestException(
        'ไฟล์นี้ถูกใช้ไปแล้ว — อัปโหลดใหม่ถ้าต้องการโพสต์ซ้ำ',
      );
    }

    const story = await this.prisma.story.create({
      data: {
        authorCoreUserId: user.coreUserId,
        assetId: asset.id,
        caption: dto.caption ?? null,
        expiresAt: new Date(Date.now() + STORY_TTL_MS),
      },
    });

    // แจ้งคนที่ติดตามเราว่ามีสตอรี่ใหม่
    //
    // ตั้งใจไม่แจ้งถ้าผู้ติดตามเกิน 50 คน เพราะสตอรี่เป็นของที่โพสต์บ่อย
    // วันละหลายครั้ง ถ้าแจ้งทุกครั้งกับทุกคน ช่องแจ้งเตือนจะไร้ประโยชน์ทันที
    // (Instagram เองก็ไม่แจ้งเตือนสตอรี่ใหม่ — วงแหวนรอบรูปโปรไฟล์ทำหน้าที่นี้)
    const followers = await this.prisma.follow.findMany({
      where: { followingCoreUserId: user.coreUserId },
      select: { followerCoreUserId: true },
      take: 51,
    });

    if (followers.length > 0 && followers.length <= 50) {
      await this.notifications.pushMany(
        followers.map((row) => row.followerCoreUserId),
        {
          kind: 'MENTION',
          refId: story.id,
          actorCoreUserId: user.coreUserId,
          payload: { story: true, preview: dto.caption ?? null },
        },
      );
    }

    return this.toItem(
      { ...story, asset, _count: { views: 0 } },
      new Set(),
      true,
    );
  }

  /// แถวสตอรี่บนสุดของฟีด — ของตัวเองมาก่อน แล้วคนที่ติดตาม
  ///
  /// **การหมดอายุบังคับที่นี่** ด้วย `expiresAt: { gt: now }` ไม่ใช่รอให้ตัวลบ
  /// มาทำงาน ฉะนั้นสตอรี่ที่หมดอายุหายจากสายตาผู้ใช้ตรงเวลาแม้ตัวเก็บกวาด
  /// จะไม่เคยรันเลย
  async tray(user: CoreHubUser): Promise<StoryTrayDto[]> {
    // คนที่บล็อกกันหายจากแถวสตอรี่ แม้ยังติดตามกันค้างอยู่ก่อนบล็อก
    const hidden = new Set(await this.blocks.hiddenFor(user.coreUserId));
    const authors = (await this.follows.followingCoreUserIds(user)).filter(
      (id) => !hidden.has(id),
    );
    const now = new Date();

    const stories = await this.prisma.story.findMany({
      where: {
        authorCoreUserId: { in: authors },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' }, // ในหนึ่งคน ดูจากเก่าไปใหม่
      include: {
        asset: true,
        _count: { select: { views: true } },
      },
      // มีเพดาน — ของเดิมไม่มี `take` เลย
      //
      // คนที่ติดตามเพื่อนร่วมรุ่นสามร้อยคน ช่วงสอบที่ทุกคนโพสต์กันคนละสิบชิ้น
      // จะได้แถวหลักพันต่อการเปิดฟีดหนึ่งครั้ง แต่ละแถวยังพ่วง asset และ
      // subquery นับยอดดู แล้วยังต้องเซ็น URL ให้ทีละไฟล์อีก
      take: TRAY_STORY_LIMIT,
    });

    if (stories.length === 0) {
      return [];
    }

    const seen = await this.prisma.storyView.findMany({
      where: {
        coreUserId: user.coreUserId,
        storyId: { in: stories.map((story) => story.id) },
      },
      select: { storyId: true },
    });

    const seenIds = new Set(seen.map((row) => row.storyId));
    const byAuthor = new Map<string, typeof stories>();

    for (const story of stories) {
      const list = byAuthor.get(story.authorCoreUserId) ?? [];

      list.push(story);
      byAuthor.set(story.authorCoreUserId, list);
    }

    const trays = await Promise.all(
      [...byAuthor.entries()].map(async ([author, list]) => {
        const isMe = author === user.coreUserId;

        return {
          authorCoreUserId: author,
          hasUnseen: list.some((story) => !seenIds.has(story.id)),
          isMe: isMe,
          stories: await Promise.all(
            list.map((story) => this.toItem(story, seenIds, isMe)),
          ),
        };
      }),
    );

    // ของตัวเองอยู่ซ้ายสุด แล้วเรียงคนที่ยังมีของไม่ได้ดูขึ้นก่อน
    // (เหมือน Instagram — คนที่ดูครบแล้วถูกดันไปท้ายแถว)
    return trays.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;

      return a.authorCoreUserId.localeCompare(b.authorCoreUserId);
    });
  }

  /// บันทึกว่าดูแล้ว — กดซ้ำไม่เพิ่มยอด เพราะคีย์เป็น (storyId, coreUserId)
  async markViewed(
    user: CoreHubUser,
    storyId: string,
  ): Promise<{ viewCount: number }> {
    const story = await this.requireVisible(user, storyId);

    await this.prisma.storyView
      .create({ data: { storyId, coreUserId: user.coreUserId } })
      .catch(() => undefined); // ดูซ้ำ = ชนคีย์ ซึ่งถูกต้องแล้ว

    const viewCount = await this.prisma.storyView.count({ where: { storyId } });

    return {
      // ยอดผู้ชมเป็นข้อมูลของเจ้าของ คนอื่นไม่ควรรู้ว่าสตอรี่นี้มีคนดูกี่คน
      viewCount: story.authorCoreUserId === user.coreUserId ? viewCount : 0,
    };
  }

  /// รายชื่อผู้ชม — เจ้าของสตอรี่เท่านั้น (เหมือน Instagram)
  async viewers(
    user: CoreHubUser,
    storyId: string,
    query: PaginationQuery,
  ): Promise<Paginated<StoryViewerDto>> {
    await this.requireOwned(user, storyId, 'ดูรายชื่อผู้ชมได้เฉพาะสตอรี่ของตัวเอง');

    const where = { storyId };
    const [rows, total] = await Promise.all([
      this.prisma.storyView.findMany({
        where,
        orderBy: [{ viewedAt: 'desc' }, { coreUserId: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.storyView.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        coreUserId: row.coreUserId,
        viewedAt: row.viewedAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  /// ตอบกลับสตอรี่ (พิมพ์ หรือกดอิโมจิ) = ข้อความใน DM กับเจ้าของสตอรี่
  ///
  /// Instagram ไม่มีกล่องคอมเมนต์ใต้สตอรี่ — การตอบกลับไปอยู่ในแชทส่วนตัว
  /// พร้อมการ์ดของสตอรี่นั้น เจ้าของจึงตอบต่อได้ในที่เดียวกับที่คุยกันอยู่แล้ว
  async reply(
    user: CoreHubUser,
    storyId: string,
    dto: StoryReplyDto,
  ): Promise<DeliveryResultDto> {
    if ((dto.content === undefined) === (dto.emoji === undefined)) {
      throw new BadRequestException(['ส่ง content (พิมพ์ตอบ) หรือ emoji (กดอิโมจิ) อย่างใดอย่างหนึ่ง']);
    }

    const content = dto.content?.trim();

    if (dto.content !== undefined && !content) {
      throw new BadRequestException(['ข้อความตอบกลับว่างเปล่า']);
    }

    const story = await this.requireVisible(user, storyId);

    if (story.authorCoreUserId === user.coreUserId) {
      throw new BadRequestException('ตอบสตอรี่ของตัวเองไม่ได้');
    }

    const channelId = await this.channels.ensureDirect(user, story.authorCoreUserId);
    const kind = dto.emoji ? ('REACTION' as const) : ('REPLY' as const);

    const result = await this.messages.deliver(user, [channelId], {
      content: content ?? dto.emoji ?? null,
      embed: { kind: 'STORY', refId: story.id },
      storyReply: { kind, emoji: dto.emoji ?? null },
    });

    await this.notifications.push({
      coreUserId: story.authorCoreUserId,
      kind: 'STORY_REPLY',
      refId: story.id,
      actorCoreUserId: user.coreUserId,
      payload: {
        storyId: story.id,
        channelId: channelId,
        messageId: result.messageIds[0],
        replyKind: kind,
        emoji: dto.emoji ?? null,
        preview: content?.slice(0, 120) ?? null,
      },
    });

    return result;
  }

  /// สถิติของสตอรี่ — เจ้าของเท่านั้น · นับจากข้อความตอบกลับที่ยังไม่ถูกลบ
  async insights(user: CoreHubUser, storyId: string): Promise<StoryInsightsDto> {
    await this.requireOwned(user, storyId, 'ดูสถิติได้เฉพาะสตอรี่ของตัวเอง');

    const replies = {
      deletedAt: null,
      embed: { is: { kind: 'STORY' as const, refId: storyId } },
    };

    const [viewCount, replyCount, reactions] = await Promise.all([
      this.prisma.storyView.count({ where: { storyId } }),
      this.prisma.message.count({ where: { ...replies, storyReplyKind: 'REPLY' } }),
      this.prisma.message.groupBy({
        by: ['storyReplyEmoji'],
        where: { ...replies, storyReplyKind: 'REACTION' },
        _count: { _all: true },
      }),
    ]);

    return {
      viewCount: viewCount,
      replyCount: replyCount,
      reactionCounts: Object.fromEntries(
        reactions
          .filter((row) => row.storyReplyEmoji)
          .map((row) => [row.storyReplyEmoji as string, row._count._all]),
      ),
    };
  }

  /// 404 ถ้าไม่มี · 403 ถ้ามีแต่ไม่ใช่ของผู้เรียก
  private async requireOwned(user: CoreHubUser, storyId: string, message: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { authorCoreUserId: true },
    });

    if (!story) {
      throw new NotFoundException('ไม่พบสตอรี่นี้');
    }

    if (story.authorCoreUserId !== user.coreUserId) {
      throw new ForbiddenException(message);
    }
  }

  async remove(user: CoreHubUser, storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('ไม่พบสตอรี่นี้');
    }

    const isOwner = story.authorCoreUserId === user.coreUserId;
    const canModerate = user.coreRole === 'admin';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะสตอรี่ของตัวเอง');
    }

    await this.prisma.$transaction(async (tx) => {
      // แถวในไฮไลต์หายตามด้วย CASCADE
      await tx.story.delete({ where: { id: storyId } });

      // ไฮไลต์ที่ว่างเปล่าเพราะสตอรี่ชิ้นสุดท้ายถูกลบ ลบทิ้งด้วย — Instagram ก็ทำ
      // แบบนี้ วงกลมไฮไลต์ที่กดแล้วไม่มีอะไรให้ดูบนโปรไฟล์ดูเหมือนระบบพัง
      await tx.highlight.deleteMany({
        where: { ownerCoreUserId: story.authorCoreUserId, items: { none: {} } },
      });

      // บันทึกทุกครั้ง ไม่ใช่เฉพาะตอนผู้ดูแลลบ — "กิจกรรมของคุณ → ประวัติบัญชี"
      // ต้องบอกเจ้าของได้ว่าเคยลบสตอรี่ไปเมื่อไหร่ เหมือนที่โพสต์และคลิปบันทึกอยู่แล้ว
      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'story.delete',
          targetKind: 'STORY',
          targetId: storyId,
          metadata: {
            author_core_user_id: story.authorCoreUserId,
            by_admin: !isOwner,
          },
        },
      });
    });
  }

  /// คลังสตอรี่ของฉัน — ทุกชิ้นไม่ว่าจะหมดอายุหรือยัง ใหม่ไปเก่า
  ///
  /// ใช้ได้เพราะสตอรี่ไม่ถูกลบตอนหมดอายุอีกแล้ว (ดู doc ของ Story ใน schema)
  /// เห็นได้เฉพาะเจ้าของ — where ผูกกับผู้เรียกเสมอ ไม่มีพารามิเตอร์ให้ดูของคนอื่น
  async archive(
    user: CoreHubUser,
    query: PaginationQuery,
  ): Promise<Paginated<StoryArchiveItemDto>> {
    const where = { authorCoreUserId: user.coreUserId };

    const [rows, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
        include: { asset: true, _count: { select: { views: true } } },
      }),
      this.prisma.story.count({ where }),
    ]);

    const now = Date.now();
    const items = await Promise.all(
      rows.map(async (story) => ({
        id: story.id,
        assetId: story.assetId,
        mediaKind: story.asset.kind,
        mediaUrl: await signStoryMedia(this.storage, story.asset),
        caption: story.caption,
        viewCount: story._count.views,
        isExpired: story.expiresAt.getTime() <= now,
        createdAt: story.createdAt.toISOString(),
        expiresAt: story.expiresAt.toISOString(),
      })),
    );

    return new Paginated(items, query.meta(total));
  }

  /// สตอรี่ที่ผู้เรียกมีสิทธิ์เห็น = ของตัวเอง หรือของคนที่ตัวเองติดตาม
  /// และต้องยังไม่หมดอายุ
  private async requireVisible(user: CoreHubUser, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, expiresAt: { gt: new Date() } },
    });

    if (!story) {
      throw new NotFoundException('ไม่พบสตอรี่นี้ หรือหมดอายุไปแล้ว');
    }

    if (story.authorCoreUserId === user.coreUserId) {
      return story;
    }

    const authors = await this.follows.followingCoreUserIds(user);

    if (
      !authors.includes(story.authorCoreUserId) ||
      (await this.blocks.isBlockedEither(user.coreUserId, story.authorCoreUserId))
    ) {
      // 404 ไม่ใช่ 403 — ไม่ยืนยันให้คนนอกรู้ว่าสตอรี่ id นี้มีอยู่จริง
      throw new NotFoundException('ไม่พบสตอรี่นี้');
    }

    return story;
  }

  private async toItem(
    story: {
      id: string;
      authorCoreUserId: string;
      assetId: string;
      caption: string | null;
      createdAt: Date;
      expiresAt: Date;
      asset: { bucket: string; objectPath: string; fileName: string; kind: string };
      _count: { views: number };
    },
    seenIds: Set<string>,
    isMe: boolean,
  ): Promise<StoryItemDto> {
    return {
      id: story.id,
      authorCoreUserId: story.authorCoreUserId,
      kind: story.asset.kind,
      mediaUrl: await signStoryMedia(this.storage, story.asset),
      assetId: story.assetId,
      caption: story.caption,
      viewedByMe: seenIds.has(story.id),
      // ยอดผู้ชมเป็นข้อมูลของเจ้าของเท่านั้น
      viewCount: isMe ? story._count.views : 0,
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
    };
  }
}
