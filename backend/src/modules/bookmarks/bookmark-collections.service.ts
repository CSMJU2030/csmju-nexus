import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { BookmarkTarget } from '../../generated/prisma/enums.js';
import { BookmarksService } from './bookmarks.service.js';
import {
  BookmarkCollectionDto,
  CollectionItemRefDto,
  CreateBookmarkCollectionDto,
  RenameBookmarkCollectionDto,
} from './dto/bookmark-collection.dto.js';
import { BookmarkResponseDto, CreateBookmarkDto } from './dto/bookmark.dto.js';

/// คอลเลกชันของที่บันทึกไว้ — **เจ้าของเท่านั้นทุกทาง**
///
/// คอลเลกชันของคนอื่นตอบ 404 ไม่ใช่ 403 เพราะแค่รู้ว่ามี id นี้อยู่ก็บอกได้ว่า
/// อีกคนจัดของที่บันทึกไว้เป็นหมวดอะไร ซึ่งส่วนตัวพอ ๆ กับตัวรายการเอง
@Injectable()
export class BookmarkCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookmarks: BookmarksService,
  ) {}

  /// คอลเลกชันของฉัน ใหม่ไปเก่า — สามคิวรีต่อหน้า: คอลเลกชัน · นับ · ปก
  async list(
    user: CoreHubUser,
    query: PaginationQuery,
  ): Promise<Paginated<BookmarkCollectionDto>> {
    const where = { ownerCoreUserId: user.coreUserId };

    const [rows, total] = await Promise.all([
      this.prisma.bookmarkCollection.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.bookmarkCollection.count({ where }),
    ]);

    return new Paginated(await this.present(rows), query.meta(total));
  }

  async create(
    user: CoreHubUser,
    dto: CreateBookmarkCollectionDto,
  ): Promise<BookmarkCollectionDto> {
    const items = uniqueRefs(dto.items ?? []);

    await this.assertBookmarked(user, items);

    const created = await this.prisma.bookmarkCollection.create({
      data: {
        ownerCoreUserId: user.coreUserId,
        name: dto.name,
        items: {
          create: items.map((item) => ({
            targetKind: item.targetKind,
            targetId: item.targetId,
          })),
        },
      },
      include: { _count: { select: { items: true } } },
    });

    const [response] = await this.present([created]);

    return response;
  }

  async rename(
    user: CoreHubUser,
    id: string,
    dto: RenameBookmarkCollectionDto,
  ): Promise<BookmarkCollectionDto> {
    await this.requireOwned(user, id);

    const updated = await this.prisma.bookmarkCollection.update({
      where: { id },
      data: { name: dto.name },
      include: { _count: { select: { items: true } } },
    });

    const [response] = await this.present([updated]);

    return response;
  }

  /// ลบคอลเลกชัน — ของข้างในยังอยู่ใน "ที่บันทึกไว้" ตามเดิม (แบบ Instagram)
  async remove(user: CoreHubUser, id: string): Promise<void> {
    await this.requireOwned(user, id);
    await this.prisma.bookmarkCollection.delete({ where: { id } });
  }

  /// ของในคอลเลกชัน ล่าสุดที่ใส่ก่อน — รูปเดียวกับ GET /bookmarks ทุกช่อง
  async items(
    user: CoreHubUser,
    id: string,
    query: PaginationQuery,
  ): Promise<Paginated<BookmarkResponseDto>> {
    await this.requireOwned(user, id);

    const where = { collectionId: id };

    const [rows, total] = await Promise.all([
      this.prisma.bookmarkCollectionItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { targetId: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.bookmarkCollectionItem.count({ where }),
    ]);

    return new Paginated(await this.bookmarks.enrich(rows), query.meta(total));
  }

  /// ใส่ของเข้าคอลเลกชัน — ใส่ซ้ำไม่ถือว่าผิด (คืนแถวเดิม)
  async addItem(
    user: CoreHubUser,
    id: string,
    dto: CreateBookmarkDto,
  ): Promise<BookmarkResponseDto> {
    await this.requireOwned(user, id);
    await this.assertBookmarked(user, [dto]);

    const row = await this.prisma.bookmarkCollectionItem.upsert({
      where: {
        collectionId_targetKind_targetId: {
          collectionId: id,
          targetKind: dto.targetKind,
          targetId: dto.targetId,
        },
      },
      create: {
        collectionId: id,
        targetKind: dto.targetKind,
        targetId: dto.targetId,
      },
      update: {},
    });

    // updatedAt ของคอลเลกชันขยับด้วย — หน้าบ้านเรียง "ที่เพิ่งแก้" ได้
    await this.prisma.bookmarkCollection.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    const [enriched] = await this.bookmarks.enrich([row]);

    return enriched;
  }

  /// เอาออกจากคอลเลกชันอย่างเดียว — ยังบันทึกไว้เหมือนเดิม
  async removeItem(
    user: CoreHubUser,
    id: string,
    dto: CreateBookmarkDto,
  ): Promise<void> {
    await this.requireOwned(user, id);

    await this.prisma.bookmarkCollectionItem.deleteMany({
      where: {
        collectionId: id,
        targetKind: dto.targetKind,
        targetId: dto.targetId,
      },
    });
  }

  private async requireOwned(user: CoreHubUser, id: string): Promise<void> {
    const found = await this.prisma.bookmarkCollection.findFirst({
      where: { id, ownerCoreUserId: user.coreUserId },
      select: { id: true },
    });

    if (!found) {
      throw new NotFoundException('ไม่พบคอลเลกชันนี้');
    }
  }

  /// ของในคอลเลกชันต้องอยู่ใน "ที่บันทึกไว้" ของเจ้าของก่อน
  ///
  /// คอลเลกชันเป็นแค่ป้ายบนของที่บันทึกไว้ ไม่ใช่ที่เก็บชุดที่สอง — ถ้าปล่อยให้
  /// ใส่ของที่ไม่ได้บันทึก จะมีของที่โผล่ในคอลเลกชันแต่ไม่อยู่ในหน้า "บันทึกไว้"
  /// ซึ่งผู้ใช้จะหาทางเอาออกไม่เจอ · ตรวจทั้งชุดในคิวรีเดียว
  private async assertBookmarked(
    user: CoreHubUser,
    refs: { targetKind: BookmarkTarget; targetId: string }[],
  ): Promise<void> {
    if (refs.length === 0) {
      return;
    }

    const found = await this.prisma.bookmark.findMany({
      where: {
        coreUserId: user.coreUserId,
        OR: refs.map((ref) => ({
          targetKind: ref.targetKind,
          targetId: ref.targetId,
        })),
      },
      select: { targetKind: true, targetId: true },
    });

    const saved = new Set(found.map((row) => `${row.targetKind}:${row.targetId}`));
    const missing = refs.filter(
      (ref) => !saved.has(`${ref.targetKind}:${ref.targetId}`),
    );

    if (missing.length > 0) {
      throw new BadRequestException(
        `บันทึกไว้ก่อนแล้วค่อยใส่คอลเลกชัน — ยังไม่ได้บันทึก ${missing.length} รายการ ` +
          `(เช่น ${missing[0].targetKind} ${missing[0].targetId})`,
      );
    }
  }

  /// ปกของแต่ละคอลเลกชัน = ของชิ้นล่าสุดที่ใส่ — DISTINCT ON คิวรีเดียวทั้งหน้า
  private async present(
    rows: {
      id: string;
      name: string;
      createdAt: Date;
      updatedAt: Date;
      _count: { items: number };
    }[],
  ): Promise<BookmarkCollectionDto[]> {
    const ids = rows.map((row) => row.id);
    const covers = ids.length
      ? await this.prisma.$queryRaw<
          { collection_id: string; target_kind: BookmarkTarget; target_id: string }[]
        >`
          SELECT DISTINCT ON (i.collection_id)
            i.collection_id, i.target_kind, i.target_id
          FROM bookmark_collection_items i
          WHERE i.collection_id = ANY(${ids}::text[])
          ORDER BY i.collection_id, i.created_at DESC, i.target_id DESC
        `
      : [];

    const coverBy = new Map(covers.map((row) => [row.collection_id, row]));

    return rows.map((row) => {
      const cover = coverBy.get(row.id);

      return {
        id: row.id,
        name: row.name,
        itemCount: row._count.items,
        cover: cover
          ? { targetKind: cover.target_kind, targetId: cover.target_id }
          : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}

function uniqueRefs(refs: CollectionItemRefDto[]): CollectionItemRefDto[] {
  const seen = new Map<string, CollectionItemRefDto>();

  for (const ref of refs) {
    seen.set(`${ref.targetKind}:${ref.targetId}`, ref);
  }

  return [...seen.values()];
}
