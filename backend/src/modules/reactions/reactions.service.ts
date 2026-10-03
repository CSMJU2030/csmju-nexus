import { Injectable, NotFoundException } from '@nestjs/common';
import { Paginated } from '../../common/http/envelope.js';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import type { ReactionTarget } from '../../generated/prisma/enums.js';
import { BlocksService } from '../blocks/blocks.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  ReactDto,
  ReactionSummaryDto,
  ReactionTargetQuery,
  ReactorDto,
  ReactorsQuery,
} from './dto/reaction.dto.js';

/// เจ้าของของเป้าหมาย ใช้ตัดสินว่าจะแจ้งเตือนใคร
interface TargetOwner {
  ownerCoreUserId: string;
  /// บริบทที่ใส่ลง payload ของแจ้งเตือน เพื่อให้หน้าบ้านพาไปหน้าที่ถูกต้องได้
  context: Record<string, unknown>;
  /// ห้องที่ต้องกระจายแถบรีแอ็กชันใหม่เข้าไป มีเฉพาะเป้าหมายที่เป็นข้อความ
  channelId?: string;
}

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly channels: ChannelsService,
    private readonly bus: RealtimeBus,
    private readonly blocks: BlocksService,
  ) {}

  /// ใครกดอิโมจินี้บนข้อความ (ทูลทิปของชิปรีแอ็กชัน) — คนกดก่อนอยู่ก่อน
  ///
  /// ต้องเป็นสมาชิกห้อง (404 ถ้าไม่ใช่ — ไม่ยืนยันว่าห้อง/ข้อความมีจริง) และไม่โชว์
  /// คนที่บล็อกกันกับผู้เรียก · ข้อความก่อน "ลบแชท" ของผู้เรียกถือว่าไม่มี
  async reactors(
    user: CoreHubUser,
    channelId: string,
    messageId: string,
    query: ReactorsQuery,
  ): Promise<Paginated<ReactorDto>> {
    const membership = await this.channels.requireMembership(user, channelId);

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        channelId,
        deletedAt: null,
        ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
      },
      select: { id: true },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    const hidden = await this.blocks.hiddenFor(user.coreUserId);
    const where = {
      targetKind: 'MESSAGE' as const,
      targetId: messageId,
      emoji: query.emoji,
      ...(hidden.length ? { coreUserId: { notIn: hidden } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reaction.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { coreUserId: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: { coreUserId: true, createdAt: true },
      }),
      this.prisma.reaction.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({ coreUserId: row.coreUserId, createdAt: row.createdAt.toISOString() })),
      query.meta(total),
    );
  }

  /// กดอิโมจิ — กดซ้ำอิโมจิเดิมไม่เพิ่มยอดและไม่แจ้งเตือนซ้ำ
  ///
  /// คนหนึ่งกดได้หลายอิโมจิบนของชิ้นเดียว (แบบ Discord/Teams) ไม่ใช่แบบ
  /// Facebook ที่เลือกได้อย่างเดียว เพราะกฎ unique อยู่ที่
  /// (target, user, emoji) ไม่ใช่ (target, user)
  async react(user: CoreHubUser, dto: ReactDto): Promise<ReactionSummaryDto> {
    const owner = await this.resolveTarget(user, dto.targetKind, dto.targetId);

    const result = await this.prisma.reaction.createMany({
      data: [
        {
          targetKind: dto.targetKind,
          targetId: dto.targetId,
          coreUserId: user.coreUserId,
          emoji: dto.emoji,
        },
      ],
      skipDuplicates: true,
    });

    // เจ้าของข้อความที่ปิดเสียงห้องไว้ไม่ถูกปลุกด้วยรีแอ็กชันในห้องนั้น
    // (โพสต์และคลิปไม่มีห้อง จึงไม่เกี่ยว)
    const muted = owner.channelId
      ? await this.channels.mutedAmong(owner.channelId, [owner.ownerCoreUserId])
      : new Set<string>();

    if (result.count > 0 && !muted.has(owner.ownerCoreUserId)) {
      await this.notifications.push({
        coreUserId: owner.ownerCoreUserId,
        kind: 'REACTION',
        refId: dto.targetId,
        actorCoreUserId: user.coreUserId,
        payload: {
          targetKind: dto.targetKind,
          emoji: dto.emoji,
          ...owner.context,
        },
      });
    }

    return this.publishSummary(user, dto, owner.channelId);
  }

  async unreact(
    user: CoreHubUser,
    dto: ReactDto,
  ): Promise<ReactionSummaryDto> {
    // ตรวจสิทธิ์ตอนถอนด้วย ไม่ใช่แค่ตอนกด — คนที่ถูกเชิญออกจากห้องแล้ว
    // ไม่ควรยังยิงคำสั่งเข้าห้องนั้นได้อีก
    const owner = await this.resolveTarget(user, dto.targetKind, dto.targetId);

    await this.prisma.reaction.deleteMany({
      where: {
        targetKind: dto.targetKind,
        targetId: dto.targetId,
        coreUserId: user.coreUserId,
        emoji: dto.emoji,
      },
    });

    return this.publishSummary(user, dto, owner.channelId);
  }

  /// คืนยอดล่าสุดให้คนกด และกระจายยอดชุดเดียวกันให้คนอื่นในห้องเห็นทันที
  ///
  /// แถบรีแอ็กชันที่ไม่อัปเดตสดคือจุดที่ผู้ใช้กดซ้ำเพราะคิดว่าไม่ติด
  private async publishSummary(
    user: CoreHubUser,
    dto: ReactDto,
    channelId?: string,
  ): Promise<ReactionSummaryDto> {
    const summary = await this.summaryFor(user, dto);

    if (channelId) {
      this.bus.pushToRoom({
        room: channelId,
        event: 'reaction:changed',
        // actorCoreUserId บอกว่าใครกด — reactedByMe ในชุดนี้เป็นมุมของคนกด
        // ผู้รับคนอื่นต้องเอาแค่ยอด ส่วนแท็บอื่นของคนกดเองเชื่อ reactedByMe ได้
        payload: { channelId: channelId, actorCoreUserId: user.coreUserId, ...summary },
      });
    }

    return summary;
  }

  async summaryFor(
    user: CoreHubUser,
    target: ReactionTargetQuery,
  ): Promise<ReactionSummaryDto> {
    const [summaries] = await this.summariesFor(
      user,
      target.targetKind,
      [target.targetId],
    );

    return (
      summaries ?? {
        targetKind: target.targetKind,
        targetId: target.targetId,
        totals: [],
        totalCount: 0,
      }
    );
  }

  /// นับรีแอ็กชันของหลายเป้าหมายในสองคิวรี
  ///
  /// ฟีดหนึ่งหน้ามี 20 โพสต์ ถ้าเรียก summaryFor ทีละอันจะได้ 40 คิวรี
  /// ต่อการโหลดฟีดหนึ่งครั้ง — นี่คือ N+1 ที่ทำให้ฟีดช้าแบบหาสาเหตุไม่เจอ
  /// เมธอดนี้จึงรับหลาย id พร้อมกันแล้วให้ groupBy ทำงานทีเดียว
  async summariesFor(
    user: CoreHubUser,
    targetKind: ReactionTarget,
    targetIds: string[],
  ): Promise<ReactionSummaryDto[]> {
    if (targetIds.length === 0) {
      return [];
    }

    // ข้อความแชทต้องกรองด้วยการเป็นสมาชิกห้องก่อนนับ
    //
    // ทางเขียน (resolveTarget) เช็คไว้แล้ว แต่ **ทางอ่านไม่เคยเช็คเลย** —
    // ใครก็ตามที่รู้หรือเดา message id ถูก ยิง
    // GET /reactions?targetKind=MESSAGE&targetId=... ได้ยอดอิโมจิของ
    // ห้องส่วนตัวที่ตัวเองไม่ได้อยู่ รวมถึงห้องที่เคยอยู่แล้วออกไปแล้วด้วย
    // และยังใช้ยืนยันได้ว่า id นั้นมีอยู่จริง
    //
    // ใช้คิวรีเดียวด้วย relation filter ไม่ใช่ไล่ถามทีละ id
    const visibleIds =
      targetKind === 'MESSAGE'
        ? await this.visibleMessageIds(user, targetIds)
        : targetIds;

    if (visibleIds.length === 0) {
      return [];
    }

    const [grouped, mine] = await Promise.all([
      this.prisma.reaction.groupBy({
        by: ['targetId', 'emoji'],
        where: { targetKind, targetId: { in: visibleIds } },
        _count: { coreUserId: true },
        _min: { createdAt: true },
      }),
      this.prisma.reaction.findMany({
        where: {
          targetKind,
          targetId: { in: visibleIds },
          coreUserId: user.coreUserId,
        },
        select: { targetId: true, emoji: true },
      }),
    ]);

    const minePerTarget = new Map<string, Set<string>>();

    for (const row of mine) {
      const set = minePerTarget.get(row.targetId) ?? new Set<string>();

      set.add(row.emoji);
      minePerTarget.set(row.targetId, set);
    }

    return visibleIds.map((targetId) => {
      const rows = grouped.filter((row) => row.targetId === targetId);
      const myEmoji = minePerTarget.get(targetId) ?? new Set<string>();

      // แชทเรียงตามอิโมจิที่ถูกกดก่อน (แบบ Discord) — ถ้าเรียงตามยอด ชิปจะกระโดด
      // สลับที่ทุกครั้งที่มีคนกด แล้วผู้ใช้กดพลาดชิป · โพสต์/คลิปยังเรียงตามยอด
      const firstUse = new Map(
        rows.map((row) => [row.emoji, row._min.createdAt?.getTime() ?? 0]),
      );
      const totals = rows
        .map((row) => ({
          emoji: row.emoji,
          count: row._count.coreUserId,
          reactedByMe: myEmoji.has(row.emoji),
        }))
        .sort((a, b) =>
          targetKind === 'MESSAGE'
            ? (firstUse.get(a.emoji)! - firstUse.get(b.emoji)!) || a.emoji.localeCompare(b.emoji)
            : b.count - a.count || a.emoji.localeCompare(b.emoji),
        );

      return {
        targetKind: targetKind,
        targetId: targetId,
        totals,
        totalCount: totals.reduce((sum, row) => sum + row.count, 0),
      };
    });
  }

  /// คัดเฉพาะ message id ที่ผู้เรียกมีสิทธิ์เห็น — คิวรีเดียวสำหรับทั้งชุด
  private async visibleMessageIds(
    user: CoreHubUser,
    ids: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        channel: { members: { some: { coreUserId: user.coreUserId } } },
      },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /// ตรวจว่าเป้าหมายมีจริงและหาเจ้าของ
  ///
  /// จำเป็นเพราะตาราง reactions ใช้ targetId แบบ polymorphic จึงไม่มี
  /// foreign key ให้ฐานข้อมูลช่วยตรวจ ถ้าไม่เช็คที่นี่ จะกดรีแอ็กชันใส่ id
  /// ที่ไม่มีอยู่จริงได้ แล้วตารางจะค่อย ๆ เต็มไปด้วยแถวขยะที่ไม่มีใครลบ
  private async resolveTarget(
    user: CoreHubUser,
    kind: ReactionTarget,
    id: string,
  ): Promise<TargetOwner> {
    if (kind === 'POST') {
      const post = await this.prisma.post.findUnique({
        where: { id },
        select: { authorCoreUserId: true, title: true },
      });

      // โพสต์ของคนที่บล็อกกัน "ไม่มีอยู่" สำหรับผู้เรียก
      if (!post || (await this.blocks.isBlockedEither(user.coreUserId, post.authorCoreUserId))) {
        throw new NotFoundException('ไม่พบโพสต์ที่จะกดรีแอ็กชัน');
      }

      return {
        ownerCoreUserId: post.authorCoreUserId,
        context: { preview: post.title },
      };
    }

    if (kind === 'REEL') {
      const reel = await this.prisma.reel.findUnique({
        where: { id },
        select: { authorCoreUserId: true, title: true },
      });

      if (!reel || (await this.blocks.isBlockedEither(user.coreUserId, reel.authorCoreUserId))) {
        throw new NotFoundException('ไม่พบคลิปที่จะกดรีแอ็กชัน');
      }

      return {
        ownerCoreUserId: reel.authorCoreUserId,
        context: { preview: reel.title },
      };
    }

    const message = await this.prisma.message.findFirst({
      where: { id, deletedAt: null },
      select: { authorCoreUserId: true, channelId: true, content: true },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความที่จะกดรีแอ็กชัน');
    }

    // สำคัญ: ต้องเป็นสมาชิกห้องก่อนจึงกดรีแอ็กชันได้
    //
    // ถ้าไม่เช็ค คนนอกที่เดา message id ถูกจะกดอิโมจิใส่ห้องส่วนตัวของคนอื่นได้
    // ซึ่งทั้งกวนคนในห้องและยืนยันให้คนนอกรู้ว่าข้อความ id นั้นมีอยู่จริง
    // requireMembership คืน 404 ไม่ใช่ 403 จึงไม่หลุดข้อมูลว่าห้องมีจริง
    await this.channels.requireMembership(user, message.channelId);
    // DM 1:1 กับคนที่บล็อกกัน = กดรีแอ็กชันไม่ได้ (แชทกลุ่มยังได้ตาม Instagram)
    await this.channels.assertNotBlockedDirect(user, message.channelId);

    return {
      ownerCoreUserId: message.authorCoreUserId,
      channelId: message.channelId,
      context: {
        channelId: message.channelId,
        preview: message.content?.slice(0, 80) ?? null,
      },
    };
  }
}
