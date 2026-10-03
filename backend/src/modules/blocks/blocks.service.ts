import { BadRequestException, Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlockDto } from './dto/block.dto.js';

/// เพดานรายชื่อที่เอาไปกรองฟีด/ค้นหา — คนทั่วไปบล็อกไม่ถึงหลักร้อย
const HIDDEN_LIMIT = 1000;

/// การบล็อกแบบ Instagram — **ผลบังคับทั้งสองทาง**
///
/// ตารางเก็บทิศทาง (ใครบล็อกใคร) เพราะต้องรู้ว่าใครปลดได้ และโปรไฟล์ตอบ 404
/// เฉพาะกับคนที่ถูกบล็อก แต่การซ่อนจากกัน (ฟีด ค้นหา แชท 1:1 คอมเมนต์ ตอบสตอรี่
/// ติดตาม โน้ต) ทำทั้งสองฝั่ง — ถ้าทำฝั่งเดียว คนที่ถูกบล็อกยังทักมาได้เรื่อย ๆ
///
/// เป็น @Global (ดู BlocksModule) เพราะแทบทุกโมดูลต้องถามคำถามนี้ ถ้าต้อง
/// import ทีละโมดูลจะเกิดวงจร import ระหว่าง follows/channels/stories
@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /// บล็อก = ตัดการติดตามทั้งสองทาง + ถอดจากเพื่อนสนิททั้งสองทาง ในทรานแซกชันเดียว
  ///
  /// ไม่ลบห้อง DM เดิม (ประวัติยังเป็นของทั้งคู่) แต่ส่งข้อความเพิ่มไม่ได้แล้ว
  async block(user: CoreHubUser, target: string): Promise<BlockDto> {
    if (target === user.coreUserId) {
      throw new BadRequestException('บล็อกตัวเองไม่ได้');
    }

    const me = user.coreUserId;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.block.upsert({
        where: {
          blockerCoreUserId_blockedCoreUserId: {
            blockerCoreUserId: me,
            blockedCoreUserId: target,
          },
        },
        create: { blockerCoreUserId: me, blockedCoreUserId: target },
        update: {},
      });

      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerCoreUserId: me, followingCoreUserId: target },
            { followerCoreUserId: target, followingCoreUserId: me },
          ],
        },
      });

      await tx.closeFriend.deleteMany({
        where: {
          OR: [
            { ownerCoreUserId: me, friendCoreUserId: target },
            { ownerCoreUserId: target, friendCoreUserId: me },
          ],
        },
      });

      return created;
    });

    return { coreUserId: row.blockedCoreUserId, createdAt: row.createdAt.toISOString() };
  }

  async unblock(user: CoreHubUser, target: string): Promise<void> {
    // ปลดได้เฉพาะที่ตัวเองบล็อกไว้ — ถ้าอีกฝ่ายบล็อกเรา เราปลดแทนไม่ได้
    await this.prisma.block.deleteMany({
      where: { blockerCoreUserId: user.coreUserId, blockedCoreUserId: target },
    });
  }

  async listMine(
    user: CoreHubUser,
    query: PaginationQuery,
  ): Promise<Paginated<BlockDto>> {
    const where = { blockerCoreUserId: user.coreUserId };

    const [rows, total] = await Promise.all([
      this.prisma.block.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { blockedCoreUserId: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.block.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        coreUserId: row.blockedCoreUserId,
        createdAt: row.createdAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  /// สองคนนี้บล็อกกันอยู่ไหม (ทิศทางไหนก็ได้)
  async isBlockedEither(a: string, b: string): Promise<boolean> {
    if (a === b) return false;

    const row = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerCoreUserId: a, blockedCoreUserId: b },
          { blockerCoreUserId: b, blockedCoreUserId: a },
        ],
      },
      select: { blockerCoreUserId: true },
    });

    return row !== null;
  }

  /// ผู้เรียกบล็อกคนนี้ไว้ไหม (ทิศทางเดียว) — ใช้ทำ relation.blockedByMe
  async blockedByMe(me: string, target: string): Promise<boolean> {
    const row = await this.prisma.block.findUnique({
      where: {
        blockerCoreUserId_blockedCoreUserId: {
          blockerCoreUserId: me,
          blockedCoreUserId: target,
        },
      },
      select: { blockerCoreUserId: true },
    });

    return row !== null;
  }

  /// คนที่มองไม่เห็นกันกับผู้เรียก (ทั้งสองทิศ) — ใช้กรองฟีด ค้นหา แถวสตอรี่ โน้ต
  async hiddenFor(me: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerCoreUserId: me }, { blockedCoreUserId: me }] },
      select: { blockerCoreUserId: true, blockedCoreUserId: true },
      take: HIDDEN_LIMIT,
    });

    return [
      ...new Set(
        rows.map((row) =>
          row.blockerCoreUserId === me ? row.blockedCoreUserId : row.blockerCoreUserId,
        ),
      ),
    ];
  }

  /// ในรายชื่อนี้ ใครบล็อกกันกับผู้เรียกบ้าง — คิวรีเดียวต่อชุด
  async blockedAmong(me: string, others: string[]): Promise<Set<string>> {
    const ids = [...new Set(others)].filter((id) => id !== me);

    if (ids.length === 0) return new Set();

    const rows = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerCoreUserId: me, blockedCoreUserId: { in: ids } },
          { blockedCoreUserId: me, blockerCoreUserId: { in: ids } },
        ],
      },
      select: { blockerCoreUserId: true, blockedCoreUserId: true },
    });

    return new Set(
      rows.map((row) =>
        row.blockerCoreUserId === me ? row.blockedCoreUserId : row.blockerCoreUserId,
      ),
    );
  }
}
