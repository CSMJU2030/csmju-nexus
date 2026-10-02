import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import { parseMentions } from '../../common/util/mentions.js';
import type { StoryReplyKind } from '../../generated/prisma/enums.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ChannelsService } from './channels.service.js';
import {
  DeliveryResultDto,
  EditMessageDto,
  ForwardMessageDto,
  ListMessagesQuery,
  MessageEmbedViewDto,
  MessageReplyToDto,
  MessageResponseDto,
  MessageTargetsDto,
  SendMessageDto,
} from './dto/message.dto.js';
import { EmbedsService } from './embeds.service.js';
import { callLogView, type CallLogRow } from './call-log.view.js';
import { isStaffLike } from '../../auth/role-mapping.js';

/// ข้อความที่ดึงมาพร้อมของแนบ — รูปแบบเดียวที่ใช้ทั้ง REST และ socket
export const MESSAGE_INCLUDE = {
  attachments: {
    select: {
      id: true,
      fileName: true,
      kind: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
  embed: { select: { kind: true, refId: true } },
  // กล่อง "ตอบกลับ" มากับข้อความในคิวรีเดียวกัน — ไม่ต้องยิงหาข้อความต้นทางทีละแถว
  replyTo: {
    select: {
      id: true,
      authorCoreUserId: true,
      content: true,
      deletedAt: true,
      attachments: { select: { kind: true }, take: 1 },
    },
  },
  callLog: true,
} as const;

/// เพดานปลายทางต่อการส่งต่อ/แชร์หนึ่งครั้ง — เท่ากับ Instagram
const MAX_DELIVERY_TARGETS = 20;

/// ข้อมูลของข้อความที่ระบบสร้างแทนผู้ใช้ (ส่งต่อ · แชร์ · ตอบสตอรี่)
export interface DeliveryDraft {
  content: string | null;
  embed?: { kind: 'POST' | 'REEL' | 'STORY'; refId: string } | null;
  forwarded?: boolean;
  storyReply?: { kind: StoryReplyKind; emoji: string | null } | null;
  /// ไฟล์ต้นฉบับที่ต้องทำสำเนาแถวไปแนบในข้อความใหม่ (ชี้ไฟล์เดิมในที่เก็บ)
  copyAssets?: {
    id: string;
    bucket: string;
    objectPath: string;
    fileName: string;
    mimeType: string;
    kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'CODE' | 'DOCUMENT' | 'ARCHIVE';
    sizeBytes: bigint;
    sourceAssetId: string | null;
  }[];
}

/// เพดานข้อความปักหมุดต่อห้อง
///
/// ปักหมุดที่ไม่มีเพดานจะกลายเป็นรายการที่ยาวกว่าตัวแชทเอง แล้วไม่มีใครอ่าน
/// ห้าสิบคือจุดที่ยังเลื่อนหาได้ในแผงข้าง
const MAX_PINS_PER_CHANNEL = 50;

/// แก้ข้อความได้ภายในเวลานี้หลังส่ง
///
/// ไม่ให้แก้ได้ตลอดกาล เพราะการแก้ข้อความเก่าที่คนอื่นตอบไปแล้วทำให้บทสนทนา
/// ที่บันทึกไว้เปลี่ยนความหมายย้อนหลัง ซึ่งเป็นปัญหาจริงเวลาต้องย้อนดูข้อตกลง
const EDIT_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly notifications: NotificationsService,
    private readonly bus: RealtimeBus,
    private readonly embeds: EmbedsService,
  ) {}

  /// แปลงแถวข้อความเป็น response — การ์ดที่แชร์ (embed) แปลงเป็นชุดเดียวต่อหน้า
  ///
  /// ต้องรู้ว่า "ใครดู" เพราะการ์ดของเจ้าของที่บล็อกกันกับผู้ดูต้องถูกปิด
  /// (available: false) — ข้อความเดียวกันจึงออกมาไม่เหมือนกันสำหรับสองคน
  async present(
    viewer: CoreHubUser,
    rows: MessageRow[],
  ): Promise<MessageResponseDto[]> {
    const refs = rows
      .filter((row) => row.embed)
      .map((row) => ({ kind: row.embed!.kind, refId: row.embed!.refId }));
    const views = refs.length
      ? await this.embeds.resolve(viewer.coreUserId, refs)
      : new Map<string, MessageEmbedViewDto>();

    return rows.map((row) =>
      toMessageResponse(
        row,
        row.embed ? (views.get(EmbedsService.key(row.embed.kind, row.embed.refId)) ?? null) : null,
      ),
    );
  }

  private async presentOne(
    viewer: CoreHubUser,
    row: MessageRow,
  ): Promise<MessageResponseDto> {
    const [response] = await this.present(viewer, [row]);

    return response;
  }

  async list(
    user: CoreHubUser,
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<Paginated<MessageResponseDto>> {
    const membership = await this.channels.requireMembership(user, channelId);

    const where = {
      channelId,
      deletedAt: null,
      ...clearedFilter(membership.clearedAt),
      // ไทม์ไลน์หลักไม่รวมข้อความในเธรด — ถ้ารวม บทสนทนาย่อยยาว 40 ข้อความ
      // จะกลบห้องหลักทั้งห้อง (นี่คือเหตุผลที่ Discord แยกเธรดออกมา)
      parentId: null,
      ...(query.afterSeq !== undefined
        ? { seq: { gt: query.afterSeq } }
        : {}),
    };

    // afterSeq ใช้ตอน socket หลุดแล้วต่อใหม่: เรียงจากเก่าไปใหม่เพื่อเติมช่วง
    // ที่ขาดตามลำดับ ส่วนการเปิดห้องปกติเรียงใหม่ไปเก่าเพื่อโหลดหน้าล่าสุดก่อน
    const ascending = query.afterSeq !== undefined;

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { seq: ascending ? 'asc' : 'desc' },
        skip: query.skip,
        take: query.take,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where }),
    ]);

    return new Paginated(await this.present(user, rows), query.meta(total));
  }

  /// ข้อความในเธรดหนึ่งเส้น เรียงจากเก่าไปใหม่
  async listThread(
    user: CoreHubUser,
    channelId: string,
    parentId: string,
    query: PaginationQuery,
  ): Promise<Paginated<MessageResponseDto>> {
    const membership = await this.channels.requireMembership(user, channelId);

    const parent = await this.prisma.message.findFirst({
      where: { id: parentId, channelId, ...clearedFilter(membership.clearedAt) },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException('ไม่พบข้อความต้นเธรดนี้');
    }

    const where = {
      parentId,
      deletedAt: null,
      ...clearedFilter(membership.clearedAt),
    };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { seq: 'asc' }, // การถามตอบอ่านจากเก่าไปใหม่จึงเข้าใจง่ายกว่า
        skip: query.skip,
        take: query.take,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where }),
    ]);

    return new Paginated(await this.present(user, rows), query.meta(total));
  }

  async listPinned(
    user: CoreHubUser,
    channelId: string,
    query: PaginationQuery,
  ): Promise<Paginated<MessageResponseDto>> {
    const membership = await this.channels.requireMembership(user, channelId);

    const where = {
      channelId,
      deletedAt: null,
      pinnedAt: { not: null },
      ...clearedFilter(membership.clearedAt),
    };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { pinnedAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where }),
    ]);

    return new Paginated(await this.present(user, rows), query.meta(total));
  }

  /// เขียนลงฐานข้อมูลให้เสร็จก่อน แล้วค่อยให้ชั้น socket เอาไป broadcast
  ///
  /// ลำดับนี้สำคัญ: ถ้า broadcast ก่อนแล้วเขียนพัง คนในห้องจะเห็นข้อความที่
  /// ไม่มีอยู่จริง และตอนรีเฟรชมันจะหายไป ซึ่งหาสาเหตุยากมาก
  async send(
    user: CoreHubUser,
    channelId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const membership = await this.channels.requireMembership(user, channelId);

    const hasContent = Boolean(dto.content?.trim());
    const hasAssets = Boolean(dto.assetIds?.length);
    const hasEmbed = Boolean(dto.embed);

    if (!hasContent && !hasAssets && !hasEmbed) {
      throw new BadRequestException(
        'ข้อความว่างเปล่า — ต้องมีข้อความ ไฟล์แนบ หรือคลิปที่แชร์อย่างน้อยหนึ่งอย่าง',
      );
    }

    // ส่งซ้ำด้วย nonce เดิม (เน็ตกระตุกแล้ว client ลองใหม่) ให้คืนข้อความเดิม
    // ไม่ใช่สร้างใหม่ — นี่คือเหตุผลที่มี unique(channelId, author, nonce)
    const duplicate = await this.prisma.message.findUnique({
      where: {
        channelId_authorCoreUserId_clientNonce: {
          channelId,
          authorCoreUserId: user.coreUserId,
          clientNonce: dto.clientNonce,
        },
      },
      include: MESSAGE_INCLUDE,
    });

    if (duplicate) {
      return this.presentOne(user, duplicate);
    }

    // DM 1:1 กับคนที่บล็อกกันส่งไม่ได้ (ทั้งสองทิศ) — แชทกลุ่มยังคุยกันได้ตาม Instagram
    await this.channels.assertNotBlockedDirect(user, channelId);

    if (hasAssets) {
      await this.assertOwnedReadyAssets(user, dto.assetIds!);
    }

    if (dto.embed) {
      await this.assertEmbedExists(dto.embed.kind, dto.embed.refId);
    }

    const parent = dto.parentId
      ? await this.resolveThreadParent(channelId, dto.parentId)
      : null;

    // ข้อความที่ "ตอบกลับ" ต้องอยู่ห้องเดียวกัน — ไม่งั้นอ้างข้อความจากห้อง
    // ที่ตัวเองเป็นสมาชิกมาโชว์ในห้องอื่นได้ ซึ่งเท่ากับยกเนื้อหาข้ามห้อง
    if (dto.replyToMessageId) {
      const quoted = await this.prisma.message.findFirst({
        where: {
          id: dto.replyToMessageId,
          channelId,
          ...clearedFilter(membership.clearedAt),
        },
        select: { id: true, callLog: { select: { messageId: true } } },
      });

      if (!quoted) {
        throw new NotFoundException('ไม่พบข้อความที่จะตอบกลับในห้องนี้');
      }

      if (quoted.callLog) {
        throw new BadRequestException('ตอบกลับบันทึกการโทรไม่ได้');
      }
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          channelId,
          authorCoreUserId: user.coreUserId,
          content: dto.content?.trim() || null,
          clientNonce: dto.clientNonce,
          parentId: parent?.id ?? null,
          replyToMessageId: dto.replyToMessageId ?? null,
          ...(dto.embed
            ? {
                embed: {
                  create: { kind: dto.embed.kind, refId: dto.embed.refId },
                },
              }
            : {}),
          ...(hasAssets
            ? { attachments: { connect: dto.assetIds!.map((id) => ({ id })) } }
            : {}),
        },
        include: MESSAGE_INCLUDE,
      });

      // นับจำนวนตอบกลับในทรานแซกชันเดียวกับการสร้าง ไม่งั้นตัวเลขจะเพี้ยน
      // ทันทีที่มีสองคนตอบเธรดเดียวกันพร้อมกัน
      if (parent) {
        await tx.message.update({
          where: { id: parent.id },
          data: { replyCount: { increment: 1 } },
        });
      }

      return created;
    });

    await this.notifyThreadReply(user, channelId, parent);
    await this.notifyMentions(user, channelId, message.id, dto.content, {
      isModerator: membership.role === 'MODERATOR',
    });

    return this.presentOne(user, message);
  }

  /// ส่งต่อข้อความไปห้องอื่น / คนอื่น (Instagram "ส่งต่อ")
  ///
  /// คัดลอกเนื้อหา การ์ด และไฟล์แนบ — ไฟล์แนบเป็น **แถว asset ใหม่ที่ชี้ไฟล์เดิม**
  /// ในที่เก็บ ไม่คัดลอกไบต์ และไม่นับโควตาของผู้ส่งต่อ (sourceAssetId) · ข้อความที่
  /// ส่งต่อมาแล้วส่งต่อซ้ำได้ แต่ชี้กลับไปที่ต้นฉบับแรกเสมอ
  async forward(
    user: CoreHubUser,
    channelId: string,
    messageId: string,
    dto: ForwardMessageDto,
  ): Promise<DeliveryResultDto> {
    const membership = await this.channels.requireMembership(user, channelId);

    const source = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        channelId,
        deletedAt: null,
        ...clearedFilter(membership.clearedAt),
      },
      include: {
        embed: true,
        callLog: { select: { messageId: true } },
        attachments: {
          where: { status: 'READY' },
          select: {
            id: true,
            bucket: true,
            objectPath: true,
            fileName: true,
            mimeType: true,
            kind: true,
            sizeBytes: true,
            sourceAssetId: true,
          },
        },
      },
    });

    if (!source) {
      throw new NotFoundException('ไม่พบข้อความที่จะส่งต่อ');
    }

    if (source.callLog) {
      throw new BadRequestException('ส่งต่อบันทึกการโทรไม่ได้');
    }

    if (!source.content && source.attachments.length === 0 && !source.embed) {
      throw new BadRequestException('ข้อความนี้ไม่มีอะไรให้ส่งต่อ');
    }

    const targets = await this.resolveTargets(user, dto);

    return this.deliver(user, targets, {
      content: source.content,
      embed: source.embed
        ? { kind: source.embed.kind, refId: source.embed.refId }
        : null,
      forwarded: true,
      copyAssets: source.attachments,
    });
  }

  /// แปลงปลายทาง (ห้อง + คน) เป็นรายการห้องที่ส่งได้จริง — ตรวจทุกอย่างก่อนส่งสักห้อง
  ///
  /// ตรวจครบก่อนเขียน เพราะถ้าเขียนไปห้าห้องแล้วห้องที่หกไม่ผ่าน ผู้ใช้จะเห็น
  /// error ทั้งที่ข้อความไปถึงห้าห้องแล้ว แล้วกดส่งซ้ำจนคนรับได้สองรอบ
  async resolveTargets(
    user: CoreHubUser,
    dto: MessageTargetsDto,
  ): Promise<string[]> {
    const channelIds = [...new Set(dto.channelIds ?? [])];
    const peers = [...new Set(dto.peerCoreUserIds ?? [])];

    if (channelIds.length + peers.length === 0) {
      throw new BadRequestException(['ระบุปลายทางอย่างน้อยหนึ่งห้องหรือหนึ่งคน']);
    }

    if (channelIds.length + peers.length > MAX_DELIVERY_TARGETS) {
      throw new BadRequestException([
        `ส่งได้ครั้งละไม่เกิน ${MAX_DELIVERY_TARGETS} ปลายทาง`,
      ]);
    }

    if (peers.includes(user.coreUserId)) {
      throw new BadRequestException('ส่งหาตัวเองไม่ได้ — เลือกห้องแทน');
    }

    await this.channels.assertMemberOfAll(user, channelIds);

    for (const channelId of channelIds) {
      await this.channels.assertNotBlockedDirect(user, channelId);
    }

    const direct: string[] = [];

    for (const peer of peers) {
      direct.push(await this.channels.ensureDirect(user, peer));
    }

    return [...new Set([...channelIds, ...direct])];
  }

  /// เขียนข้อความหนึ่งข้อความต่อห้อง แล้วกระจายเข้าห้องทันที
  ///
  /// ใช้ร่วมกันทั้งส่งต่อ แชร์ และตอบสตอรี่ — ทุกทางต้องได้ข้อความรูปเดียวกับ
  /// การพิมพ์ส่งปกติ (seq, nonce, การ์ด) ไม่งั้นหน้าบ้านต้องมีสองตัวแสดงผล
  async deliver(
    user: CoreHubUser,
    channelIds: string[],
    draft: DeliveryDraft,
  ): Promise<DeliveryResultDto> {
    const messageIds: string[] = [];

    for (const channelId of channelIds) {
      const message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            channelId,
            authorCoreUserId: user.coreUserId,
            content: draft.content,
            // nonce ของระบบ — ผู้ใช้ไม่ได้พิมพ์เอง จึงไม่มี nonce จาก client ให้กันซ้ำ
            clientNonce: `sys-${randomUUID()}`,
            forwarded: draft.forwarded ?? false,
            storyReplyKind: draft.storyReply?.kind ?? null,
            storyReplyEmoji: draft.storyReply?.emoji ?? null,
            ...(draft.embed
              ? { embed: { create: { kind: draft.embed.kind, refId: draft.embed.refId } } }
              : {}),
          },
          select: { id: true },
        });

        if (draft.copyAssets?.length) {
          await tx.asset.createMany({
            data: draft.copyAssets.map((asset) => ({
              ownerCoreUserId: user.coreUserId,
              bucket: asset.bucket,
              objectPath: asset.objectPath,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              kind: asset.kind,
              sizeBytes: asset.sizeBytes,
              status: 'READY' as const,
              messageId: created.id,
              sourceAssetId: asset.sourceAssetId ?? asset.id,
            })),
          });
        }

        return tx.message.findUniqueOrThrow({
          where: { id: created.id },
          include: MESSAGE_INCLUDE,
        });
      });

      const response = await this.presentOne(user, message);

      // เขียนเสร็จแล้วค่อยกระจาย — เหตุผลเดียวกับ send()
      this.bus.pushToRoom({ room: channelId, event: 'message:new', payload: response });
      messageIds.push(message.id);
    }

    return { channelIds: channelIds, messageIds: messageIds };
  }

  /// แก้ข้อความของตัวเองภายในหน้าต่างเวลาที่กำหนด
  ///
  /// ผู้ดูแลห้องแก้ข้อความคนอื่นไม่ได้โดยตั้งใจ — ลบได้ แต่แก้ไม่ได้
  /// เพราะการแก้คำพูดของคนอื่นแล้วยังแสดงชื่อเขาเป็นผู้เขียนคือการปลอมคำพูด
  async edit(
    user: CoreHubUser,
    channelId: string,
    messageId: string,
    dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    await this.channels.requireMembership(user, channelId);

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
      select: { authorCoreUserId: true, createdAt: true, callLog: { select: { messageId: true } } },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    if (message.callLog) {
      throw new BadRequestException('แก้ไขบันทึกการโทรไม่ได้');
    }

    if (message.authorCoreUserId !== user.coreUserId) {
      throw new ForbiddenException('แก้ได้เฉพาะข้อความของตัวเอง');
    }

    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException(
        'แก้ข้อความได้ภายใน 15 นาทีหลังส่ง — เกินกว่านั้นให้ส่งข้อความใหม่แทน',
      );
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { content: dto.content.trim(), editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    const response = await this.presentOne(user, updated);

    this.bus.pushToRoom({
      room: channelId,
      event: 'message:edited',
      payload: response,
    });

    return response;
  }

  /// ปักหมุด — ผู้ดูแลห้อง อาจารย์ หรือผู้ดูแลระดับองค์กรเท่านั้น
  ///
  /// ไม่เปิดให้เจ้าของข้อความปักหมุดของตัวเอง เพราะหมุดคือแผงประกาศของห้อง
  /// ถ้าใครก็ปักได้ มันจะกลายเป็นที่แย่งพื้นที่กันเอง
  async setPinned(
    user: CoreHubUser,
    channelId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<MessageResponseDto> {
    const membership = await this.channels.requireMembership(user, channelId);
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { kind: true },
    });

    // แชทส่วนตัวและแชทกลุ่ม (Direct) ทุกคนในแชทปักหมุดได้เหมือน Instagram
    // ส่วนห้องแบบ Discord ยังจำกัดที่ผู้ดูแลห้องและอาจารย์ กันหมุดรกห้องใหญ่
    const direct = channel?.kind === 'DM' || channel?.kind === 'GROUP_DM';
    const canPin =
      direct ||
      membership.role === 'MODERATOR' ||
      isStaffLike(user.coreRole);

    if (!canPin) {
      throw new ForbiddenException('ปักหมุดได้เฉพาะผู้ดูแลห้องและอาจารย์');
    }

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
      select: { id: true, pinnedAt: true, callLog: { select: { messageId: true } } },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    // บันทึกการโทรไม่ใช่ข้อความที่มีเนื้อหา — กติกาเดียวกับแก้ไข/ส่งต่อ/ตอบกลับ
    if (pinned && message.callLog) {
      throw new BadRequestException('ปักหมุดบันทึกการโทรไม่ได้');
    }

    if (pinned && !message.pinnedAt) {
      const current = await this.prisma.message.count({
        where: { channelId, pinnedAt: { not: null }, deletedAt: null },
      });

      if (current >= MAX_PINS_PER_CHANNEL) {
        throw new BadRequestException(
          `ห้องนี้ปักหมุดครบ ${MAX_PINS_PER_CHANNEL} ข้อความแล้ว — ถอนหมุดเก่าก่อน`,
        );
      }
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        pinnedAt: pinned ? new Date() : null,
        pinnedByCoreUserId: pinned ? user.coreUserId : null,
      },
      include: MESSAGE_INCLUDE,
    });

    const response = await this.presentOne(user, updated);

    this.bus.pushToRoom({
      room: channelId,
      event: 'message:pinned',
      payload: response,
    });

    return response;
  }

  async remove(
    user: CoreHubUser,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const membership = await this.channels.requireMembership(user, channelId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    const isAuthor = message.authorCoreUserId === user.coreUserId;
    const canModerate =
      membership.role === 'MODERATOR' || user.coreRole === 'admin';

    if (!isAuthor && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะข้อความของตัวเอง');
    }

    // ลบแบบทิ้งร่องรอย ไม่ลบแถวจริง เพื่อให้ Admin ตรวจย้อนหลังได้และเพื่อไม่ให้
    // ลำดับ seq ของห้องขาดหาย
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), content: null, pinnedAt: null },
      });

      // ข้อความที่ถูกลบไม่ควรนับเป็นคำตอบในเธรดต่อไป
      if (message.parentId) {
        await tx.message.update({
          where: { id: message.parentId },
          data: { replyCount: { decrement: 1 } },
        });
      }

      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'message.delete',
          targetKind: 'MESSAGE',
          targetId: messageId,
          metadata: {
            channel_id: channelId,
            author_core_user_id: message.authorCoreUserId,
            by_moderator: !isAuthor,
          },
        },
      });
    });
  }

  async latestSeq(channelId: string): Promise<number> {
    const latest = await this.prisma.message.findFirst({
      where: { channelId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    return latest?.seq ?? 0;
  }

  /// ต้นเธรดต้องอยู่ห้องเดียวกัน ยังไม่ถูกลบ และตัวมันเองต้องไม่ใช่คำตอบ
  ///
  /// ห้ามเธรดซ้อนเธรดโดยตั้งใจ (Discord และ Teams ก็ไม่ให้) เพราะโครงสร้าง
  /// ที่ลึกได้ไม่จำกัดทำให้ทั้ง UI และการนับยังไม่อ่านซับซ้อนขึ้นแบบไม่คุ้ม
  private async resolveThreadParent(channelId: string, parentId: string) {
    const parent = await this.prisma.message.findFirst({
      where: { id: parentId, channelId, deletedAt: null },
      select: { id: true, parentId: true, authorCoreUserId: true },
    });

    if (!parent) {
      throw new NotFoundException('ไม่พบข้อความที่จะตอบกลับ');
    }

    if (parent.parentId) {
      throw new BadRequestException(
        'ตอบกลับในเธรดซ้อนเธรดไม่ได้ — ตอบที่ข้อความต้นเธรดแทน',
      );
    }

    return parent;
  }

  private async notifyThreadReply(
    user: CoreHubUser,
    channelId: string,
    parent: { id: string; authorCoreUserId: string } | null,
  ): Promise<void> {
    if (!parent) {
      return;
    }

    // ปิดเสียงห้องแล้ว = ไม่อยากถูกปลุกด้วยเรื่องในห้องนี้ รวมถึงคนตอบเธรดของตัวเอง
    const muted = await this.channels.mutedAmong(channelId, [
      parent.authorCoreUserId,
    ]);

    if (muted.has(parent.authorCoreUserId)) {
      return;
    }

    await this.notifications.push({
      coreUserId: parent.authorCoreUserId,
      kind: 'THREAD_REPLY',
      refId: parent.id,
      actorCoreUserId: user.coreUserId,
      payload: { channelId: channelId },
    });
  }

  /// แจ้งเตือนคนที่ถูก @ ในข้อความ
  ///
  /// สองข้อจำกัดที่จำเป็น:
  ///   1. แจ้งได้เฉพาะคนที่เป็นสมาชิกห้องนั้นอยู่แล้ว — ไม่ใช่ทุก coreUserId
  ///      ในระบบ ถ้าไม่กรอง จะ @ ใครก็ได้เพื่อส่งข้อความหาเขาผ่านช่องแจ้งเตือน
  ///      โดยที่เขาไม่ได้อยู่ในห้องและไม่มีทางบล็อก
  ///   2. @everyone สงวนให้ผู้ดูแลห้อง ไม่งั้นห้องเรียน 200 คนจะถูกปลุกได้
  ///      โดยนักศึกษาคนเดียว
  private async notifyMentions(
    user: CoreHubUser,
    channelId: string,
    messageId: string,
    content: string | undefined,
    options: { isModerator: boolean },
  ): Promise<void> {
    const parsed = parseMentions(content, user.coreUserId);

    if (parsed.coreUserIds.length === 0 && !parsed.broadcast) {
      return;
    }

    const members = await this.prisma.channelMember.findMany({
      where: { channelId },
      select: { coreUserId: true },
    });

    const memberNames = new Set(members.map((m) => m.coreUserId));

    const candidates =
      parsed.broadcast && options.isModerator
        ? members
            .map((m) => m.coreUserId)
            .filter((name) => name !== user.coreUserId)
        : parsed.coreUserIds.filter((name) => memberNames.has(name));

    // คนที่ปิดเสียงห้องนี้ไว้ไม่ได้รับแจ้งเตือน — รวมถึง @ ตรงตัวเขาเอง
    // (Instagram ก็ทำแบบนี้: ปิดเสียงแชทแล้วถูกกล่าวถึงก็ไม่เด้ง)
    // ข้อความยังนับเป็นยังไม่อ่านตามปกติ เขาจึงไม่พลาดอะไรเมื่อเปิดห้องเอง
    const muted = await this.channels.mutedAmong(channelId, candidates);
    const targets = candidates.filter((name) => !muted.has(name));

    if (targets.length === 0) {
      return;
    }

    await this.notifications.pushMany(targets, {
      kind: 'MENTION',
      refId: messageId,
      actorCoreUserId: user.coreUserId,
      payload: {
        channelId: channelId,
        preview: content?.slice(0, 120) ?? null,
        broadcast: parsed.broadcast && options.isModerator,
      },
    });
  }

  /// แนบได้เฉพาะไฟล์ของตัวเองที่ commit แล้ว และยังไม่ถูกแนบที่อื่น
  /// ถ้าไม่เช็ค จะเอา assetId ของคนอื่นมาแนบแล้วดูดไฟล์เขาออกมาได้
  private async assertOwnedReadyAssets(
    user: CoreHubUser,
    assetIds: string[],
  ): Promise<void> {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        ownerCoreUserId: true,
        status: true,
        messageId: true,
      },
    });

    if (assets.length !== assetIds.length) {
      throw new BadRequestException('มีไฟล์แนบบางรายการที่ไม่มีอยู่จริง');
    }

    for (const asset of assets) {
      if (asset.ownerCoreUserId !== user.coreUserId) {
        throw new ForbiddenException('แนบไฟล์ของคนอื่นไม่ได้');
      }

      if (asset.status !== 'READY') {
        throw new BadRequestException(
          'มีไฟล์ที่ยังอัปโหลดไม่เสร็จ — เรียก commit ให้สำเร็จก่อน',
        );
      }

      if (asset.messageId) {
        throw new BadRequestException(
          'ไฟล์นี้ถูกแนบในข้อความอื่นไปแล้ว อัปโหลดใหม่ถ้าต้องการส่งซ้ำ',
        );
      }
    }
  }

  private async assertEmbedExists(
    kind: 'REEL' | 'POST',
    refId: string,
  ): Promise<void> {
    const found =
      kind === 'REEL'
        ? await this.prisma.reel.findUnique({
            where: { id: refId },
            select: { id: true },
          })
        : await this.prisma.post.findUnique({
            where: { id: refId },
            select: { id: true },
          });

    if (!found) {
      throw new NotFoundException(
        kind === 'REEL' ? 'ไม่พบคลิปที่จะแชร์' : 'ไม่พบโพสต์ที่จะแชร์',
      );
    }
  }
}

