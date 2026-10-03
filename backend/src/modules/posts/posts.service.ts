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
import type { PostModel } from '../../generated/prisma/models.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { FollowsService } from '../follows/follows.service.js';
import { PrivacyService } from '../settings/privacy.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReactionsService } from '../reactions/reactions.service.js';
import {
  CreateCommentDto,
  CreatePostDto,
  ListPostsQuery,
  PostCommentResponseDto,
  PostMediaDto,
  PostResponseDto,
  toCommentResponse,
  toPostResponse,
} from './dto/post.dto.js';
import { isStaffLike } from '../../auth/role-mapping.js';

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly follows: FollowsService,
    private readonly reactions: ReactionsService,
    private readonly privacy: PrivacyService,
    private readonly blocks: BlocksService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /// แปลงโพสต์หลายโพสต์เป็น response — คิวรีคงที่ต่อหน้า (รีแอ็กชัน · สื่อ · สิทธิ์คอมเมนต์)
  async present(user: CoreHubUser, rows: PostModel[]): Promise<PostResponseDto[]> {
    const ids = rows.map((row) => row.id);
    const [summaries, media, canComment] = await Promise.all([
      this.reactions.summariesFor(user, 'POST', ids),
      this.mediaOf(ids),
      this.privacy.canCommentMany(
        user.coreUserId,
        rows.map((row) => row.authorCoreUserId),
      ),
    ]);

    return rows.map((row, index) =>
      toPostResponse(row, summaries[index], {
        media: media.get(row.id) ?? [],
        canComment: canComment.get(row.authorCoreUserId) ?? false,
      }),
    );
  }

  /// รูป/วิดีโอของหลายโพสต์ในคิวรีเดียว พร้อม signed URL
  async mediaOf(postIds: string[]): Promise<Map<string, PostMediaDto[]>> {
    if (postIds.length === 0) return new Map();

    const rows = await this.prisma.postMedia.findMany({
      where: { postId: { in: postIds } },
      orderBy: [{ postId: 'asc' }, { position: 'asc' }],
      include: { asset: true },
    });

    const out = new Map<string, PostMediaDto[]>();

    await Promise.all(
      rows.map(async (row) => {
        const signed = await this.storage.createDownloadUrl(
          row.asset.bucket,
          row.asset.objectPath,
          { ttlSeconds: 300, fileName: row.asset.fileName, asAttachment: false },
        );
        const list = out.get(row.postId) ?? [];

        list[row.position] = {
          assetId: row.assetId,
          kind: row.asset.kind as 'IMAGE' | 'VIDEO',
          url: signed.url,
          mimeType: row.asset.mimeType,
        };
        out.set(row.postId, list);
      }),
    );

    // position อาจไม่ต่อเนื่อง (ไฟล์ถูกลบแยก) — บีบช่องว่างทิ้งแต่คงลำดับ
    for (const [key, list] of out) {
      out.set(key, list.filter(Boolean));
    }

    return out;
  }

  async list(
    user: CoreHubUser,
    query: ListPostsQuery,
  ): Promise<Paginated<PostResponseDto>> {
    const where = await this.feedWhere(user, query);

    const [rows, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.post.count({ where }),
    ]);

    // ยอดรีแอ็กชัน สื่อ และสิทธิ์คอมเมนต์ของทั้งหน้าในคิวรีชุดเดียว (ดู present)
    return new Paginated(await this.present(user, rows), query.meta(total));
  }

  async findOne(user: CoreHubUser, id: string): Promise<PostResponseDto> {
    const post = await this.prisma.post.findUnique({ where: { id } });

    // โพสต์ของคนที่บล็อกกัน "ไม่มีอยู่" สำหรับผู้เรียก — แยกไม่ออกจากถูกลบโดยตั้งใจ
    if (!post || (await this.blocks.isBlockedEither(user.coreUserId, post.authorCoreUserId))) {
      throw new NotFoundException('ไม่พบโพสต์นี้ อาจถูกลบไปแล้ว');
    }

    const [response] = await this.present(user, [post]);

    return response;
  }

  /// เงื่อนไขของกระดาน — ทั้งหมด เฉพาะคนที่ติดตาม หรือของคนคนเดียว
  private async feedWhere(user: CoreHubUser, query: ListPostsQuery) {
    // คนที่บล็อกกันกับผู้เรียกหายจากกระดานทุกแบบ รวมหน้าโปรไฟล์ของเขา
    const hidden = await this.follows.hiddenFor(user);

    if (query.authorCoreUserId) {
      return hidden.includes(query.authorCoreUserId)
        ? { id: { in: [] as string[] } }
        : { authorCoreUserId: query.authorCoreUserId };
    }

    if (query.feed === 'following') {
      const coreUserIds = await this.follows.followingCoreUserIds(user);

      return {
        authorCoreUserId: { in: coreUserIds.filter((id) => !hidden.includes(id)) },
        ...(query.courseTag ? { courseTag: query.courseTag } : {}),
      };
    }

    return {
      ...(hidden.length ? { authorCoreUserId: { notIn: hidden } } : {}),
      ...(query.courseTag ? { courseTag: query.courseTag } : {}),
    };
  }

  async create(
    user: CoreHubUser,
    dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    const title = dto.title?.trim() ?? '';
    const content = dto.content?.trim() ?? '';
    const assetIds = dto.assetIds ?? [];

    if (!title && !content && assetIds.length === 0) {
      throw new BadRequestException([
        'โพสต์ว่างเปล่า — ต้องมีหัวข้อ เนื้อหา หรือรูป/วิดีโออย่างน้อยหนึ่งอย่าง',
      ]);
    }

    await this.assertPostableAssets(user, assetIds);

    const post = await this.prisma.post.create({
      data: {
        title,
        content,
        courseTag: dto.courseTag ?? null,
        authorCoreUserId: user.coreUserId,
        media: {
          create: assetIds.map((assetId, position) => ({ assetId, position })),
        },
      },
    });

    const [response] = await this.present(user, [post]);

    return response;
  }

  /// ไฟล์ที่ใส่ในโพสต์ได้: ของผู้เรียก · commit แล้ว · รูปหรือวิดีโอ · ยังไม่ถูกใช้ที่อื่น
  ///
  /// unique(assetId) ของ post_media กันซ้ำระหว่างโพสต์อยู่แล้ว แต่ไฟล์ที่เป็นคลิป
  /// สตอรี่ รูปปก หรือไฟล์แนบในแชทต้องตรวจเองที่นี่ ไม่งั้นลบโพสต์ทีหลังแล้ว
  /// ไฟล์ของอีกที่จะหายตาม (asset ลบแบบ CASCADE ถึง post_media)
  private async assertPostableAssets(user: CoreHubUser, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        ownerCoreUserId: true,
        status: true,
        kind: true,
        messageId: true,
        reel: { select: { id: true } },
        story: { select: { id: true } },
        gallery: { select: { postId: true } },
        member: { select: { coreUserId: true } },
      },
    });

    if (assets.length !== assetIds.length) {
      throw new NotFoundException('ไม่พบไฟล์บางรายการ — อัปโหลดให้เสร็จก่อน');
    }

    for (const asset of assets) {
      if (asset.ownerCoreUserId !== user.coreUserId) {
        throw new ForbiddenException('ใช้ไฟล์ของคนอื่นโพสต์ไม่ได้');
      }

      if (asset.status !== 'READY') {
        throw new BadRequestException('มีไฟล์ที่ยังอัปโหลดไม่เสร็จ — เรียก commit ให้สำเร็จก่อน');
      }

      if (asset.kind !== 'IMAGE' && asset.kind !== 'VIDEO') {
        throw new BadRequestException('โพสต์แนบได้เฉพาะรูปภาพและวิดีโอ');
      }

      if (asset.messageId || asset.reel || asset.story || asset.gallery || asset.member) {
        throw new BadRequestException('มีไฟล์ที่ถูกใช้ไปแล้ว — อัปโหลดใหม่ถ้าต้องการโพสต์ซ้ำ');
      }
    }
  }


  async remove(user: CoreHubUser, id: string): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id } });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้');
    }

    const isOwner = post.authorCoreUserId === user.coreUserId;
    // บุคลากรและผู้ดูแลลบได้ เพราะกระดานข่าวเป็นพื้นที่ทางการของสาขา
    const canModerate =
      isStaffLike(user.coreRole);

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะโพสต์ของตัวเอง');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.post.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'post.delete',
          targetKind: 'POST',
          targetId: id,
          metadata: {
            author_core_user_id: post.authorCoreUserId,
            by_moderator: !isOwner,
          },
        },
      });
    });
  }

  async listComments(
    user: CoreHubUser,
    postId: string,
    query: PaginationQuery,
  ): Promise<Paginated<PostCommentResponseDto>> {
    await this.assertPostExists(postId);

    // ความคิดเห็นของคนที่บล็อกกันกับผู้เรียกไม่แสดง
    const hidden = await this.blocks.hiddenFor(user.coreUserId);
    const where = {
      postId,
      deletedAt: null,
      ...(hidden.length ? { authorCoreUserId: { notIn: hidden } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.postComment.findMany({
        where,
        orderBy: { createdAt: 'asc' }, // การถามตอบอ่านจากเก่าไปใหม่จึงเข้าใจง่ายกว่า
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.postComment.count({ where }),
    ]);

    return new Paginated(rows.map(toCommentResponse), query.meta(total));
  }

  /// สร้างคอมเมนต์และเพิ่มตัวนับในทรานแซกชันเดียว
  /// ถ้าแยกกัน ตัวนับจะเพี้ยนทันทีที่มีการเขียนพร้อมกันสองคน
  async addComment(
    user: CoreHubUser,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<PostCommentResponseDto> {
    await this.assertPostExists(postId);

    const owner = await this.prisma.post.findUniqueOrThrow({
      where: { id: postId },
      select: { authorCoreUserId: true },
    });

    // commentsFrom ของเจ้าของโพสต์ + การบล็อก — เจ้าของคอมเมนต์ได้เสมอ
    if (!(await this.privacy.canComment(user.coreUserId, owner.authorCoreUserId))) {
      throw new ForbiddenException('เจ้าของโพสต์จำกัดว่าใครแสดงความคิดเห็นได้ คุณจึงคอมเมนต์โพสต์นี้ไม่ได้');
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.postComment.create({
        data: {
          postId,
          authorCoreUserId: user.coreUserId,
          content: dto.content,
        },
      });

      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });

      return created;
    });

    const post = await this.prisma.post.findUniqueOrThrow({
      where: { id: postId },
      select: { authorCoreUserId: true, title: true },
    });

    await this.notifications.push({
      coreUserId: post.authorCoreUserId,
      kind: 'POST_COMMENT',
      refId: postId,
      actorCoreUserId: user.coreUserId,
      payload: { preview: dto.content.slice(0, 120), title: post.title },
    });

    return toCommentResponse(comment);
  }

  async removeComment(
    user: CoreHubUser,
    postId: string,
    commentId: string,
  ): Promise<void> {
    const comment = await this.prisma.postComment.findFirst({
      where: { id: commentId, postId, deletedAt: null },
    });

    if (!comment) {
      throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }

    const isOwner = comment.authorCoreUserId === user.coreUserId;
    const canModerate =
      isStaffLike(user.coreRole);

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะความคิดเห็นของตัวเอง');
    }

    // ลบแบบทิ้งร่องรอย และลดตัวนับให้ตรงกับจำนวนที่แสดงจริง
    await this.prisma.$transaction(async (tx) => {
      await tx.postComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      });

      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { decrement: 1 } },
      });
    });
  }

  private async assertPostExists(postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้');
    }
  }
}
