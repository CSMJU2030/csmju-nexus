import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { CloseFriendDto } from './dto/close-friend.dto.js';

/// เพื่อนสนิท — รายชื่อส่วนตัวของเจ้าของ อีกฝ่ายไม่รู้ว่าอยู่ในรายชื่อ
///
/// ตอนนี้ใช้คุมกลุ่มผู้ชมของโน้ต (CLOSE_FRIENDS) · ไม่มี endpoint ให้ถามว่า
/// "ฉันอยู่ในรายชื่อของใครบ้าง" โดยตั้งใจ เหมือน Instagram
@Injectable()
export class CloseFriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  async list(user: CoreHubUser, query: PaginationQuery): Promise<Paginated<CloseFriendDto>> {
    const where = { ownerCoreUserId: user.coreUserId };

    const [rows, total] = await Promise.all([
      this.prisma.closeFriend.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { friendCoreUserId: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.closeFriend.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        coreUserId: row.friendCoreUserId,
        createdAt: row.createdAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  /// เพิ่ม — เพิ่มซ้ำไม่ผิด (คืนแถวเดิม)
  async add(user: CoreHubUser, friend: string): Promise<CloseFriendDto> {
    if (friend === user.coreUserId) {
      throw new BadRequestException('เพิ่มตัวเองเป็นเพื่อนสนิทไม่ได้');
    }

    if (await this.blocks.isBlockedEither(user.coreUserId, friend)) {
      throw new ForbiddenException('เพิ่มคนนี้เป็นเพื่อนสนิทไม่ได้');
    }

    const row = await this.prisma.closeFriend.upsert({
      where: {
        ownerCoreUserId_friendCoreUserId: {
          ownerCoreUserId: user.coreUserId,
          friendCoreUserId: friend,
        },
      },
      create: { ownerCoreUserId: user.coreUserId, friendCoreUserId: friend },
      update: {},
    });

    return { coreUserId: row.friendCoreUserId, createdAt: row.createdAt.toISOString() };
  }

  async remove(user: CoreHubUser, friend: string): Promise<void> {
    await this.prisma.closeFriend.deleteMany({
      where: { ownerCoreUserId: user.coreUserId, friendCoreUserId: friend },
    });
  }
}
