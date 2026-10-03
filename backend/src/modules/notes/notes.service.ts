import { Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { NoteModel } from '../../generated/prisma/models.js';
import { BlocksService } from '../blocks/blocks.service.js';
import {
  NOTE_LIST_LIMIT,
  NOTE_TTL_MS,
  NoteDto,
  PutNoteDto,
} from './dto/note.dto.js';

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  /// โพสต์โน้ต = ทับของเดิม เริ่มนับ 24 ชั่วโมงใหม่ และตั้งกลุ่มผู้ชมใหม่
  ///
  /// upsert ครั้งเดียวเพราะคีย์คือ coreUserId — กดโพสต์สองแท็บพร้อมกันก็ได้
  /// โน้ตเดียว ไม่ใช่สองแถวที่ต้องมาเดาว่าอันไหนล่าสุด
  async putMine(user: CoreHubUser, dto: PutNoteDto): Promise<NoteDto> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NOTE_TTL_MS);
    const audience = dto.audience ?? 'MUTUAL_FOLLOWERS';

    const note = await this.prisma.note.upsert({
      where: { coreUserId: user.coreUserId },
      create: {
        coreUserId: user.coreUserId,
        text: dto.text,
        audience,
        createdAt: now,
        expiresAt,
      },
      update: { text: dto.text, audience, createdAt: now, expiresAt },
    });

    return toNoteDto(note, user);
  }

  async removeMine(user: CoreHubUser): Promise<void> {
    await this.prisma.note.deleteMany({ where: { coreUserId: user.coreUserId } });
  }

  /// แถวโน้ตเหนือกล่องข้อความ — ของฉันก่อนเสมอ แล้วโน้ตที่ฉันมีสิทธิ์เห็น ใหม่ไปเก่า
  ///
  /// กลุ่มผู้ชมตาม Instagram (ตัดสินด้วยความสัมพันธ์ตอนอ่าน ไม่ใช่ตอนโพสต์):
  ///   MUTUAL_FOLLOWERS  คนที่ติดตามเจ้าของ **และ** เจ้าของติดตามกลับ
  ///   CLOSE_FRIENDS     เฉพาะคนในรายชื่อเพื่อนสนิทของเจ้าของ
  /// คนที่บล็อกกัน (ทิศไหนก็ได้) ไม่เห็นกันเลย · โน้ตหมดอายุถูกกรองตอนอ่าน
  ///
  /// คิวรีคงที่: ติดตามกันทั้งสองทาง · เพื่อนสนิทที่มีฉัน · การบล็อก · โน้ต
  async list(user: CoreHubUser): Promise<NoteDto[]> {
    const me = user.coreUserId;

    const [mutualRows, closeRows, hidden] = await Promise.all([
      this.prisma.$queryRaw<{ core_user_id: string }[]>`
        SELECT a.following_core_user_id AS core_user_id
        FROM follows a
        JOIN follows b
          ON b.follower_core_user_id = a.following_core_user_id
         AND b.following_core_user_id = a.follower_core_user_id
        WHERE a.follower_core_user_id = ${me}
      `,
      this.prisma.closeFriend.findMany({
        where: { friendCoreUserId: me },
        select: { ownerCoreUserId: true },
      }),
      this.blocks.hiddenFor(me),
    ]);

    const blocked = new Set(hidden);
    const mutual = mutualRows.map((row) => row.core_user_id).filter((id) => !blocked.has(id));
    const closeOwners = closeRows
      .map((row) => row.ownerCoreUserId)
      .filter((id) => !blocked.has(id));

    const notes = await this.prisma.note.findMany({
      where: {
        expiresAt: { gt: new Date() },
        OR: [
          { coreUserId: me },
          { coreUserId: { in: mutual }, audience: 'MUTUAL_FOLLOWERS' },
          { coreUserId: { in: closeOwners }, audience: 'CLOSE_FRIENDS' },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { coreUserId: 'asc' }],
      take: NOTE_LIST_LIMIT,
    });

    const mine = notes.filter((note) => note.coreUserId === me);
    const others = notes.filter((note) => note.coreUserId !== me);

    return [...mine, ...others].map((note) => toNoteDto(note, user));
  }
}

function toNoteDto(note: NoteModel, user: CoreHubUser): NoteDto {
  return {
    coreUserId: note.coreUserId,
    text: note.text,
    audience: note.audience,
    createdAt: note.createdAt.toISOString(),
    expiresAt: note.expiresAt.toISOString(),
    isMe: note.coreUserId === user.coreUserId,
  };
}
