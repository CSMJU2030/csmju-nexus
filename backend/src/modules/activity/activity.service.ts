import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../common/storage/storage.provider.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AuditLogModel } from '../../generated/prisma/models.js';
import { EmbedsService } from '../channels/embeds.service.js';
import { ReelsService } from '../reels/reels.service.js';
import {
  AccountHistoryItemDto,
  AccountHistoryQuery,
  ActivityLikesQuery,
  ActivityMediaQuery,
  ActivityQuery,
  ActivityRangeQuery,
  LikedReelDto,
  MyCommentDto,
  MyMediaDto,
  MyStoryReplyDto,
  ReactedPostDto,
  RepostedReelDto,
} from './dto/activity.dto.js';

/// อายุ URL ของภาพย่อ — เท่ากับของสตอรี่ เพราะหน้ากิจกรรมก็เป็นกริดที่
/// ผู้ใช้เลื่อนดูสักพักก่อนกด 120 วินาทีแบบไฟล์แนบทั่วไปจะหมดก่อนถึงมือ
const THUMBNAIL_TTL_SECONDS = 300;

/// เวลากรุงเทพฯ ไม่มี DST — +7 ชั่วโมงตายตัวตลอดปี จึงคำนวณด้วยการบวกเลขได้
/// ไม่ต้องพึ่งฐานข้อมูล timezone
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/// audit log ที่นับเป็น "ประวัติบัญชี" — รายการปิด ไม่ใช่ทุก action ของผู้เรียก
///
/// การกระทำเชิงผู้ดูแล (ปิดรายงาน เปลี่ยนสิทธิ์คนอื่น) ไม่ใช่ประวัติของบัญชีตัวเอง
const HISTORY_ACTIONS = [
  'profile.bio_change',
  'profile.cover_change',
  'profile.website_change',
  'post.delete',
  'reel.delete',
  'story.delete',
  'channel.create',
] as const;

