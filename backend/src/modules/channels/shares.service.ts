import { Injectable, NotFoundException } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { CreateShareDto, DeliveryResultDto } from './dto/message.dto.js';
import { MessagesService } from './messages.service.js';

/// แชร์โพสต์ คลิป หรือสตอรี่เข้าแชท (ปุ่ม "แชร์" ของ Instagram) — หนึ่งข้อความต่อปลายทาง
///
/// แชร์ได้เฉพาะสิ่งที่ผู้แชร์เองมีสิทธิ์เห็น — ไม่งั้นปุ่มแชร์จะกลายเป็นทางอ้อม
/// ให้ดึงสตอรี่ของคนที่ไม่ได้ติดตามมาเปิดดู หรือส่งของคนที่บล็อกเราไปทั่ว
@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly messages: MessagesService,
  ) {}

  async share(user: CoreHubUser, dto: CreateShareDto): Promise<DeliveryResultDto> {
    await this.assertShareable(user, dto.targetKind, dto.targetId);

    const targets = await this.messages.resolveTargets(user, dto);

    return this.messages.deliver(user, targets, {
      content: dto.message?.trim() || null,
      embed: { kind: dto.targetKind, refId: dto.targetId },
    });
  }

  /// 404 ทั้ง "ไม่มีจริง" "เห็นไม่ได้" และ "บล็อกกัน" — แยกไม่ออกโดยตั้งใจ
  /// ไม่งั้นคนนอกใช้ status code ยืนยันได้ว่า id ที่เดามามีอยู่จริง
  private async assertShareable(
    user: CoreHubUser,
    kind: 'POST' | 'REEL' | 'STORY',
    id: string,
  ): Promise<void> {
    const me = user.coreUserId;
    const notFound = () =>
      new NotFoundException(
        kind === 'POST' ? 'ไม่พบโพสต์นี้' : kind === 'REEL' ? 'ไม่พบคลิปนี้' : 'ไม่พบสตอรี่นี้',
      );

    let author: string | null = null;

    if (kind === 'POST') {
      author =
        (await this.prisma.post.findUnique({ where: { id }, select: { authorCoreUserId: true } }))
          ?.authorCoreUserId ?? null;
    } else if (kind === 'REEL') {
      author =
        (await this.prisma.reel.findUnique({ where: { id }, select: { authorCoreUserId: true } }))
          ?.authorCoreUserId ?? null;
    } else {
      const story = await this.prisma.story.findUnique({
        where: { id },
        select: {
          authorCoreUserId: true,
          expiresAt: true,
          _count: { select: { highlightItems: true } },
        },
      });

      if (story) {
        const own = story.authorCoreUserId === me;
        const inHighlight = story._count.highlightItems > 0;
        const live = story.expiresAt.getTime() > Date.now();
        // สตอรี่ที่ยังไม่หมดอายุเห็นได้เฉพาะคนที่ติดตาม (กติกาเดียวกับแถวสตอรี่)
        // ส่วนที่อยู่ในไฮไลต์เจ้าของเปิดให้ทุกคนดูบนโปรไฟล์อยู่แล้ว
        const follows =
          live &&
          !own &&
          !inHighlight &&
          (await this.prisma.follow.count({
            where: { followerCoreUserId: me, followingCoreUserId: story.authorCoreUserId },
          })) > 0;

        if (own || inHighlight || follows) {
          author = story.authorCoreUserId;
        }
      }
    }

    if (!author || (await this.blocks.isBlockedEither(me, author))) {
      throw notFound();
    }
  }
}