/// "ลบแชท" ของผู้เรียก — ข้อความก่อนเวลานั้นไม่ถูกส่งให้เขาอีก (อีกฝ่ายไม่กระทบ)
///
/// ใส่ในทุกทางอ่าน (ไทม์ไลน์ เธรด ปักหมุด) ไม่ใช่แค่ไทม์ไลน์ ไม่งั้นข้อความที่
/// ผู้ใช้ลบไปแล้วจะโผล่กลับมาทางแผงปักหมุดหรือเธรด ซึ่งดูเหมือนลบไม่สำเร็จ
function clearedFilter(clearedAt: Date | null) {
  return clearedAt ? { createdAt: { gt: clearedAt } } : {};
}

type MessageRow = {
  id: string;
  seq: number;
  channelId: string;
  authorCoreUserId: string;
  content: string | null;
  clientNonce: string;
  parentId: string | null;
  replyCount: number;
  pinnedAt: Date | null;
  pinnedByCoreUserId: string | null;
  editedAt: Date | null;
  createdAt: Date;
  attachments: {
    id: string;
    fileName: string;
    kind: string;
    mimeType: string;
    sizeBytes: bigint;
  }[];
  embed: { kind: string; refId: string } | null;
  replyToMessageId: string | null;
  forwarded: boolean;
  storyReplyKind: StoryReplyKind | null;
  storyReplyEmoji: string | null;
  replyTo: {
    id: string;
    authorCoreUserId: string;
    content: string | null;
    deletedAt: Date | null;
    attachments: { kind: string }[];
  } | null;
  callLog: CallLogRow | null;
};


