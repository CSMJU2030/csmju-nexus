import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { ApiProperty } from '@nestjs/swagger';
import { BlocksService } from '../blocks/blocks.service.js';
import { FollowsService } from '../follows/follows.service.js';
import { PrivacyService } from '../settings/privacy.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ReelModel } from '../../generated/prisma/models.js';
import {
  CommentLikeDto,
  RepostStateDto,
  CreateReelCommentDto,
  CreateReelDto,
  ListReelCommentsQuery,
  ListReelsQuery,
  ReelCommentResponseDto,
  ReelResponseDto,
  toReelCommentResponse,
  toReelResponse,
} from './dto/reel.dto.js';
import { isStaffLike } from '../../auth/role-mapping.js';

/// payload ของ endpoint กดไลก์ — แยกเป็น class เพื่อให้โผล่ใน openapi.json
export class LikeCountDto {
  @ApiProperty({ example: 129 })
  likeCount!: number;
}

export class ViewCountDto {
  @ApiProperty({
    example: 842,
    description: 'จำนวนคนที่เคยดู ไม่ใช่จำนวนครั้งที่เล่น — คนหนึ่งนับครั้งเดียว',
  })
  viewCount!: number;
}

/// P2002 = unique constraint ของ Prisma
///
/// ตรวจด้วยรหัส ไม่ใช่ catch เปล่า ๆ เพราะ "ดูซ้ำ" กับ "ฐานข้อมูลล่ม"
/// ต้องไม่ถูกปฏิบัติเหมือนกัน
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class ReelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly follows: FollowsService,
    private readonly privacy: PrivacyService,
    private readonly blocks: BlocksService,
  ) {}

  async list(
    user: CoreHubUser,
    query: ListReelsQuery,
  ): Promise<Paginated<ReelResponseDto>> {
    const where = await this.feedWhere(user, query);

    // contracts/vocabulary.json บังคับ meta แบบ { total, page, limit, totalPages }
    // offset pagination ที่นี่ ทั้งที่ฟีดแบบเลื่อนไม่สุดควรใช้ cursor
    // TODO(PL): เสนอ PM ขอเพิ่ม cursor endpoint สำหรับฟีดวิดีโอและแชท
    const [rows, total] = await Promise.all([
      this.prisma.reel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.reel.count({ where }),
    ]);

    return new Paginated(await this.present(user, rows), query.meta(total));
  }

  /// แปลงคลิปหลายคลิปเป็น response — สองคิวรีต่อหน้าเสมอ (ไลก์ของฉัน · ยอดความคิดเห็น)
  ///
  /// เปิดเป็น public เพื่อให้ "กิจกรรมของคุณ" ใช้รูปแบบเดียวกับฟีดทุกตัวอักษร
  async present(
    user: CoreHubUser,
    rows: ReelModel[],
  ): Promise<ReelResponseDto[]> {
    const ids = rows.map((row) => row.id);
    const [likedIds, comments, reposted, canComment] = await Promise.all([
      this.likedReelIds(user.coreUserId, ids),
      this.commentCounts(ids),
      this.repostedReelIds(user.coreUserId, ids),
      this.privacy.canCommentMany(
        user.coreUserId,
        rows.map((row) => row.authorCoreUserId),
      ),
    ]);

    return rows.map((row) =>
      toReelResponse(row, {
        likedByMe: likedIds.has(row.id),
        commentCount: comments.get(row.id) ?? 0,
        repostedByMe: reposted.has(row.id),
        canComment: canComment.get(row.authorCoreUserId) ?? false,
      }),
    );
  }

  /// รีโพสต์คลิป (Instagram Repost) — รีโพสต์ซ้ำไม่เพิ่มยอด เรียกซ้ำได้ปลอดภัย
  ///
  /// แถวรีโพสต์กับตัวนับเขียนในทรานแซกชันเดียว และบวกเฉพาะเมื่อแถวเพิ่งเกิด
  /// (createMany + skipDuplicates บอกได้) · แจ้งเจ้าของเฉพาะครั้งแรกจริง
  async repost(user: CoreHubUser, id: string): Promise<RepostStateDto> {
    const reel = await this.requireVisibleReel(user, id);

    if (reel.authorCoreUserId === user.coreUserId) {
      throw new BadRequestException('รีโพสต์คลิปของตัวเองไม่ได้');
    }

    const { created, count } = await this.prisma.$transaction(async (tx) => {
      const made = await tx.reelRepost.createMany({
        data: [{ reelId: id, coreUserId: user.coreUserId }],
        skipDuplicates: true,
      });
      const row =
        made.count > 0
          ? await tx.reel.update({
              where: { id },
              data: { repostCount: { increment: 1 } },
              select: { repostCount: true },
            })
          : await tx.reel.findUniqueOrThrow({ where: { id }, select: { repostCount: true } });

      return { created: made.count > 0, count: row.repostCount };
    });

    if (created) {
      await this.notifications.push({
        coreUserId: reel.authorCoreUserId,
        kind: 'REEL_REPOST',
        refId: id,
        actorCoreUserId: user.coreUserId,
        payload: { preview: reel.title },
      });
    }

    return { repostCount: count, repostedByMe: true };
  }

  async unrepost(user: CoreHubUser, id: string): Promise<RepostStateDto> {
    await this.assertReelExists(id);

    const count = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.reelRepost.deleteMany({
        where: { reelId: id, coreUserId: user.coreUserId },
      });
      const row =
        removed.count > 0
          ? await tx.reel.update({
              where: { id },
              data: { repostCount: { decrement: 1 } },
              select: { repostCount: true },
            })
          : await tx.reel.findUniqueOrThrow({ where: { id }, select: { repostCount: true } });

      return row.repostCount;
    });

    return { repostCount: count, repostedByMe: false };
  }

  /// แท็บ "รีโพสต์" บนโปรไฟล์ — คลิปที่คนนี้รีโพสต์ ใหม่ไปเก่าตามเวลาที่รีโพสต์
  ///
  /// ซ่อนทั้งหน้าถ้าเจ้าของโปรไฟล์บล็อกกันกับผู้เรียก และซ่อนคลิปของคนที่
  /// บล็อกกันกับผู้เรียกออกจากรายการ
  async repostsOf(
    user: CoreHubUser,
    coreUserId: string,
    query: PaginationQuery,
  ): Promise<Paginated<ReelResponseDto>> {
    const hidden = await this.blocks.hiddenFor(user.coreUserId);

    if (hidden.includes(coreUserId)) {
      return new Paginated([], query.meta(0));
    }

    const where = {
      coreUserId,
      ...(hidden.length ? { reel: { authorCoreUserId: { notIn: hidden } } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reelRepost.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { reelId: 'desc' }],
        skip: query.skip,
        take: query.take,
        include: { reel: true },
      }),
      this.prisma.reelRepost.count({ where }),
    ]);

    return new Paginated(
      await this.present(
        user,
        rows.map((row) => row.reel),
      ),
      query.meta(total),
    );
  }

  /// คลิปที่ผู้เรียกเห็นได้ — มีจริงและไม่ได้บล็อกกันกับเจ้าของ (404 ทั้งสองกรณี)
  private async requireVisibleReel(user: CoreHubUser, id: string) {
    const reel = await this.prisma.reel.findUnique({
      where: { id },
      select: { id: true, title: true, authorCoreUserId: true },
    });

    if (!reel || (await this.blocks.isBlockedEither(user.coreUserId, reel.authorCoreUserId))) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }

    return reel;
  }

  private async repostedReelIds(coreUserId: string, reelIds: string[]): Promise<Set<string>> {
    if (reelIds.length === 0) return new Set();

    const rows = await this.prisma.reelRepost.findMany({
      where: { coreUserId, reelId: { in: reelIds } },
      select: { reelId: true },
    });

    return new Set(rows.map((row) => row.reelId));
  }

  async findOne(user: CoreHubUser, id: string): Promise<ReelResponseDto> {
    const reel = await this.prisma.reel.findUnique({ where: { id } });

    // คลิปของคนที่บล็อกกัน "ไม่มีอยู่" สำหรับผู้เรียก — แยกไม่ออกจากถูกลบโดยตั้งใจ
    if (!reel || (await this.blocks.isBlockedEither(user.coreUserId, reel.authorCoreUserId))) {
      throw new NotFoundException('ไม่พบคลิปนี้ อาจถูกลบไปแล้ว');
    }

    const [response] = await this.present(user, [reel]);

    return response;
  }

  async create(
    user: CoreHubUser,
    dto: CreateReelDto,
  ): Promise<ReelResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.assetId },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบไฟล์ที่อ้างถึง — อัปโหลดให้เสร็จก่อน');
    }

    // ห้ามเอาไฟล์ของคนอื่นมาโพสต์เป็นผลงานตัวเอง
    if (asset.ownerCoreUserId !== user.coreUserId) {
      throw new ForbiddenException('ไฟล์นี้ไม่ใช่ของคุณ');
    }

    if (asset.status !== 'READY') {
      throw new BadRequestException(
        'ไฟล์ยังอัปโหลดไม่เสร็จ — เรียก /assets/{id}/commit ให้สำเร็จก่อน',
      );
    }

    if (asset.kind !== 'VIDEO') {
      throw new BadRequestException('คลิป Reels ต้องเป็นไฟล์วิดีโอ');
    }

    const reel = await this.prisma.reel.create({
      data: {
        title: dto.title,
        caption: dto.caption ?? null,
        assetId: dto.assetId,
        durationMs: dto.durationMs,
        authorCoreUserId: user.coreUserId,
      },
    });

    return toReelResponse(reel, { likedByMe: false, commentCount: 0 });
  }

  async remove(user: CoreHubUser, id: string): Promise<void> {
    const reel = await this.prisma.reel.findUnique({ where: { id } });

    if (!reel) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }

    // เจ้าของลบได้ และ admin ระดับองค์กรลบได้เพื่อจัดการเนื้อหา
    const isOwner = reel.authorCoreUserId === user.coreUserId;
    const isOrgAdmin = user.coreRole === 'admin';

    if (!isOwner && !isOrgAdmin) {
      throw new ForbiddenException('ลบได้เฉพาะคลิปของตัวเอง');
    }

    await this.prisma.$transaction([
      this.prisma.reel.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'reel.delete',
          targetKind: 'REEL',
          targetId: id,
          metadata: { owner_core_user_id: reel.authorCoreUserId, by_admin: !isOwner },
        },
      }),
    ]);
  }

  /// กดไลก์ซ้ำไม่เพิ่มยอด เพราะ primary key เป็น (reelId, coreUserId)
  /// ตัวนับเก็บไว้ล่วงหน้าเพื่อไม่ต้อง COUNT ทุกครั้งที่โหลดฟีด
  async like(user: CoreHubUser, id: string): Promise<LikeCountDto> {
    await this.assertReelExists(id);

    const created = await this.prisma.reelLike
      .create({ data: { reelId: id, coreUserId: user.coreUserId } })
      .then(() => true)
      .catch(() => false);

    if (!created) {
      const reel = await this.prisma.reel.findUniqueOrThrow({ where: { id } });
      return { likeCount: reel.likeCount };
    }

    const reel = await this.prisma.reel.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    });

    // แจ้งเฉพาะตอนไลก์ครั้งแรกจริง ๆ — โค้ดด้านบน return ไปก่อนแล้วถ้ากดซ้ำ
    // ไม่งั้นเจ้าของคลิปจะโดนแจ้งเตือนทุกครั้งที่มีคนกดปุ่มเล่น
    await this.notifications.push({
      coreUserId: reel.authorCoreUserId,
      kind: 'REEL_LIKE',
      refId: reel.id,
      actorCoreUserId: user.coreUserId,
      payload: { preview: reel.title },
    });

    return { likeCount: reel.likeCount };
  }

  async unlike(user: CoreHubUser, id: string): Promise<LikeCountDto> {
    await this.assertReelExists(id);

    const deleted = await this.prisma.reelLike
      .delete({ where: { reelId_coreUserId: { reelId: id, coreUserId: user.coreUserId } } })
      .then(() => true)
      .catch(() => false);

    if (!deleted) {
      const reel = await this.prisma.reel.findUniqueOrThrow({ where: { id } });
      return { likeCount: reel.likeCount };
    }

    const reel = await this.prisma.reel.update({
      where: { id },
      data: { likeCount: { decrement: 1 } },
    });

    return { likeCount: reel.likeCount };
  }

  /// บันทึกว่าผู้เรียกดูคลิปนี้แล้ว
  ///
  /// นับ "คนที่เคยดู" ไม่ใช่ "จำนวนครั้งที่เล่น" — คีย์ (reelId, coreUserId)
  /// ทำให้คนหนึ่งนับได้ครั้งเดียวตั้งแต่ระดับฐานข้อมูล จึงปั่นยอดด้วยการ
  /// กดรีเฟรชรัว ๆ ไม่ได้ และไม่ต้องเชื่อ client เรื่องการนับ
  ///
  /// ตัวนับ viewCount เพิ่มในทรานแซกชันเดียวกับการสร้างแถวผู้ชม
  /// ไม่งั้นสองคนกดดูพร้อมกันแล้วตัวเลขจะหายไปหนึ่ง
  async markViewed(user: CoreHubUser, id: string): Promise<ViewCountDto> {
    await this.assertReelExists(id);

    // แถวผู้ชมกับตัวนับต้องคอมมิตด้วยกันจริง ๆ
    //
    // คอมเมนต์ข้างบนอ้างว่าอยู่ในทรานแซกชันเดียวกันมาตลอด แต่โค้ดเดิมยิงสอง
    // คำสั่งแยกกัน ถ้าตัวที่สองล้ม (pool หมด · เน็ตสะดุด) จะเหลือแถวผู้ชมที่
    // ไม่เคยถูกนับ และเพราะคีย์ (reelId, coreUserId) กันไม่ให้ใส่ซ้ำ คนนั้นจึง
    // **ไม่มีทางถูกนับได้อีกเลย** ยอดวิวขาดหายถาวรโดยไม่มีใครรู้
    try {
      const reel = await this.prisma.$transaction(async (tx) => {
        await tx.reelView.create({
          data: { reelId: id, coreUserId: user.coreUserId },
        });

        return tx.reel.update({
          where: { id },
          data: { viewCount: { increment: 1 } },
          select: { viewCount: true },
        });
      });

      return { viewCount: reel.viewCount };
    } catch (error) {
      // จับเฉพาะ "ดูซ้ำ" (ชนคีย์) ซึ่งถูกต้องแล้ว — ของเดิม catch เปล่า ๆ
      // กลืนทุก error รวมถึงฐานข้อมูลล่ม แล้วรายงานยอดเดิมกลับไปเหมือนปกติ
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const reel = await this.prisma.reel.findUniqueOrThrow({
        where: { id },
        select: { viewCount: true },
      });

      return { viewCount: reel.viewCount };
    }
  }

  /// ความคิดเห็นใต้คลิปแบบแผงของ Instagram
  ///
  /// ไม่ส่ง parentId = ระดับบนสุด ใหม่สุดก่อน (ใต้คลิปสั้นคนอ่านของใหม่ก่อน)
  /// ส่ง parentId = คำตอบของความคิดเห็นนั้น เก่าไปใหม่ (อ่านเป็นบทสนทนา)
  /// คำตอบไม่ปนในรายการระดับบนสุด ไม่งั้นเธรดยาวหนึ่งเธรดจะกลบทั้งแผง
  async listComments(
    user: CoreHubUser,
    reelId: string,
    query: ListReelCommentsQuery,
  ): Promise<Paginated<ReelCommentResponseDto>> {
    await this.assertReelExists(reelId);

    if (query.parentId) {
      await this.requireTopLevelComment(reelId, query.parentId);
    }

    // ความคิดเห็นของคนที่บล็อกกันกับผู้เรียกไม่แสดง (เหมือน Instagram)
    const hidden = await this.blocks.hiddenFor(user.coreUserId);
    const where = {
      reelId,
      deletedAt: null,
      parentId: query.parentId ?? null,
      ...(hidden.length ? { authorCoreUserId: { notIn: hidden } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reelComment.findMany({
        where,
        orderBy: { createdAt: query.parentId ? 'asc' : 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.reelComment.count({ where }),
    ]);

    const liked = await this.likedCommentIds(
      user.coreUserId,
      rows.map((row) => row.id),
    );

    return new Paginated(
      rows.map((row) =>
        toReelCommentResponse(row, { likedByMe: liked.has(row.id) }),
      ),
      query.meta(total),
    );
  }

  async addComment(
    user: CoreHubUser,
    reelId: string,
    dto: CreateReelCommentDto,
  ): Promise<ReelCommentResponseDto> {
    const reel = await this.prisma.reel.findUnique({
      where: { id: reelId },
      select: { id: true, title: true, authorCoreUserId: true },
    });

    if (!reel) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }

    // commentsFrom ของเจ้าของคลิป + การบล็อก (ทิศไหนก็ได้) — เจ้าของคอมเมนต์ได้เสมอ
    if (!(await this.privacy.canComment(user.coreUserId, reel.authorCoreUserId))) {
      throw new ForbiddenException('เจ้าของคลิปจำกัดว่าใครแสดงความคิดเห็นได้ คุณจึงคอมเมนต์คลิปนี้ไม่ได้');
    }

    const parent = dto.parentId
      ? await this.requireTopLevelComment(reelId, dto.parentId)
      : null;

    // สร้างคำตอบกับบวกตัวนับในทรานแซกชันเดียว — สองคนตอบพร้อมกันต้องได้ +2
    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reelComment.create({
        data: {
          reelId,
          authorCoreUserId: user.coreUserId,
          content: dto.content,
          parentId: parent?.id ?? null,
        },
      });

      if (parent) {
        await tx.reelComment.update({
          where: { id: parent.id },
          data: { replyCount: { increment: 1 } },
        });
      }

      return created;
    });

    const payload = {
      preview: dto.content.slice(0, 120),
      reelId: reelId,
      commentId: comment.id,
      parentId: parent?.id ?? null,
    };

    await this.notifications.push({
      coreUserId: reel.authorCoreUserId,
      kind: 'REEL_COMMENT',
      refId: reelId,
      actorCoreUserId: user.coreUserId,
      payload,
    });

    // คนที่ถูกตอบก็ควรรู้ — ยกเว้นเขาเป็นเจ้าของคลิปซึ่งเพิ่งได้แจ้งเตือนไปแล้ว
    if (parent && parent.authorCoreUserId !== reel.authorCoreUserId) {
      await this.notifications.push({
        coreUserId: parent.authorCoreUserId,
        kind: 'REEL_COMMENT',
        refId: reelId,
        actorCoreUserId: user.coreUserId,
        payload: { ...payload, reply: true },
      });
    }

    return toReelCommentResponse(comment, { likedByMe: false });
  }

  /// กดใจความคิดเห็น — กดซ้ำไม่เพิ่มยอด (คีย์ comment+user) จึงเรียกซ้ำได้ปลอดภัย
  ///
  /// แถวใจกับตัวนับเขียนในทรานแซกชันเดียว และบวกเฉพาะเมื่อแถวเพิ่งเกิดจริง
  /// (createMany + skipDuplicates บอกได้) ไม่งั้นกดรัว ๆ จะปั่นยอดได้
  async likeComment(
    user: CoreHubUser,
    reelId: string,
    commentId: string,
  ): Promise<CommentLikeDto> {
    await this.requireLiveComment(reelId, commentId);

    const { likeCount, created, author, content } = await this.prisma.$transaction(async (tx) => {
      const made = await tx.reelCommentLike.createMany({
        data: [{ commentId, coreUserId: user.coreUserId }],
        skipDuplicates: true,
      });

      const row =
        made.count > 0
          ? await tx.reelComment.update({
              where: { id: commentId },
              data: { likeCount: { increment: 1 } },
              select: { likeCount: true, authorCoreUserId: true, content: true },
            })
          : await tx.reelComment.findUniqueOrThrow({
              where: { id: commentId },
              select: { likeCount: true, authorCoreUserId: true, content: true },
            });

      return {
        likeCount: row.likeCount,
        created: made.count > 0,
        author: row.authorCoreUserId,
        content: row.content,
      };
    });

    // แจ้งเฉพาะใจแรกจริง — กดใจ/เลิกรัว ๆ ต้องไม่ปลุกเจ้าของความคิดเห็นซ้ำ
    if (created) {
      await this.notifications.push({
        coreUserId: author,
        kind: 'COMMENT_LIKE',
        refId: reelId,
        actorCoreUserId: user.coreUserId,
        payload: { reelId: reelId, commentId: commentId, preview: content.slice(0, 120) },
      });
    }

    return { likeCount: likeCount, likedByMe: true };
  }

  async unlikeComment(
    user: CoreHubUser,
    reelId: string,
    commentId: string,
  ): Promise<CommentLikeDto> {
    await this.requireLiveComment(reelId, commentId);

    const likeCount = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.reelCommentLike.deleteMany({
        where: { commentId, coreUserId: user.coreUserId },
      });

      const row =
        removed.count > 0
          ? await tx.reelComment.update({
              where: { id: commentId },
              data: { likeCount: { decrement: 1 } },
              select: { likeCount: true },
            })
          : await tx.reelComment.findUniqueOrThrow({
              where: { id: commentId },
              select: { likeCount: true },
            });

      return row.likeCount;
    });

    return { likeCount: likeCount, likedByMe: false };
  }

  async removeComment(
    user: CoreHubUser,
    reelId: string,
    commentId: string,
  ): Promise<void> {
    const comment = await this.prisma.reelComment.findFirst({
      where: { id: commentId, reelId, deletedAt: null },
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

    // ลบแบบทิ้งร่องรอยเหมือนเดิม · ความคิดเห็นระดับบนสุดพาคำตอบหายไปด้วย
    // (Instagram ก็ทำแบบนี้ — คำตอบที่ไม่มีต้นเรื่องอ่านไม่รู้เรื่อง) ส่วนคำตอบ
    // ต้องหักตัวนับของต้นเรื่อง ไม่งั้น "ดูคำตอบ 3 รายการ" จะเปิดมาเจอสอง
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.reelComment.update({
        where: { id: commentId },
        data: { deletedAt: now },
      });

      if (comment.parentId) {
        await tx.reelComment.updateMany({
          where: { id: comment.parentId, replyCount: { gt: 0 } },
          data: { replyCount: { decrement: 1 } },
        });
      } else {
        await tx.reelComment.updateMany({
          where: { parentId: commentId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
    });
  }

  /// ยอดความคิดเห็นของหลายคลิป — groupBy ครั้งเดียว (รวมคำตอบ ไม่นับที่ถูกลบ)
  async commentCounts(reelIds: string[]): Promise<Map<string, number>> {
    if (reelIds.length === 0) {
      return new Map();
    }

    const grouped = await this.prisma.reelComment.groupBy({
      by: ['reelId'],
      where: { reelId: { in: reelIds }, deletedAt: null },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.reelId, row._count._all]));
  }

  /// ต้นเรื่องที่ตอบได้: อยู่คลิปเดียวกัน ยังไม่ถูกลบ และไม่ใช่คำตอบเอง
  ///
  /// ห้ามตอบซ้อนโดยตั้งใจ (Instagram ก็ไม่ให้) — โครงสร้างที่ลึกไม่จำกัด
  /// ทำให้ทั้งแผงและการนับซับซ้อนขึ้นแบบไม่คุ้ม
  private async requireTopLevelComment(reelId: string, commentId: string) {
    const parent = await this.prisma.reelComment.findFirst({
      where: { id: commentId, reelId, deletedAt: null },
      select: { id: true, parentId: true, authorCoreUserId: true },
    });

    if (!parent) {
      throw new NotFoundException('ไม่พบความคิดเห็นที่จะตอบกลับ');
    }

    if (parent.parentId) {
      throw new BadRequestException(
        'ตอบคำตอบซ้อนไม่ได้ — ตอบที่ความคิดเห็นต้นเรื่องแทน (พิมพ์ @ชื่อ เพื่อระบุคนได้)',
      );
    }

    return parent;
  }

  private async requireLiveComment(
    reelId: string,
    commentId: string,
  ): Promise<void> {
    const found = await this.prisma.reelComment.findFirst({
      where: { id: commentId, reelId, deletedAt: null },
      select: { id: true },
    });

    if (!found) {
      throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }
  }

  private async likedCommentIds(
    coreUserId: string,
    commentIds: string[],
  ): Promise<Set<string>> {
    if (commentIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.reelCommentLike.findMany({
      where: { coreUserId, commentId: { in: commentIds } },
      select: { commentId: true },
    });

    return new Set(rows.map((row) => row.commentId));
  }

  /// เงื่อนไขของฟีด — ทั้งหมด เฉพาะคนที่ติดตาม หรือของคนคนเดียว
  ///
  /// feed=following คือฟีดแบบ Instagram/Facebook ส่วน authorCoreUserId คือ
  /// หน้าโปรไฟล์ ทั้งสองใช้คิวรีเดียวกันเพราะต่างกันแค่เงื่อนไข where
  private async feedWhere(user: CoreHubUser, query: ListReelsQuery) {
    // คนที่บล็อกกันกับผู้เรียกหายจากฟีดทุกแบบ รวมหน้าโปรไฟล์ของเขา
    const hidden = await this.follows.hiddenFor(user);
    const notHidden = hidden.length ? { notIn: hidden } : undefined;

    if (query.authorCoreUserId) {
      return hidden.includes(query.authorCoreUserId)
        ? { id: { in: [] as string[] } }
        : { authorCoreUserId: query.authorCoreUserId };
    }

    if (query.feed === 'following') {
      const coreUserIds = await this.follows.followingCoreUserIds(user);

      return { authorCoreUserId: { in: coreUserIds.filter((id) => !hidden.includes(id)) } };
    }

    return notHidden ? { authorCoreUserId: notHidden } : {};
  }

  private async assertReelExists(id: string): Promise<void> {
    const exists = await this.prisma.reel.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }
  }

  private async likedReelIds(
    coreUserId: string,
    reelIds: string[],
  ): Promise<Set<string>> {
    if (reelIds.length === 0) {
      return new Set();
    }

    const likes = await this.prisma.reelLike.findMany({
      where: { coreUserId, reelId: { in: reelIds } },
      select: { reelId: true },
    });

    return new Set(likes.map((like) => like.reelId));
  }
}
