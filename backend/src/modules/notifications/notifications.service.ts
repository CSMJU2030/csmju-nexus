import { Injectable, NotFoundException } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import { camelizeKeys } from '../../common/util/camel-keys.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationKind } from '../../generated/prisma/enums.js';
import { NotificationPreferencesService } from '../settings/notification-preferences.service.js';
import {
  ListNotificationsQuery,
  NotificationResponseDto,
  toNotificationResponse,
  UnreadCountDto,
} from './dto/notification.dto.js';

export interface PushInput {
  /// ผู้รับ
  coreUserId: string;
  kind: NotificationKind;
  refId: string;
  actorCoreUserId?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  /// สร้างแจ้งเตือนหนึ่งรายการแล้วผลักออกทาง socket ถ้าคนนั้นออนไลน์อยู่
  ///
  /// ไม่ throw เมื่อล้มเหลว — การแจ้งเตือนพลาดไม่ควรทำให้การกดไลก์หรือ
  /// การส่งข้อความล้มไปด้วย งานหลักสำเร็จไปแล้วก่อนจะมาถึงบรรทัดนี้
  async push(input: PushInput): Promise<void> {
    // ไม่แจ้งเตือนตัวเอง — คนกดรู้อยู่แล้วว่าตัวเองกดอะไร
    if (input.actorCoreUserId === input.coreUserId) {
      return;
    }

    try {
      // การตั้งค่าของผู้รับตัดสินที่นี่ — ปิดไว้ = ไม่มีแถว · หยุดชั่วคราว = มีแถวแต่ไม่เด้ง
      const decision = (
        await this.preferences.decide([input.coreUserId], input)
      ).get(input.coreUserId);

      if (!decision?.create) {
        return;
      }

      const row = await this.prisma.notification.create({
        data: {
          coreUserId: input.coreUserId,
          kind: input.kind,
          refId: input.refId,
          actorCoreUserId: input.actorCoreUserId ?? null,
          // cast เพราะชนิด JSON input ของ Prisma ไม่ยอมรับ null ที่ระดับ field
          // แต่ payload ของเรามี null ซ้อนอยู่ข้างในได้ตามปกติ (เช่น preview: null)
          // ซึ่ง Postgres เก็บเป็น JSON null ได้ถูกต้องอยู่แล้ว
          payload: input.payload as Prisma.InputJsonValue | undefined,
        },
      });

      if (!decision.push) {
        return;
      }

      this.bus.pushToUser({
        coreUserId: input.coreUserId,
        notification: {
          id: row.id,
          kind: row.kind,
          refId: row.refId,
          actorCoreUserId: row.actorCoreUserId,
          payload: camelizeKeys(row.payload ?? null),
          createdAt: row.createdAt.toISOString(),
        },
        unreadCount: await this.rawUnreadCount(input.coreUserId),
      });
    } catch {
      // ตั้งใจกลืน — ดูเหตุผลใน doc comment ด้านบน
    }
  }

  /// แจ้งหลายคนพร้อมกัน เช่น @everyone ในห้อง หรือประกาศนัดประชุม
  async pushMany(
    coreUserIds: string[],
    input: Omit<PushInput, 'coreUserId'>,
  ): Promise<void> {
    // ไม่เรียก push() ทีละคน
    //
    // push() หนึ่งครั้ง = insert หนึ่งครั้ง + COUNT หนึ่งครั้ง ห้องเรียน 200 คน
    // ที่มีคนพิมพ์ @everyone หรืออาจารย์กดนัดประชุม จึงยิงราว 400 คิวรี
    // ในคำขอเดียว — พอมีสองสามคนทำพร้อมกัน connection pool ก็หมด แล้วทั้ง
    // ระบบค้างตามไปด้วย ทั้งที่ต้นเหตุคือการแจ้งเตือนอย่างเดียว
    //
    // เขียนทีเดียวด้วย createMany แล้วนับยอดยังไม่อ่านของทุกคนในคิวรีเดียว
    const candidates = [...new Set(coreUserIds)].filter(
      (coreUserId) => coreUserId !== input.actorCoreUserId,
    );

    if (candidates.length === 0) {
      return;
    }

    try {
      // การตั้งค่าของผู้รับทุกคนในคิวรีเดียว (ดู NotificationPreferencesService.decide)
      const decisions = await this.preferences.decide(candidates, input);
      const unique = candidates.filter((id) => decisions.get(id)?.create);

      if (unique.length === 0) {
        return;
      }

      await this.prisma.notification.createMany({
        data: unique.map((coreUserId) => ({
          coreUserId,
          kind: input.kind,
          refId: input.refId,
          actorCoreUserId: input.actorCoreUserId ?? null,
          payload: input.payload as Prisma.InputJsonValue | undefined,
        })),
      });

      // createMany ไม่คืนแถวที่สร้าง จึงอ่านกลับมาเพื่อส่งเข้า socket
      const rows = await this.prisma.notification.findMany({
        where: {
          coreUserId: { in: unique },
          kind: input.kind,
          refId: input.refId,
        },
        orderBy: { createdAt: 'desc' },
        take: unique.length,
      });

      const unreadPerUser = await this.prisma.notification.groupBy({
        by: ['coreUserId'],
        where: { coreUserId: { in: unique }, readAt: null },
        _count: { _all: true },
      });

      const unreadBy = new Map(
        unreadPerUser.map((row) => [row.coreUserId, row._count._all]),
      );

      for (const row of rows) {
        if (!decisions.get(row.coreUserId)?.push) {
          continue;
        }

        this.bus.pushToUser({
          coreUserId: row.coreUserId,
          notification: {
            id: row.id,
            kind: row.kind,
            refId: row.refId,
            actorCoreUserId: row.actorCoreUserId,
            payload: camelizeKeys(row.payload ?? null),
            createdAt: row.createdAt.toISOString(),
          },
          unreadCount: unreadBy.get(row.coreUserId) ?? 0,
        });
      }
    } catch {
      // ตั้งใจกลืน — ดูเหตุผลใน doc comment ของ push()
    }
  }

  async list(
    user: CoreHubUser,
    query: ListNotificationsQuery,
  ): Promise<Paginated<NotificationResponseDto>> {
    const kinds = query.kinds;
    const where = {
      coreUserId: user.coreUserId,
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
      ...(kinds ? { kind: { in: kinds } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return new Paginated(rows.map(toNotificationResponse), query.meta(total));
  }

  async unreadCount(user: CoreHubUser): Promise<UnreadCountDto> {
    return { unreadCount: await this.rawUnreadCount(user.coreUserId) };
  }

  async markRead(user: CoreHubUser, id: string): Promise<UnreadCountDto> {
    // ค้นด้วย coreUserId ด้วย เพื่อไม่ให้ mark แจ้งเตือนของคนอื่นได้
    const found = await this.prisma.notification.findFirst({
      where: { id, coreUserId: user.coreUserId },
      select: { id: true, readAt: true },
    });

    if (!found) {
      throw new NotFoundException('ไม่พบการแจ้งเตือนนี้');
    }

    if (!found.readAt) {
      await this.prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
      });
    }

    return { unreadCount: await this.rawUnreadCount(user.coreUserId) };
  }

  async markAllRead(user: CoreHubUser): Promise<{ marked: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { coreUserId: user.coreUserId, readAt: null },
      data: { readAt: new Date() },
    });

    return { marked: result.count };
  }

  private rawUnreadCount(coreUserId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { coreUserId, readAt: null },
    });
  }
}
