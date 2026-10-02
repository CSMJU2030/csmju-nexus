import { Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlocksService } from '../blocks/blocks.service.js';
import {
  AudienceCountsDto,
  PrivacyDto,
  UpdatePrivacyDto,
} from './dto/settings.dto.js';

/// ความเป็นส่วนตัวของบัญชี — เก็บบน subsystem_members (Local Data ของระบบย่อย)
///
/// ไม่มีแถว = ค่าเริ่มต้น (เปิดทุกอย่าง) จึงอ่านของคนที่ยังไม่เคยเข้าระบบย่อยได้
/// โดยไม่ต้องสร้างแถวให้เขา
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  async get(user: CoreHubUser): Promise<PrivacyDto> {
    const member = await this.prisma.subsystemMember.findUnique({
      where: { coreUserId: user.coreUserId },
      select: { commentsFrom: true, showActivityStatus: true, showInSuggestions: true },
    });

    return {
      commentsFrom: member?.commentsFrom ?? 'EVERYONE',
      showActivityStatus: member?.showActivityStatus ?? true,
      showInSuggestions: member?.showInSuggestions ?? true,
    };
  }

  async update(user: CoreHubUser, dto: UpdatePrivacyDto): Promise<PrivacyDto> {
    const data = {
      ...(dto.commentsFrom !== undefined ? { commentsFrom: dto.commentsFrom } : {}),
      ...(dto.showActivityStatus !== undefined
        ? { showActivityStatus: dto.showActivityStatus }
        : {}),
      ...(dto.showInSuggestions !== undefined
        ? { showInSuggestions: dto.showInSuggestions }
        : {}),
    };

    await this.prisma.subsystemMember.upsert({
      where: { coreUserId: user.coreUserId },
      update: data,
      create: { coreUserId: user.coreUserId, ...data },
    });

    return this.get(user);
  }

  /// จำนวนคนในแต่ละกลุ่มผู้ชม — หน้าเลือก "ใครคอมเมนต์ได้" ของ Instagram โชว์เลขนี้
  async audienceCounts(user: CoreHubUser): Promise<AudienceCountsDto> {
    const me = user.coreUserId;

    const [following, followers, mutual] = await Promise.all([
      this.prisma.follow.count({ where: { followerCoreUserId: me } }),
      this.prisma.follow.count({ where: { followingCoreUserId: me } }),
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total
        FROM follows a
        JOIN follows b
          ON b.follower_core_user_id = a.following_core_user_id
         AND b.following_core_user_id = a.follower_core_user_id
        WHERE a.follower_core_user_id = ${me}
      `,
    ]);

    return { following, followers, mutual: Number(mutual[0]?.total ?? 0) };
  }

  async canComment(viewer: string, owner: string): Promise<boolean> {
    return (await this.canCommentMany(viewer, [owner])).get(owner) ?? false;
  }

  /// ผู้เรียกคอมเมนต์ใต้ของของเจ้าของแต่ละคนได้ไหม — สามคิวรีต่อชุด ไม่ขึ้นกับจำนวน
  ///
  /// เจ้าของคอมเมนต์ของตัวเองได้เสมอ · บล็อกกัน (ทิศไหนก็ได้) = ไม่ได้เสมอ
  ///   EVERYONE  ทุกคน
  ///   FOLLOWING คนที่เจ้าของติดตาม
  ///   FOLLOWERS คนที่ติดตามเจ้าของ
  ///   MUTUAL    ติดตามกันทั้งสองทาง
  ///   OFF       ไม่มีใคร
  async canCommentMany(viewer: string, owners: string[]): Promise<Map<string, boolean>> {
    const unique = [...new Set(owners)];
    const others = unique.filter((owner) => owner !== viewer);
    const result = new Map<string, boolean>(unique.map((owner) => [owner, owner === viewer]));

    if (others.length === 0) {
      return result;
    }

    const [members, edges, blocked] = await Promise.all([
      this.prisma.subsystemMember.findMany({
        where: { coreUserId: { in: others } },
        select: { coreUserId: true, commentsFrom: true },
      }),
      this.prisma.follow.findMany({
        where: {
          OR: [
            { followerCoreUserId: viewer, followingCoreUserId: { in: others } },
            { followingCoreUserId: viewer, followerCoreUserId: { in: others } },
          ],
        },
        select: { followerCoreUserId: true, followingCoreUserId: true },
      }),
      this.blocks.blockedAmong(viewer, others),
    ]);

    const policy = new Map(members.map((m) => [m.coreUserId, m.commentsFrom]));
    const viewerFollows = new Set(
      edges.filter((e) => e.followerCoreUserId === viewer).map((e) => e.followingCoreUserId),
    );
    const ownerFollows = new Set(
      edges.filter((e) => e.followingCoreUserId === viewer).map((e) => e.followerCoreUserId),
    );

    for (const owner of others) {
      if (blocked.has(owner)) {
        result.set(owner, false);
        continue;
      }

      switch (policy.get(owner) ?? 'EVERYONE') {
        case 'EVERYONE':
          result.set(owner, true);
          break;
        case 'FOLLOWING':
          result.set(owner, ownerFollows.has(owner));
          break;
        case 'FOLLOWERS':
          result.set(owner, viewerFollows.has(owner));
          break;
        case 'MUTUAL':
          result.set(owner, ownerFollows.has(owner) && viewerFollows.has(owner));
          break;
        default:
          result.set(owner, false);
      }
    }

    return result;
  }
}