function replyToView(row: MessageRow['replyTo']): MessageReplyToDto | null {
  if (!row) {
    return null;
  }

  const deleted = row.deletedAt !== null;
  const kind = row.attachments[0]?.kind;

  return {
    id: row.id,
    authorCoreUserId: row.authorCoreUserId,
    // ข้อความที่ถูกลบต้องไม่หลุดเนื้อหาออกมาทางกล่องตอบกลับ
    preview: deleted ? null : (row.content?.slice(0, 120) ?? null),
    attachmentKind: deleted || !kind
      ? null
      : kind === 'IMAGE' || kind === 'VIDEO' || kind === 'AUDIO'
        ? kind
        : 'FILE',
    deleted,
  };
}

export function toMessageResponse(
  message: MessageRow,
  embed: MessageEmbedViewDto | null = null,
): MessageResponseDto {
  return {
    id: message.id,
    seq: message.seq,
    channelId: message.channelId,
    authorCoreUserId: message.authorCoreUserId,
    content: message.content,
    attachments: message.attachments.map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes.toString(),
    })),
    embed: message.embed
      ? (embed ?? {
          kind: message.embed.kind as MessageEmbedViewDto['kind'],
          targetId: message.embed.refId,
          refId: message.embed.refId,
          authorCoreUserId: null,
          title: null,
          preview: null,
          thumbnailUrl: null,
          thumbnailKind: null,
          available: false,
        })
      : null,
    replyTo: replyToView(message.replyTo),
    callLog: callLogView(message.callLog),
    forwarded: message.forwarded,
    storyReply: message.storyReplyKind
      ? { kind: message.storyReplyKind, emoji: message.storyReplyEmoji }
      : null,
    parentId: message.parentId,
    replyCount: message.replyCount,
    pinnedAt: message.pinnedAt?.toISOString() ?? null,
    pinnedByCoreUserId: message.pinnedByCoreUserId,
    clientNonce: message.clientNonce,
    editedAt: message.editedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}
