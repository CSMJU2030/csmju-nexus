import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../common/storage/storage.provider.js';
import {
  CreateHighlightDto,
  HighlightDetailDto,
  HighlightSummaryDto,
  UpdateHighlightDto,
} from './dto/highlight.dto.js';
import { signStoryMedia } from './stories.service.js';

/// เพดานจำนวนไฮไลต์ที่แสดงบนโปรไฟล์หนึ่งครั้ง — แถววงกลมใต้คำแนะนำตัว
const PROFILE_HIGHLIGHT_LIMIT = 100;

type StoryWithAsset = {
  id: string;
  caption: string | null;
  createdAt: Date;
  expiresAt: Date;
  asset: { bucket: string; objectPath: string; fileName: string; kind: string };
};

/// ไฮไลต์บนโปรไฟล์ — ใครก็ดูได้ (เหมือนโปรไฟล์) แต่แก้ได้เฉพาะเจ้าของ
///
/// **เห็นสตอรี่ที่หมดอายุแล้วได้ตรงนี้โดยตั้งใจ** — นั่นคือหน้าที่ของไฮไลต์
/// เจ้าของเลือกเองว่าจะเปิดสตอรี่ชิ้นไหนให้เห็นถาวร ต่างจากแถวสตอรี่ที่เห็นได้
/// เฉพาะคนที่ติดตามและเฉพาะ 24 ชั่วโมง
@Injectable()
export class HighlightsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async create(
    user: CoreHubUser,
    dto: CreateHighlightDto,
  ): Promise<HighlightDetailDto> {
    await this.assertOwnStories(user, dto.storyIds);
    this.assertCoverIncluded(dto.coverStoryId, dto.storyIds);

    const highlight = await this.prisma.highlight.create({
      data: {
        ownerCoreUserId: user.coreUserId,
        title: dto.title,
        coverStoryId: dto.coverStoryId ?? null,
        items: {
          create: dto.storyIds.map((storyId, position) => ({ storyId, position })),
        },
      },
      select: { id: true },
    });

    return this.detail(highlight.id);
  }

  /// ไฮไลต์ของคนหนึ่ง ใหม่ไปเก่า (อันที่เพิ่งสร้างอยู่ซ้ายสุดเหมือน Instagram)
  ///
  /// สามคิวรีเสมอไม่ขึ้นกับจำนวนไฮไลต์: ไฮไลต์พร้อมจำนวนชิ้น · ชิ้นแรกของแต่ละ
  /// ไฮไลต์ (DISTINCT ON) · สตอรี่หน้าปกพร้อมไฟล์
  async listForProfile(ownerCoreUserId: string): Promise<HighlightSummaryDto[]> {
    const highlights = await this.prisma.highlight.findMany({
      where: { ownerCoreUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PROFILE_HIGHLIGHT_LIMIT,
      include: { _count: { select: { items: true } } },
    });

    if (highlights.length === 0) {
      return [];
    }

    const firsts = await this.prisma.$queryRaw<
      { highlight_id: string; story_id: string }[]
    >`
      SELECT DISTINCT ON (hi.highlight_id) hi.highlight_id, hi.story_id
      FROM highlight_items hi
      WHERE hi.highlight_id = ANY(${highlights.map((h) => h.id)}::text[])
      ORDER BY hi.highlight_id, hi.position ASC
    `;

    const firstBy = new Map(firsts.map((row) => [row.highlight_id, row.story_id]));
    const coverIdOf = (h: (typeof highlights)[number]) =>
      h.coverStoryId ?? firstBy.get(h.id) ?? null;

    const coverIds = [
      ...new Set(highlights.map(coverIdOf).filter((id): id is string => id !== null)),
    ];

    const covers = new Map(
      (
        await this.prisma.story.findMany({
          where: { id: { in: coverIds } },
          include: { asset: true },
        })
      ).map((story) => [story.id, story]),
    );

    return Promise.all(
      highlights.map((h) => {
        const coverId = coverIdOf(h);

        return this.toSummary(h, h._count.items, coverId ? covers.get(coverId) : undefined);
      }),
    );
  }

  /// รายละเอียดไฮไลต์พร้อมทุกชิ้นตามลำดับ — ผู้ใช้ที่ล็อกอินทุกคนดูได้
  async detail(id: string): Promise<HighlightDetailDto> {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: { story: { include: { asset: true } } },
        },
      },
    });

    if (!highlight) {
      throw new NotFoundException('ไม่พบไฮไลต์นี้ อาจถูกลบไปแล้ว');
    }

    const coverId = highlight.coverStoryId ?? highlight.items[0]?.storyId ?? null;
    const cover = highlight.items.find((item) => item.storyId === coverId)?.story;

    const [summary, items] = await Promise.all([
      this.toSummary(highlight, highlight.items.length, cover),
      Promise.all(
        highlight.items.map(async (item) => ({
          storyId: item.storyId,
          position: item.position,
          mediaKind: item.story.asset.kind,
          mediaUrl: await signStoryMedia(this.storage, item.story.asset),
          caption: item.story.caption,
          createdAt: item.story.createdAt.toISOString(),
          expiresAt: item.story.expiresAt.toISOString(),
        })),
      ),
    ]);

    return { ...summary, items };
  }

  async update(
    user: CoreHubUser,
    id: string,
    dto: UpdateHighlightDto,
  ): Promise<HighlightDetailDto> {
    const highlight = await this.requireOwned(user, id);

    if (
      dto.title === undefined &&
      dto.storyIds === undefined &&
      dto.coverStoryId === undefined
    ) {
      throw new BadRequestException(
        'ไม่มีอะไรให้แก้ — ส่ง title, storyIds หรือ coverStoryId มาอย่างน้อยหนึ่งช่อง',
      );
    }

    if (dto.storyIds) {
      await this.assertOwnStories(user, dto.storyIds);
    }

    const finalIds =
      dto.storyIds ??
      (
        await this.prisma.highlightItem.findMany({
          where: { highlightId: id },
          select: { storyId: true },
        })
      ).map((row) => row.storyId);

    // หน้าปกต้องเป็นชิ้นที่อยู่ในไฮไลต์ — ถ้าชุดใหม่ไม่มีหน้าปกเดิมแล้ว ปกกลับไป
    // ใช้ชิ้นแรก แทนที่จะชี้ไปที่สตอรี่ที่ไม่ได้อยู่ในไฮไลต์นี้อีก
    let coverStoryId: string | null =
      dto.coverStoryId === undefined ? highlight.coverStoryId : dto.coverStoryId;

    if (dto.coverStoryId) {
      this.assertCoverIncluded(dto.coverStoryId, finalIds);
    } else if (coverStoryId && !finalIds.includes(coverStoryId)) {
      coverStoryId = null;
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.storyIds) {
        await tx.highlightItem.deleteMany({ where: { highlightId: id } });
        await tx.highlightItem.createMany({
          data: dto.storyIds.map((storyId, position) => ({
            highlightId: id,
            storyId,
            position,
          })),
        });
      }

      await tx.highlight.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          coverStoryId,
        },
      });
    });

    return this.detail(id);
  }

  async remove(user: CoreHubUser, id: string): Promise<void> {
    await this.requireOwned(user, id);
    // แถวในไฮไลต์หายตามด้วย CASCADE — ตัวสตอรี่ยังอยู่ในคลังของเจ้าของ
    await this.prisma.highlight.delete({ where: { id } });
  }

  /// 404 ถ้าไม่มี · 403 ถ้ามีแต่ไม่ใช่ของผู้เรียก
  ///
  /// ตอบ 403 ได้ (ไม่ต้องซ่อนเป็น 404) เพราะไฮไลต์เป็นของสาธารณะอยู่แล้ว —
  /// ใครก็เปิดดูได้ การบอกว่า "มีอยู่แต่ไม่ใช่ของคุณ" จึงไม่เปิดเผยอะไรเพิ่ม
  private async requireOwned(user: CoreHubUser, id: string) {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id },
      select: { id: true, ownerCoreUserId: true, coverStoryId: true },
    });

    if (!highlight) {
      throw new NotFoundException('ไม่พบไฮไลต์นี้');
    }

    if (highlight.ownerCoreUserId !== user.coreUserId) {
      throw new ForbiddenException('แก้หรือลบได้เฉพาะไฮไลต์ของตัวเอง');
    }

    return highlight;
  }

  /// ใส่ได้เฉพาะสตอรี่ของตัวเอง — ไม่งั้นเอาสตอรี่ของคนอื่นมาโชว์ถาวรบน
  /// โปรไฟล์ตัวเองได้ ทั้งที่เจ้าของตั้งใจให้เห็นแค่ 24 ชั่วโมง
  private async assertOwnStories(
    user: CoreHubUser,
    storyIds: string[],
  ): Promise<void> {
    const stories = await this.prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: { id: true, authorCoreUserId: true },
    });

    if (stories.length !== new Set(storyIds).size) {
      throw new NotFoundException('ไม่พบสตอรี่บางชิ้น อาจถูกลบไปแล้ว');
    }

    if (stories.some((story) => story.authorCoreUserId !== user.coreUserId)) {
      throw new ForbiddenException('ใส่ได้เฉพาะสตอรี่ของตัวเองในไฮไลต์');
    }
  }

  private assertCoverIncluded(
    coverStoryId: string | undefined,
    storyIds: string[],
  ): void {
    if (coverStoryId && !storyIds.includes(coverStoryId)) {
      throw new BadRequestException('หน้าปกต้องเป็นสตอรี่ที่อยู่ในไฮไลต์นี้');
    }
  }

  private async toSummary(
    highlight: {
      id: string;
      ownerCoreUserId: string;
      title: string;
      coverStoryId: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    itemCount: number,
    cover: StoryWithAsset | undefined,
  ): Promise<HighlightSummaryDto> {
    return {
      id: highlight.id,
      ownerCoreUserId: highlight.ownerCoreUserId,
      title: highlight.title,
      coverStoryId: highlight.coverStoryId,
      coverMediaUrl: cover ? await signStoryMedia(this.storage, cover.asset) : null,
      coverMediaKind: cover?.asset.kind ?? null,
      itemCount: itemCount,
      createdAt: highlight.createdAt.toISOString(),
      updatedAt: highlight.updatedAt.toISOString(),
    };
  }
}