/// "กิจกรรมของคุณ" แบบ Instagram — ของที่ผู้เรียกทำไว้เอง เห็นได้เฉพาะเจ้าของ
///
/// ทุก where ผูกกับ coreUserId ของผู้เรียกเสมอ ไม่มีพารามิเตอร์ให้ดูของคนอื่น
/// เพราะ "ฉันไปกดไลก์หรือคอมเมนต์อะไรไว้บ้าง" เป็นข้อมูลส่วนตัวพอ ๆ กับประวัติการค้นหา
/// (authorCoreUserId กรอง "เจ้าของของที่ฉันไปกด" ไม่ใช่ "ดูกิจกรรมของคนนั้น")
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reels: ReelsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly embeds: EmbedsService,
  ) {}

  /// คลิปที่ฉันรีโพสต์ — ตัวกรองเดียวกับไลก์ (author = เจ้าของคลิป)
  async reposts(
    user: CoreHubUser,
    query: ActivityQuery,
  ): Promise<Paginated<RepostedReelDto>> {
    const range = dayRange(query);
    const direction = query.order === 'oldest' ? 'asc' : 'desc';
    const where = {
      coreUserId: user.coreUserId,
      ...(range ? { createdAt: range } : {}),
      ...(query.authorCoreUserId
        ? { reel: { authorCoreUserId: query.authorCoreUserId } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reelRepost.findMany({
        where,
        orderBy: [{ createdAt: direction }, { reelId: direction }],
        skip: query.skip,
        take: query.take,
        include: { reel: { include: { asset: true } } },
      }),
      this.prisma.reelRepost.count({ where }),
    ]);

    const [reels, thumbnails] = await Promise.all([
      this.reels.present(
        user,
        rows.map((row) => row.reel),
      ),
      Promise.all(rows.map((row) => this.sign(row.reel.asset))),
    ]);

    return new Paginated(
      rows.map((row, index) => ({
        ...reels[index],
        targetKind: 'REEL' as const,
        repostedAt: row.createdAt.toISOString(),
        thumbnailUrl: thumbnails[index],
      })),
      query.meta(total),
    );
  }

  /// ภาพย่อของโพสต์ = รูป/วิดีโอชิ้นแรก — คิวรีเดียวต่อหน้า
  private async postThumbnails(
    postIds: string[],
  ): Promise<Map<string, { url: string | null; kind: 'IMAGE' | 'VIDEO' }>> {
    if (postIds.length === 0) return new Map();

    const rows = await this.prisma.postMedia.findMany({
      where: { postId: { in: postIds } },
      orderBy: [{ postId: 'asc' }, { position: 'asc' }],
      include: { asset: true },
    });

    const first = new Map<string, (typeof rows)[number]>();

    for (const row of rows) {
      if (!first.has(row.postId)) first.set(row.postId, row);
    }

    const out = new Map<string, { url: string | null; kind: 'IMAGE' | 'VIDEO' }>();

    await Promise.all(
      [...first.values()].map(async (row) => {
        out.set(row.postId, {
          url: await this.sign(row.asset),
          kind: row.asset.kind === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        });
      }),
    );

    return out;
  }

  /// การตอบกลับสตอรี่ที่ฉันส่ง (พิมพ์ตอบ + กดอิโมจิ) — กิจกรรมของคุณ → ตอบกลับสตอรี่
  ///
  /// authorCoreUserId = เจ้าของสตอรี่ · การ์ดสตอรี่แปลงเป็นชุดเดียวต่อหน้า
  async storyReplies(
    user: CoreHubUser,
    query: ActivityQuery,
  ): Promise<Paginated<MyStoryReplyDto>> {
    const range = dayRange(query);
    const direction = query.order === 'oldest' ? 'asc' : 'desc';

    // embed เป็น polymorphic (refId ไม่มี FK) — กรองเจ้าของสตอรี่ด้วยรายชื่อสตอรี่ของเขา
    const storyIds = query.authorCoreUserId
      ? (
          await this.prisma.story.findMany({
            where: { authorCoreUserId: query.authorCoreUserId },
            select: { id: true },
          })
        ).map((row) => row.id)
      : null;

    const where: Prisma.MessageWhereInput = {
      authorCoreUserId: user.coreUserId,
      storyReplyKind: { not: null },
      deletedAt: null,
      ...(range ? { createdAt: range } : {}),
      embed: {
        is: {
          kind: 'STORY',
          ...(storyIds ? { refId: { in: storyIds } } : {}),
        },
      },
    };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: [{ createdAt: direction }, { id: direction }],
        skip: query.skip,
        take: query.take,
        include: { embed: true },
      }),
      this.prisma.message.count({ where }),
    ]);

    const views = await this.embeds.resolve(
      user.coreUserId,
      rows.map((row) => ({ kind: 'STORY', refId: row.embed!.refId })),
    );

    return new Paginated(
      rows.map((row) => {
        const story = views.get(EmbedsService.key('STORY', row.embed!.refId))!;

        return {
          id: row.id,
          channelId: row.channelId,
          storyId: row.embed!.refId,
          storyAuthorCoreUserId: story.authorCoreUserId,
          kind: row.storyReplyKind!,
          emoji: row.storyReplyEmoji,
          content: row.content,
          story,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      query.meta(total),
    );
  }

  /// คลิปที่ฉันกดไลก์ (target=REEL) หรือโพสต์ที่ฉันกดรีแอ็กชัน (target=POST)
  likes(
    user: CoreHubUser,
    query: ActivityLikesQuery,
  ): Promise<Paginated<LikedReelDto> | Paginated<ReactedPostDto>> {
    return query.target === 'POST'
      ? this.reactedPosts(user, query)
      : this.likedReels(user, query);
  }

  /// เรียงตามเวลาที่กด (ไม่ใช่เวลาที่คลิปถูกโพสต์) บนดัชนี
  /// reel_likes(coreUserId, createdAt DESC) · คลิปที่ถูกลบหายไปเองเพราะ CASCADE
  private async likedReels(
    user: CoreHubUser,
    query: ActivityLikesQuery,
  ): Promise<Paginated<LikedReelDto>> {
    const range = dayRange(query);
    const direction = query.order === 'oldest' ? 'asc' : 'desc';
    const where = {
      coreUserId: user.coreUserId,
      ...(range ? { createdAt: range } : {}),
      ...(query.authorCoreUserId
        ? { reel: { authorCoreUserId: query.authorCoreUserId } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reelLike.findMany({
        where,
        orderBy: [{ createdAt: direction }, { reelId: direction }],
        skip: query.skip,
        take: query.take,
        include: { reel: { include: { asset: true } } },
      }),
      this.prisma.reelLike.count({ where }),
    ]);

    const [reels, thumbnails] = await Promise.all([
      this.reels.present(
        user,
        rows.map((row) => row.reel),
      ),
      Promise.all(rows.map((row) => this.sign(row.reel.asset))),
    ]);

    return new Paginated(
      rows.map((row, index) => ({
        ...reels[index],
        targetKind: 'REEL' as const,
        likedAt: row.createdAt.toISOString(),
        thumbnailUrl: thumbnails[index],
      })),
      query.meta(total),
    );
  }

  /// โพสต์ที่ฉันกดรีแอ็กชัน — **หนึ่งแถวต่อหนึ่งโพสต์** ตามรีแอ็กชันล่าสุด
  ///
  /// คนหนึ่งกดได้หลายอิโมจิบนโพสต์เดียว (ดู ReactionsService) ถ้าคืนแถวละ
  /// รีแอ็กชัน โพสต์เดิมจะโผล่ซ้ำในกริดติดกันหลายช่อง ซึ่ง Instagram ไม่ทำ
  /// DISTINCT ON เลือกอันล่าสุดต่อโพสต์ แล้วค่อยเรียงและแบ่งหน้าชั้นนอก
  private async reactedPosts(
    user: CoreHubUser,
    query: ActivityLikesQuery,
  ): Promise<Paginated<ReactedPostDto>> {
    const range = dayRange(query);
    const direction = Prisma.raw(query.order === 'oldest' ? 'ASC' : 'DESC');
    const conditions = Prisma.join(
      [
        Prisma.sql`TRUE`,
        ...(range?.gte ? [Prisma.sql`mine.created_at >= ${range.gte}`] : []),
        ...(range?.lt ? [Prisma.sql`mine.created_at < ${range.lt}`] : []),
        ...(query.authorCoreUserId
          ? [Prisma.sql`p.author_core_user_id = ${query.authorCoreUserId}`]
          : []),
      ],
      ' AND ',
    );

    const mine = Prisma.sql`
      SELECT DISTINCT ON (r.target_id) r.target_id, r.emoji, r.created_at
      FROM reactions r
      WHERE r.target_kind = 'POST' AND r.core_user_id = ${user.coreUserId}
      ORDER BY r.target_id, r.created_at DESC
    `;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          title: string;
          content: string;
          author_core_user_id: string;
          emoji: string;
          reacted_at: Date;
        }[]
      >`
        SELECT p.id, p.title, p.content, p.author_core_user_id,
               mine.emoji, mine.created_at AS reacted_at
        FROM (${mine}) mine
        JOIN posts p ON p.id = mine.target_id
        WHERE ${conditions}
        ORDER BY mine.created_at ${direction}, p.id ${direction}
        OFFSET ${query.skip}
        LIMIT ${query.take}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total
        FROM (${mine}) mine
        JOIN posts p ON p.id = mine.target_id
        WHERE ${conditions}
      `,
    ]);

    const thumbs = await this.postThumbnails(rows.map((row) => row.id));

    return new Paginated(
      rows.map((row) => ({
        targetKind: 'POST' as const,
        id: row.id,
        title: row.title,
        preview: row.content.slice(0, 160),
        authorCoreUserId: row.author_core_user_id,
        emoji: row.emoji,
        thumbnailUrl: thumbs.get(row.id)?.url ?? null,
        thumbnailKind: thumbs.get(row.id)?.kind ?? null,
        reactedAt: row.reacted_at.toISOString(),
      })),
      query.meta(Number(counted[0]?.total ?? 0)),
    );
  }

  /// ความคิดเห็นของฉันทั้งใต้คลิปและใต้กระทู้ รวมเป็นรายการเดียว
  ///
  /// รวมสองตารางด้วย UNION ALL ที่ฐานข้อมูล ไม่ใช่ดึงมาสองชุดแล้วรวมในหน่วยความจำ
  /// เพราะการแบ่งหน้าข้ามสองตารางต้องเรียงรวมกันก่อน — ถ้าแบ่งหน้าแยกกัน
  /// หน้าสองจะมีรายการที่ใหม่กว่าหน้าแรกปนมา · ชื่อเรื่อง JOIN มาในคิวรีเดียวกัน
  async comments(
    user: CoreHubUser,
    query: ActivityQuery,
  ): Promise<Paginated<MyCommentDto>> {
    const range = dayRange(query);
    const direction = Prisma.raw(query.order === 'oldest' ? 'ASC' : 'DESC');
    const conditions = Prisma.join(
      [
        Prisma.sql`TRUE`,
        ...(range?.gte ? [Prisma.sql`mine.created_at >= ${range.gte}`] : []),
        ...(range?.lt ? [Prisma.sql`mine.created_at < ${range.lt}`] : []),
        ...(query.authorCoreUserId
          ? [Prisma.sql`mine.target_author_core_user_id = ${query.authorCoreUserId}`]
          : []),
      ],
      ' AND ',
    );

    const union = Prisma.sql`
      SELECT rc.id, 'REEL' AS target_kind, rc.reel_id AS target_id,
             r.title AS target_title, r.author_core_user_id AS target_author_core_user_id,
             rc.content, rc.created_at
      FROM reel_comments rc
      JOIN reels r ON r.id = rc.reel_id
      WHERE rc.author_core_user_id = ${user.coreUserId}
        AND rc.deleted_at IS NULL
      UNION ALL
      SELECT pc.id, 'POST' AS target_kind, pc.post_id AS target_id,
             p.title AS target_title, p.author_core_user_id AS target_author_core_user_id,
             pc.content, pc.created_at
      FROM post_comments pc
      JOIN posts p ON p.id = pc.post_id
      WHERE pc.author_core_user_id = ${user.coreUserId}
        AND pc.deleted_at IS NULL
    `;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          target_kind: 'REEL' | 'POST';
          target_id: string;
          target_title: string;
          target_author_core_user_id: string;
          content: string;
          created_at: Date;
        }[]
      >`
        SELECT * FROM (${union}) mine
        WHERE ${conditions}
        ORDER BY mine.created_at ${direction}, mine.id ${direction}
        OFFSET ${query.skip}
        LIMIT ${query.take}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM (${union}) mine WHERE ${conditions}
      `,
    ]);

    return new Paginated(
      rows.map((row) => ({
        id: row.id,
        targetKind: row.target_kind,
        targetId: row.target_id,
        targetTitle: row.target_title,
        targetAuthorCoreUserId: row.target_author_core_user_id,
        content: row.content,
        createdAt: row.created_at.toISOString(),
      })),
      query.meta(Number(counted[0]?.total ?? 0)),
    );
  }

  /// โพสต์หรือคลิปของฉันเอง พร้อมภาพย่อและยอด — กริด "รูปภาพและวิดีโอ"
  async media(
    user: CoreHubUser,
    query: ActivityMediaQuery,
  ): Promise<Paginated<MyMediaDto>> {
    const range = dayRange(query);
    const direction = query.order === 'oldest' ? 'asc' : 'desc';
    const where = {
      authorCoreUserId: user.coreUserId,
      ...(range ? { createdAt: range } : {}),
    };
    const orderBy = [{ createdAt: direction }, { id: direction }] as const;

    if (query.kind === 'POST') {
      const [rows, total] = await Promise.all([
        this.prisma.post.findMany({
          where,
          orderBy: [...orderBy],
          skip: query.skip,
          take: query.take,
        }),
        this.prisma.post.count({ where }),
      ]);

      // ยอดรีแอ็กชันของทั้งหน้าในคิวรีเดียว (groupBy) ไม่ใช่ COUNT ทีละโพสต์
      const reactions = rows.length
        ? await this.prisma.reaction.groupBy({
            by: ['targetId'],
            where: { targetKind: 'POST', targetId: { in: rows.map((r) => r.id) } },
            _count: { _all: true },
          })
        : [];
      const reactionsBy = new Map(reactions.map((r) => [r.targetId, r._count._all]));
      const thumbs = await this.postThumbnails(rows.map((row) => row.id));

      return new Paginated(
        rows.map((post) => ({
          targetKind: 'POST' as const,
          id: post.id,
          title: post.title,
          preview: post.content.slice(0, 160),
          thumbnailUrl: thumbs.get(post.id)?.url ?? null,
          thumbnailKind: thumbs.get(post.id)?.kind ?? null,
          likeCount: reactionsBy.get(post.id) ?? 0,
          commentCount: post.commentCount,
          viewCount: null,
          createdAt: post.createdAt.toISOString(),
        })),
        query.meta(total),
      );
    }

    const [rows, total] = await Promise.all([
      this.prisma.reel.findMany({
        where,
        orderBy: [...orderBy],
        skip: query.skip,
        take: query.take,
        include: { asset: true },
      }),
      this.prisma.reel.count({ where }),
    ]);

    // ใช้ตัวแปลงของฟีดเพื่อให้ commentCount นับแบบเดียวกันทุกหน้า
    const [reels, thumbnails] = await Promise.all([
      this.reels.present(user, rows),
      Promise.all(rows.map((row) => this.sign(row.asset))),
    ]);

    return new Paginated(
      reels.map((reel, index) => ({
        targetKind: 'REEL' as const,
        id: reel.id,
        title: reel.title,
        preview: reel.caption,
        thumbnailUrl: thumbnails[index],
        thumbnailKind: 'VIDEO' as const,
        likeCount: reel.likeCount,
        commentCount: reel.commentCount,
        viewCount: reel.viewCount,
        createdAt: reel.createdAt,
      })),
      query.meta(total),
    );
  }

  /// ประวัติบัญชี — สร้างจาก audit log ของผู้เรียกเท่านั้น + "เข้าร่วม" หนึ่งแถว
  ///
  /// ไม่มีรายการเปลี่ยนรหัสผ่าน อีเมล หรือชื่อผู้ใช้ **โดยตั้งใจ** — สามอย่างนั้น
  /// Core Hub เป็นเจ้าของ (auth-contract) ระบบย่อยไม่รู้ว่าเปลี่ยนเมื่อไหร่ และ
  /// การแต่งรายการขึ้นมาเองคือการบอกผู้ใช้ในสิ่งที่ไม่จริง
  ///
  /// การลบเนื้อหานับเฉพาะของตัวเองที่ตัวเองลบ — ผู้ดูแลที่ลบโพสต์ของคนอื่นไม่ใช่
  /// "ประวัติบัญชี" ของผู้ดูแล และแถวที่ผู้ดูแลลบของเราก็เป็น audit ของคนอื่น
  /// ซึ่งห้ามหลุดออกมาที่นี่
  ///
  /// JOINED อยู่เก่าสุดเสมอ จึงแบ่งหน้าด้วยการเลื่อน offset หนึ่งช่องแทนการ
  /// รวมตารางที่ฐานข้อมูล
  async accountHistory(
    user: CoreHubUser,
    query: AccountHistoryQuery,
  ): Promise<Paginated<AccountHistoryItemDto>> {
    const me = user.coreUserId;
    const where: Prisma.AuditLogWhereInput = {
      actorCoreUserId: me,
      OR: [
        {
          action: {
            in: ['profile.bio_change', 'profile.cover_change', 'profile.website_change', 'channel.create'],
          },
        },
        { action: 'post.delete', metadata: { path: ['author_core_user_id'], equals: me } },
        { action: 'story.delete', metadata: { path: ['author_core_user_id'], equals: me } },
        { action: 'reel.delete', metadata: { path: ['owner_core_user_id'], equals: me } },
      ],
    };
    const newest = query.order !== 'oldest';

    const [auditTotal, member] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.subsystemMember.findUnique({
        where: { coreUserId: me },
        select: { createdAt: true },
      }),
    ]);

    // ตำแหน่งของ JOINED ในรายการรวม: ท้ายสุดถ้าใหม่ไปเก่า · แรกสุดถ้าเก่าไปใหม่
    const joinedIndex = newest ? auditTotal : 0;
    const start = query.skip;
    const end = query.skip + query.take;
    const includeJoined = joinedIndex >= start && joinedIndex < end;
    const auditSkip = newest ? start : Math.max(0, start - 1);
    const auditTake = query.take - (includeJoined ? 1 : 0);

    const rows =
      auditTake > 0
        ? await this.prisma.auditLog.findMany({
            where,
            orderBy: [
              { createdAt: newest ? 'desc' : 'asc' },
              { id: newest ? 'desc' : 'asc' },
            ],
            skip: auditSkip,
            take: auditTake,
          })
        : [];

    const items = rows.map(toHistoryItem);

    if (includeJoined) {
      const joined: AccountHistoryItemDto = {
        id: 'joined',
        kind: 'JOINED',
        detail: null,
        // แถวสมาชิกเกิดตอนเข้าระบบย่อยครั้งแรก — ถ้าไม่มี (ยังไม่เคยมีอะไรสร้างแถว)
        // ใช้เวลาของประวัติเก่าสุด เพื่อให้ JOINED ยังเก่าสุดอย่างที่สัญญาไว้
        createdAt: (
          member?.createdAt ??
          (await this.oldestHistoryAt(where)) ??
          new Date()
        ).toISOString(),
      };

      if (newest) items.push(joined);
      else items.unshift(joined);
    }

    return new Paginated(items, query.meta(auditTotal + 1));
  }

  private async oldestHistoryAt(
    where: Prisma.AuditLogWhereInput,
  ): Promise<Date | null> {
    const oldest = await this.prisma.auditLog.findFirst({
      where,
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    return oldest?.createdAt ?? null;
  }

  private async sign(asset: {
    bucket: string;
    objectPath: string;
    fileName: string;
  }): Promise<string | null> {
    try {
      const signed = await this.storage.createDownloadUrl(
        asset.bucket,
        asset.objectPath,
        {
          ttlSeconds: THUMBNAIL_TTL_SECONDS,
          fileName: asset.fileName,
          asAttachment: false,
        },
      );

      return signed.url;
    } catch {
      // ภาพย่อที่เซ็นไม่ได้ไม่ควรทำให้ทั้งหน้ากิจกรรมล้ม — หน้าบ้านแสดงช่องว่างแทน
      return null;
    }
  }
}

/// from / to → ช่วงเวลาจริงแบบ [gte, lt) ตามวันของกรุงเทพฯ
///
/// `2026-09-29` = 2026-09-28T17:00Z ถึงก่อน 2026-09-29T17:00Z · เวลาเต็มที่
/// ส่งมาถูกปัดเป็นวันที่มันตกอยู่ในเวลากรุงเทพฯ แล้วนับทั้งวัน
export function dayRange(
  query: ActivityRangeQuery,
): { gte?: Date; lt?: Date } | undefined {
  if (!query.from && !query.to) {
    return undefined;
  }

  const fromDay = query.from ? bangkokDayStart(query.from, 'from') : undefined;
  const toDay = query.to ? bangkokDayStart(query.to, 'to') : undefined;

  if (fromDay !== undefined && toDay !== undefined && fromDay > toDay) {
    // ส่งเป็นอาเรย์เพื่อให้ตัวกรอง error ตอบ VALIDATION_ERROR เหมือนการตรวจ DTO
    throw new BadRequestException(['from ต้องไม่อยู่หลัง to']);
  }

  return {
    ...(fromDay !== undefined ? { gte: new Date(fromDay) } : {}),
    ...(toDay !== undefined ? { lt: new Date(toDay + DAY_MS) } : {}),
  };
}

/// เวลาเริ่มวัน (ms) ตามกรุงเทพฯ ของค่าที่ผู้ใช้ส่งมา
function bangkokDayStart(value: string, field: 'from' | 'to'): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let y: number;
  let m: number;
  let d: number;

  if (dateOnly) {
    [y, m, d] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];

    // Date.UTC ยอมรับ 2026-02-31 แล้วเลื่อนเป็นมีนาคมเงียบ ๆ — ต้องตรวจย้อนกลับ
    const probe = new Date(Date.UTC(y, m - 1, d));

    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== m - 1 ||
      probe.getUTCDate() !== d
    ) {
      throw new BadRequestException([`${field} ไม่ใช่วันที่ที่มีอยู่จริง`]);
    }
  } else {
    const instant = Date.parse(value);

    if (Number.isNaN(instant)) {
      throw new BadRequestException([`${field} ไม่ใช่วันเวลาที่ถูกต้อง`]);
    }

    const local = new Date(instant + BANGKOK_OFFSET_MS);

    [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
  }

  return Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS;
}

