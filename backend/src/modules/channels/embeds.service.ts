import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../common/storage/storage.provider.js';
import { BlocksService } from '../blocks/blocks.service.js';
import type { MessageEmbedViewDto } from './dto/message.dto.js';

/// อายุ URL ภาพย่อในการ์ดที่แชร์ — เท่ากับสตอรี่ เพราะผู้ใช้เลื่อนแชทดูสักพัก
const THUMBNAIL_TTL_SECONDS = 300;

export type EmbedRef = { kind: string; refId: string };

const keyOf = (kind: string, refId: string) => `${kind}:${refId}`;

/// การ์ดของโพสต์/คลิป/สตอรี่ที่แชร์เข้าแชท — แปลงเป็นชุดต่อหนึ่งหน้าข้อความ
///
/// ต้องคำนวณตอนอ่าน ไม่ใช่เก็บ snapshot ตอนแชร์ เพราะ `available` เปลี่ยนได้
/// หลังจากส่งไปแล้ว: เจ้าของลบโพสต์ · สตอรี่หมดอายุ · คนดูถูกบล็อก — การ์ดที่ยัง
/// โชว์ภาพของที่ถูกลบไปแล้วคือการหลุดของเนื้อหาที่เจ้าของตั้งใจเอาออก
///
/// คิวรีคงที่ต่อหนึ่งหน้า: โพสต์ชุดหนึ่ง คลิปชุดหนึ่ง สตอรี่ชุดหนึ่ง การบล็อกชุดหนึ่ง
@Injectable()
export class EmbedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async resolve(
    viewerCoreUserId: string,
    refs: EmbedRef[],
  ): Promise<Map<string, MessageEmbedViewDto>> {
    const idsOf = (kind: string) => [
      ...new Set(refs.filter((r) => r.kind === kind).map((r) => r.refId)),
    ];
    const postIds = idsOf('POST');
    const reelIds = idsOf('REEL');
    const storyIds = idsOf('STORY');

    const [posts, reels, stories] = await Promise.all([
      postIds.length
        ? this.prisma.post.findMany({
            where: { id: { in: postIds } },
            include: {
              media: { orderBy: { position: 'asc' }, take: 1, include: { asset: true } },
            },
          })
        : Promise.resolve([]),
      reelIds.length
        ? this.prisma.reel.findMany({
            where: { id: { in: reelIds } },
            include: { asset: true },
          })
        : Promise.resolve([]),
      storyIds.length
        ? this.prisma.story.findMany({
            where: { id: { in: storyIds } },
            include: { asset: true, _count: { select: { highlightItems: true } } },
          })
        : Promise.resolve([]),
    ]);

    const authors = [
      ...posts.map((p) => p.authorCoreUserId),
      ...reels.map((r) => r.authorCoreUserId),
      ...stories.map((s) => s.authorCoreUserId),
    ];
    const blocked = await this.blocks.blockedAmong(viewerCoreUserId, authors);
    const now = Date.now();
    const out = new Map<string, MessageEmbedViewDto>();

    const put = async (
      kind: 'POST' | 'REEL' | 'STORY',
      id: string,
      author: string,
      available: boolean,
      view: {
        title: string | null;
        preview: string | null;
        asset: { bucket: string; objectPath: string; fileName: string; kind: string } | null;
      },
    ) => {
      const visible = available && !blocked.has(author);
      const thumbKind =
        view.asset && (view.asset.kind === 'IMAGE' || view.asset.kind === 'VIDEO')
          ? (view.asset.kind as 'IMAGE' | 'VIDEO')
          : null;

      out.set(keyOf(kind, id), {
        kind,
        targetId: id,
        refId: id,
        authorCoreUserId: author,
        title: visible ? view.title : null,
        preview: visible ? view.preview : null,
        thumbnailUrl: visible && view.asset && thumbKind ? await this.sign(view.asset) : null,
        thumbnailKind: visible ? thumbKind : null,
        available: visible,
      });
    };

    await Promise.all([
      ...posts.map((p) =>
        put('POST', p.id, p.authorCoreUserId, true, {
          title: p.title || null,
          preview: p.content ? p.content.slice(0, 120) : null,
          asset: p.media[0]?.asset ?? null,
        }),
      ),
      ...reels.map((r) =>
        put('REEL', r.id, r.authorCoreUserId, true, {
          title: r.title || null,
          preview: r.caption?.slice(0, 120) ?? null,
          asset: r.asset,
        }),
      ),
      ...stories.map((s) =>
        put(
          'STORY',
          s.id,
          s.authorCoreUserId,
          // หมดอายุแล้วแต่ยังอยู่ในไฮไลต์ = เจ้าของเลือกเปิดให้เห็นถาวร จึงยังดูได้
          s.expiresAt.getTime() > now || s._count.highlightItems > 0,
          { title: null, preview: s.caption?.slice(0, 120) ?? null, asset: s.asset },
        ),
      ),
    ]);

    // ของที่ถูกลบไปแล้ว — ยังคืนการ์ด (available: false) ให้หน้าบ้านเขียนว่า
    // "โพสต์นี้ไม่พร้อมใช้งาน" แทนที่ข้อความจะหายไปทั้งก้อน
    for (const ref of refs) {
      const key = keyOf(ref.kind, ref.refId);

      if (!out.has(key)) {
        out.set(key, {
          kind: ref.kind as 'POST' | 'REEL' | 'STORY',
          targetId: ref.refId,
          refId: ref.refId,
          authorCoreUserId: null,
          title: null,
          preview: null,
          thumbnailUrl: null,
          thumbnailKind: null,
          available: false,
        });
      }
    }

    return out;
  }

  static key(kind: string, refId: string): string {
    return keyOf(kind, refId);
  }

  private async sign(asset: {
    bucket: string;
    objectPath: string;
    fileName: string;
  }): Promise<string | null> {
    try {
      const signed = await this.storage.createDownloadUrl(asset.bucket, asset.objectPath, {
        ttlSeconds: THUMBNAIL_TTL_SECONDS,
        fileName: asset.fileName,
        asAttachment: false,
      });

      return signed.url;
    } catch {
      return null;
    }
  }
}
