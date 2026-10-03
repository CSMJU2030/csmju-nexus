import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  FollowEdgeDto,
  FollowStatsDto,
  RelationDto,
  SuggestionDto,
} from './dto/follow.dto.js';

/// เพดานจำนวนคนที่เอาไปกรองฟีด
///
/// ไม่ใช่เพดานจำนวนคนที่ติดตามได้ — แค่จำกัดว่าฟีดหนึ่งหน้าจะดูของกี่คน
const FEED_AUTHOR_LIMIT = 500;

@Injectable()
export class FollowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly blocks: BlocksService,
  ) {}

  /// กดติดตาม — กดซ้ำไม่ถือว่าผิด และไม่ยิงแจ้งเตือนซ้ำ
  ///
  /// ใช้ createMany + skipDuplicates แทน upsert เพราะเราต้องรู้ว่า
  /// "แถวนี้เพิ่งเกิดใหม่จริงไหม" ถ้าใช้ upsert จะแยกไม่ออกระหว่างกดครั้งแรก
  /// กับกดซ้ำ แล้วคนถูกติดตามจะโดนแจ้งเตือนทุกครั้งที่อีกฝ่ายกดปุ่มเล่น
  async follow(user: CoreHubUser, target: string): Promise<RelationDto> {
    if (target === user.coreUserId) {
      throw new BadRequestException('ติดตามตัวเองไม่ได้');
    }

    // บล็อกกันอยู่ (ทิศไหนก็ได้) ติดตามกันไม่ได้ — ไม่งั้นคนที่ถูกบล็อกกดติดตาม
    // ใหม่ได้ทันทีหลังถูกตัด แล้วแจ้งเตือน FOLLOW ก็ยังไปถึงคนที่บล็อกเขา
    if (await this.blocks.isBlockedEither(user.coreUserId, target)) {
      throw new ForbiddenException('ติดตามคนนี้ไม่ได้');
    }

    const result = await this.prisma.follow.createMany({
      data: [{ followerCoreUserId: user.coreUserId, followingCoreUserId: target }],
      skipDuplicates: true,
    });

    if (result.count > 0) {
      await this.notifications.push({
        coreUserId: target,
        kind: 'FOLLOW',
        refId: user.coreUserId,
        actorCoreUserId: user.coreUserId,
      });
    }

    return this.relationWith(user, target);
  }

  async unfollow(user: CoreHubUser, target: string): Promise<RelationDto> {
    await this.prisma.follow.deleteMany({
      where: { followerCoreUserId: user.coreUserId, followingCoreUserId: target },
    });

    return this.relationWith(user, target);
  }

  async relationWith(
    user: CoreHubUser,
    target: string,
  ): Promise<RelationDto> {
    if (target === user.coreUserId) {
      return { following: false, followedBy: false, mutual: false, blockedByMe: false };
    }

    const edges = await this.prisma.follow.findMany({
      where: {
        OR: [
          { followerCoreUserId: user.coreUserId, followingCoreUserId: target },
          { followerCoreUserId: target, followingCoreUserId: user.coreUserId },
        ],
      },
      select: { followerCoreUserId: true },
    });

    const following = edges.some((e) => e.followerCoreUserId === user.coreUserId);
    const followedBy = edges.some((e) => e.followerCoreUserId === target);

    return {
      following,
      followedBy: followedBy,
      mutual: following && followedBy,
      blockedByMe: await this.blocks.blockedByMe(user.coreUserId, target),
    };
  }

  async stats(coreUserId: string): Promise<FollowStatsDto> {
    const [followerCount, followingCount] = await Promise.all([
      this.prisma.follow.count({ where: { followingCoreUserId: coreUserId } }),
      this.prisma.follow.count({ where: { followerCoreUserId: coreUserId } }),
    ]);

    return {
      followerCount: followerCount,
      followingCount: followingCount,
    };
  }

  async followers(
    coreUserId: string,
    query: PaginationQuery,
  ): Promise<Paginated<FollowEdgeDto>> {
    const where = { followingCoreUserId: coreUserId };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.follow.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        coreUserId: row.followerCoreUserId,
        createdAt: row.createdAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  async following(
    coreUserId: string,
    query: PaginationQuery,
  ): Promise<Paginated<FollowEdgeDto>> {
    const where = { followerCoreUserId: coreUserId };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.follow.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        coreUserId: row.followingCoreUserId,
        createdAt: row.createdAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  /// รายชื่อคนที่ผู้ใช้ติดตาม ใช้เป็นตัวกรองของฟีด
  ///
  /// รวมตัวเองเข้าไปด้วยเสมอ เพราะฟีดที่ไม่มีโพสต์ของตัวเองเลยดูเหมือนระบบพัง
  /// (ทั้ง Facebook และ Instagram ก็ทำแบบนี้)
  async followingCoreUserIds(user: CoreHubUser): Promise<string[]> {
    // มีเพดาน เพราะรายชื่อนี้ถูกยัดลง `IN (...)` ของฟีดสามชุด
    //
    // บัญชีที่ติดตามกลับทั้งรุ่น (หลักพัน) จะสร้าง IN ที่มีสมาชิกหลักพันตัว
    // ต่อการโหลดฟีดหนึ่งครั้ง ซึ่งทั้งช้าและกินหน่วยความจำของฐานข้อมูล
    //
    // เอาคนที่ติดตามล่าสุดก่อน เพราะฟีดที่คนสนใจจริงมักเป็นคนกลุ่มนั้น
    const rows = await this.prisma.follow.findMany({
      where: { followerCoreUserId: user.coreUserId },
      select: { followingCoreUserId: true },
      orderBy: { createdAt: 'desc' },
      take: FEED_AUTHOR_LIMIT,
    });

    return [
      ...new Set([user.coreUserId, ...rows.map((r) => r.followingCoreUserId)]),
    ];
  }

  /// คนที่ผู้เรียกมองไม่เห็น (บล็อกกันทิศไหนก็ได้) — ใช้กรองฟีดทุกชนิด
  hiddenFor(user: CoreHubUser): Promise<string[]> {
    return this.blocks.hiddenFor(user.coreUserId);
  }

  /// คนที่ควรแนะนำให้ติดตาม — หน้า "คนที่น่าติดตาม" แบบ Instagram (แบ่งหน้า)
  ///
  /// เกณฑ์: คนที่ "คนที่เราติดตามอยู่" ติดตามอยู่ แต่เรายังไม่ได้ติดตาม เรียงตามจำนวน
  /// คนกลางมากไปน้อย · ตัดคนที่บล็อกกัน (ทิศไหนก็ได้) และคนที่ปิด showInSuggestions
  /// ถ้าไม่พบเลย (ผู้ใช้ใหม่ที่ยังไม่ติดตามใคร) จะไม่ตกไปหาอันดับยอดนิยม
  /// เพราะการเดาแบบนั้นทำให้ทุกคนเห็นรายชื่อเดียวกันหมด
  ///
  /// สามคิวรีต่อหน้า: รายการ · ยอดรวม · "ติดตามโดย" ของทั้งหน้า
  async suggestions(
    user: CoreHubUser,
    query: PaginationQuery,
  ): Promise<Paginated<SuggestionDto>> {
    const me = user.coreUserId;
    const candidates = Prisma.sql`
      SELECT f2.following_core_user_id AS core_user_id, count(*) AS mutual
      FROM follows f1
      JOIN follows f2 ON f2.follower_core_user_id = f1.following_core_user_id
      WHERE f1.follower_core_user_id = ${me}
        AND f2.following_core_user_id <> ${me}
        AND NOT EXISTS (
          SELECT 1 FROM follows mine
          WHERE mine.follower_core_user_id = ${me}
            AND mine.following_core_user_id = f2.following_core_user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_core_user_id = ${me} AND b.blocked_core_user_id = f2.following_core_user_id)
             OR (b.blocked_core_user_id = ${me} AND b.blocker_core_user_id = f2.following_core_user_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM subsystem_members sm
          WHERE sm.core_user_id = f2.following_core_user_id
            AND sm.show_in_suggestions = false
        )
      GROUP BY f2.following_core_user_id
    `;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<{ core_user_id: string; mutual: bigint }[]>`
        SELECT * FROM (${candidates}) c
        ORDER BY c.mutual DESC, c.core_user_id ASC
        OFFSET ${query.skip}
        LIMIT ${query.take}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM (${candidates}) c
      `,
    ]);

    const ids = rows.map((row) => row.core_user_id);

    // "ติดตามโดย A, B และอีก n คน" — คนที่ฉันติดตามซึ่งติดตามเขาอยู่ สามคนล่าสุด
    const via = ids.length
      ? await this.prisma.$queryRaw<{ target: string; via: string }[]>`
          SELECT f2.following_core_user_id AS target, f2.follower_core_user_id AS via
          FROM follows f1
          JOIN follows f2 ON f2.follower_core_user_id = f1.following_core_user_id
          WHERE f1.follower_core_user_id = ${me}
            AND f2.following_core_user_id = ANY(${ids}::text[])
          ORDER BY f2.created_at DESC
        `
      : [];

    const viaBy = new Map<string, string[]>();

    for (const row of via) {
      const list = viaBy.get(row.target) ?? [];

      if (list.length < 3) list.push(row.via);
      viaBy.set(row.target, list);
    }

    return new Paginated(
      rows.map((row) => ({
        coreUserId: row.core_user_id,
        followedBy: viaBy.get(row.core_user_id) ?? [],
        followedByCount: Number(row.mutual),
        mutualCount: Number(row.mutual),
      })),
      query.meta(Number(counted[0]?.total ?? 0)),
    );
  }
}