function toHistoryItem(row: AuditLogModel): AccountHistoryItemDto {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const base = { id: row.id, createdAt: row.createdAt.toISOString() };

  switch (row.action as (typeof HISTORY_ACTIONS)[number]) {
    case 'profile.bio_change': {
      const next = typeof meta.new === 'string' && meta.new !== '' ? meta.new : null;

      return next
        ? { ...base, kind: 'BIO_CHANGED', detail: next }
        : { ...base, kind: 'BIO_REMOVED', detail: null };
    }
    case 'profile.website_change':
      return {
        ...base,
        kind: 'WEBSITE_CHANGED',
        detail: typeof meta.new === 'string' && meta.new ? meta.new : null,
      };
    case 'profile.cover_change':
      return {
        ...base,
        kind: meta.removed === true ? 'COVER_REMOVED' : 'COVER_CHANGED',
        detail: null,
      };
    case 'post.delete':
      return { ...base, kind: 'CONTENT_DELETED', detail: 'POST' };
    case 'reel.delete':
      return { ...base, kind: 'CONTENT_DELETED', detail: 'REEL' };
    case 'story.delete':
      return { ...base, kind: 'CONTENT_DELETED', detail: 'STORY' };
    case 'channel.create':
    default:
      return {
        ...base,
        kind: 'ROOM_CREATED',
        detail:
          (typeof meta.name === 'string' && meta.name) ||
          (typeof meta.kind === 'string' ? meta.kind : null),
      };
  }
}
