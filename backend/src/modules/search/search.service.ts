import { Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { BlocksService } from '../blocks/blocks.service.js';
import {
  PREVIEW_PER_KIND,
  SearchAllResponseDto,
  SearchHitDto,
  SearchQuery,
} from './dto/search.dto.js';

const SNIPPET_LENGTH = 160;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  /// ค้นทุกหมวดพร้อมกัน — คืนตัวอย่างไม่กี่รายการต่อหมวด พร้อมยอดรวมของแต่ละหมวด
  ///
  /// ไม่แบ่งหน้าในโหมดนี้โดยตั้งใจ: การเรียงผลจากสี่ตารางที่คนละหน่วยวัด
  /// ให้เป็นลำดับเดียวต้องมีคะแนนความเกี่ยวข้อง ซึ่งเราไม่มี การแกล้งแบ่งหน้า
  /// จะได้หน้าที่สองที่ไม่มีความหมาย — ให้ผู้ใช้กดแท็บหมวดแล้วแบ่งหน้าในหมวดนั้น
  async searchAll(
    user: CoreHubUser,
    query: SearchQuery,
  ): Promise<SearchAllResponseDto> {
    const q = query.q.trim();
    // คนที่บล็อกกันกับผู้เรียก (ทิศไหนก็ได้) ไม่โผล่ในผลค้นหาทุกหมวด
    const hidden = await this.blocks.hiddenFor(user.coreUserId);

    const [reels, posts, people, messages, counts] = await Promise.all([
      this.reelHits(hidden, q, PREVIEW_PER_KIND, 0),
      this.postHits(hidden, q, PREVIEW_PER_KIND, 0),
      this.peopleHits(hidden, q, PREVIEW_PER_KIND, 0),
      this.messageHits(user, q, PREVIEW_PER_KIND, 0),
      this.counts(user, q, hidden),
    ]);

    return {
      query: q,
      counts,
      hits: [...reels, ...posts, ...people, ...messages],
    };
  }

  async searchOne(
    user: CoreHubUser,
    query: SearchQuery,
  ): Promise<Paginated<SearchHitDto>> {
    const q = query.q.trim();
    const kind = query.kind ?? 'all';
    const hidden = await this.blocks.hiddenFor(user.coreUserId);

    const [hits, total] = await Promise.all([
      kind === 'reels'
        ? this.reelHits(hidden, q, query.take, query.skip)
        : kind === 'posts'
          ? this.postHits(hidden, q, query.take, query.skip)
          : kind === 'people'
            ? this.peopleHits(hidden, q, query.take, query.skip)
            : this.messageHits(user, q, query.take, query.skip),
      this.countOne(user, q, kind, hidden),
    ]);

    return new Paginated(hits, query.meta(total));
  }

  private async counts(user: CoreHubUser, q: string, hidden: string[]) {
    const [reels, posts, people, messages] = await Promise.all([
      this.countOne(user, q, 'reels', hidden),
      this.countOne(user, q, 'posts', hidden),
      this.countOne(user, q, 'people', hidden),
      this.countOne(user, q, 'messages', hidden),
    ]);

    return { reels, posts, people, messages };
  }

  private async countOne(
    user: CoreHubUser,
    q: string,
    kind: string,
    hidden: string[],
  ): Promise<number> {
    if (kind === 'reels') {
      return this.prisma.reel.count({ where: this.reelWhere(q, hidden) });
    }

    if (kind === 'posts') {
      return this.prisma.post.count({ where: this.postWhere(q, hidden) });
    }

    if (kind === 'people') {
      return this.prisma.profileCache.count({ where: this.peopleWhere(q, hidden) });
    }

    return this.prisma.message.count({
      where: await this.messageWhere(user, q),
    });
  }

  private async reelHits(
    hidden: string[],
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.reel.findMany({
      where: this.reelWhere(q, hidden),
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      kind: 'REEL',
      id: row.id,
      title: row.title,
      snippet: snippet(row.caption, q),
      authorCoreUserId: row.authorCoreUserId,
      channelId: null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async postHits(
    hidden: string[],
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.post.findMany({
      where: this.postWhere(q, hidden),
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      kind: 'POST',
      id: row.id,
      title: row.title,
      snippet: snippet(row.content, q),
      authorCoreUserId: row.authorCoreUserId,
      channelId: null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /// ค้นคน — ค้นได้เฉพาะจากแคชชื่อที่ซิงก์มาจาก Core
  ///
  /// ข้อจำกัดที่ต้องรู้: คนที่ยังไม่เคยถูกซิงก์จะหาด้วยชื่อจริงไม่เจอ
  /// (หาด้วย coreUserId เจอ เพราะ coreUserId คือคีย์ของตารางแคช)
  /// ทางแก้จริงคือให้ Core มี endpoint ค้นคน แล้วเราเรียกต่อ — TODO(PL) กับ PM
  private async peopleHits(
    hidden: string[],
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.profileCache.findMany({
      where: this.peopleWhere(q, hidden),
      orderBy: { coreUserId: 'asc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      kind: 'PERSON',
      id: row.coreUserId,
      title: row.displayName,
      snippet: row.coreUserId,
      authorCoreUserId: row.coreUserId,
      channelId: null,
      createdAt: null,
    }));
  }

  private async messageHits(
    user: CoreHubUser,
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.message.findMany({
      where: await this.messageWhere(user, q),
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { channel: { select: { name: true, kind: true } } },
    });

    return rows.map((row) => ({
      kind: 'MESSAGE',
      id: row.id,
      title:
        row.channel.name ??
        (row.channel.kind === 'DM'
          ? 'แชทส่วนตัว'
          : row.channel.kind === 'GROUP_DM'
            ? 'แชทกลุ่ม'
            : 'ห้องแชท'),
      snippet: snippet(row.content, q),
      authorCoreUserId: row.authorCoreUserId,
      channelId: row.channelId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private reelWhere(q: string, hidden: string[]) {
    return {
      ...(hidden.length ? { authorCoreUserId: { notIn: hidden } } : {}),
      OR: [
        { title: { contains: q, mode: 'insensitive' as const } },
        { caption: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  private postWhere(q: string, hidden: string[]) {
    return {
      ...(hidden.length ? { authorCoreUserId: { notIn: hidden } } : {}),
      OR: [
        { title: { contains: q, mode: 'insensitive' as const } },
        { content: { contains: q, mode: 'insensitive' as const } },
        { courseTag: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  private peopleWhere(q: string, hidden: string[]) {
    return {
      ...(hidden.length ? { coreUserId: { notIn: hidden } } : {}),
      OR: [
        { displayName: { contains: q, mode: 'insensitive' as const } },
        { coreUserId: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  /// ค้นข้อความได้เฉพาะในห้องที่ตัวเองเป็นสมาชิก
  ///
  /// นี่เป็นเงื่อนไขที่ห้ามลืม: ถ้าค้นทั้งตาราง ช่องค้นหาจะกลายเป็นช่องอ่าน
  /// แชทส่วนตัวของคนอื่นทั้งระบบด้วยการเดาคำ ซึ่งร้ายแรงกว่าบั๊กใด ๆ ในระบบนี้
  private async messageWhere(user: CoreHubUser, q: string) {
    const memberships = await this.prisma.channelMember.findMany({
      where: { coreUserId: user.coreUserId },
      select: { channelId: true, clearedAt: true },
    });

    // ห้องที่ "ลบแชท" ไปแล้วค้นได้เฉพาะข้อความหลังจากนั้น — ไม่งั้นช่องค้นหา
    // จะกลายเป็นทางอ้อมให้ข้อความที่ผู้ใช้สั่งลบกลับมาโผล่
    const cleared = memberships.filter((m) => m.clearedAt);
    const open = memberships.filter((m) => !m.clearedAt);

    return {
      deletedAt: null,
      content: { contains: q, mode: 'insensitive' as const },
      OR: [
        { channelId: { in: open.map((m) => m.channelId) } },
        ...cleared.map((m) => ({
          channelId: m.channelId,
          createdAt: { gt: m.clearedAt! },
        })),
      ],
    };
  }
}

/// ตัดข้อความรอบ ๆ คำค้นให้พออ่านรู้บริบท ไม่ใช่ส่งเนื้อหา 8000 ตัวอักษรกลับไป
function snippet(text: string | null, q: string): string | null {
  if (!text) {
    return null;
  }

  const at = text.toLowerCase().indexOf(q.toLowerCase());

  if (at < 0) {
    return text.slice(0, SNIPPET_LENGTH);
  }

  const start = Math.max(0, at - 40);
  const cut = text.slice(start, start + SNIPPET_LENGTH);

  return (start > 0 ? '…' : '') + cut + (start + SNIPPET_LENGTH < text.length ? '…' : '');
}
