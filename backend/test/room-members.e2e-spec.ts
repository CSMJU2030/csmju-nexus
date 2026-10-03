import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp, PREFIX_EXCLUDE } from '../src/bootstrap.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import {
  RealtimeBus,
  type RoomEviction,
} from '../src/common/realtime/realtime-bus.js';
import { bearer, startCoreHubStub } from './core-hub-fixture.js';

/// เชิญสมาชิก · นำสมาชิกออก · ออกจากห้อง — ปุ่ม "เชิญสมาชิก" ในหน้า /chat
///
/// ทุกคนในชุดนี้มีรหัสสุ่มต่อรอบ ห้องที่สร้างถูกลบใน afterAll
/// (ฐานข้อมูลเป็นของจริงที่ใช้ร่วมกับชุดอื่น)
describe('สมาชิกห้อง: เชิญ · นำออก · ออกเอง (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = randomUUID().slice(0, 8);
  const owner = `e2e-${run}-owner`;
  const moderator = `e2e-${run}-moderator`;
  const member = `e2e-${run}-member`;
  const invitee = `e2e-${run}-invitee`;
  const lecturer = `e2e-${run}-lecturer`;
  const outsider = `e2e-${run}-outsider`;
  const created: string[] = [];

  beforeAll(async () => {
    await startCoreHubStub();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: PREFIX_EXCLUDE });
    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.channel.deleteMany({ where: { id: { in: created } } });
    await prisma.notification.deleteMany({
      where: { coreUserId: { startsWith: `e2e-${run}-` } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorCoreUserId: { startsWith: `e2e-${run}-` } },
    });
    await prisma.profileCache.deleteMany({
      where: { coreUserId: { startsWith: `e2e-${run}-` } },
    });
    await prisma.subsystemMember.deleteMany({
      where: { coreUserId: { startsWith: `e2e-${run}-` } },
    });
    await app.close();
  });

  /// ห้องกลุ่มที่ owner สร้าง (owner = ผู้ดูแลห้อง) พร้อม moderator และ member
  async function createRoom(kind: 'GROUP' | 'VOICE' = 'GROUP') {
    const response = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('Authorization', bearer(owner, 'student'))
      .send({ kind, name: `ห้องทดสอบสมาชิก ${run}`, description: 'ห้องจากชุดทดสอบเชิญสมาชิก' })
      .expect(201);

    const id = response.body.data.id as string;

    created.push(id);

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${id}/members`)
      .set('Authorization', bearer(owner, 'student'))
      .send({ coreUserIds: [moderator, member] })
      .expect(201);

    await prisma.channelMember.update({
      where: { channelId_coreUserId: { channelId: id, coreUserId: moderator } },
      data: { role: 'MODERATOR' },
    });

    return id;
  }

  async function memberIds(channelId: string): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/channels/${channelId}/members?limit=100`)
      .set('Authorization', bearer(owner, 'student'))
      .expect(200);

    return (response.body.data as { coreUserId: string }[])
      .map((row) => row.coreUserId)
      .sort();
  }

  it('ผู้ดูแลห้องเชิญได้หลายคน · added นับเฉพาะคนใหม่ · กระจาย channel:members', async () => {
    const bus = app.get(RealtimeBus);
    const events: { room: string; event: string; payload: unknown }[] = [];
    const sub = bus.roomEvents.subscribe((row) => events.push(row));

    try {
      const id = await createRoom('VOICE');

      const response = await request(app.getHttpServer())
        .post(`/api/v1/channels/${id}/members`)
        .set('Authorization', bearer(moderator, 'student'))
        // member อยู่แล้ว → ข้าม · invitee ส่งซ้ำ → นับครั้งเดียว
        .send({ coreUserIds: [invitee, member, invitee] })
        .expect(201);

      expect(response.body.data).toEqual({ added: 1 });
      expect(await memberIds(id)).toEqual([invitee, member, moderator, owner].sort());

      expect(events).toContainEqual({
        room: id,
        event: 'channel:members',
        payload: { channelId: id, added: [invitee], removed: [], byCoreUserId: moderator },
      });

      // คนที่ถูกเชิญเห็นห้องและได้แจ้งเตือน
      await request(app.getHttpServer())
        .get(`/api/v1/channels/${id}`)
        .set('Authorization', bearer(invitee, 'student'))
        .expect(200);

      const invites = await prisma.notification.count({
        where: { coreUserId: invitee, kind: 'CHANNEL_INVITE', refId: id },
      });

      expect(invites).toBe(1);
    } finally {
      sub.unsubscribe();
    }
  });

  it('สมาชิกธรรมดาที่เป็นนักศึกษาเชิญไม่ได้ (403) · อาจารย์ที่เป็นสมาชิกธรรมดาเชิญได้', async () => {
    const id = await createRoom();

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${id}/members`)
      .set('Authorization', bearer(member, 'student'))
      .send({ coreUserIds: [invitee] })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${id}/members`)
      .set('Authorization', bearer(owner, 'student'))
      .send({ coreUserIds: [lecturer] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${id}/members`)
      .set('Authorization', bearer(lecturer, 'lecturer'))
      .send({ coreUserIds: [invitee] })
      .expect(201);

    expect(await memberIds(id)).toContain(invitee);
  });

  it('ผู้ดูแลห้องนำสมาชิกออกได้ → หายจากรายชื่อ · เปิดห้องไม่ได้ · ถูกเตะจาก socket · มี audit log', async () => {
    const bus = app.get(RealtimeBus);
    const evictions: RoomEviction[] = [];
    const events: { room: string; event: string; payload: unknown }[] = [];
    const subs = [
      bus.evictions.subscribe((row) => evictions.push(row)),
      bus.roomEvents.subscribe((row) => events.push(row)),
    ];

    try {
      const id = await createRoom();

      await request(app.getHttpServer())
        .delete(`/api/v1/channels/${id}/members/${member}`)
        .set('Authorization', bearer(moderator, 'student'))
        .expect(204);

      expect(await memberIds(id)).toEqual([moderator, owner].sort());

      await request(app.getHttpServer())
        .get(`/api/v1/channels/${id}`)
        .set('Authorization', bearer(member, 'student'))
        .expect(404);

      expect(events).toContainEqual({
        room: id,
        event: 'channel:members',
        payload: { channelId: id, added: [], removed: [member], byCoreUserId: moderator },
      });
      expect(evictions).toContainEqual({ room: id, coreUserId: member });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'channel.member_remove', targetId: id },
      });

      expect(audit?.actorCoreUserId).toBe(moderator);
    } finally {
      subs.forEach((sub) => sub.unsubscribe());
    }
  });

  it('ผู้ดูแลเตะผู้ดูแลด้วยกันหรือผู้สร้างไม่ได้ (403) · ผู้สร้างเอาผู้ดูแลออกได้', async () => {
    const id = await createRoom();

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${owner}`)
      .set('Authorization', bearer(moderator, 'student'))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${id}/members`)
      .set('Authorization', bearer(owner, 'student'))
      .send({ coreUserIds: [invitee] })
      .expect(201);

    await prisma.channelMember.update({
      where: { channelId_coreUserId: { channelId: id, coreUserId: invitee } },
      data: { role: 'MODERATOR' },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${invitee}`)
      .set('Authorization', bearer(moderator, 'student'))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${moderator}`)
      .set('Authorization', bearer(owner, 'student'))
      .expect(204);

    expect(await memberIds(id)).toEqual([invitee, member, owner].sort());
  });

  it('สมาชิกธรรมดานำคนออกไม่ได้ · นำตัวเองออกไม่ได้ (400) · คนนอก 404 · คนที่ไม่อยู่ในห้อง 404', async () => {
    const id = await createRoom();

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${moderator}`)
      .set('Authorization', bearer(member, 'student'))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${moderator}`)
      .set('Authorization', bearer(moderator, 'student'))
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${member}`)
      .set('Authorization', bearer(outsider, 'staff'))
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${id}/members/${outsider}`)
      .set('Authorization', bearer(owner, 'student'))
      .expect(404);

    expect(await memberIds(id)).toEqual([member, moderator, owner].sort());
  });

  it('ออกจากห้องเอง → กระจาย channel:members ให้คนที่เหลือ', async () => {
    const bus = app.get(RealtimeBus);
    const events: { room: string; event: string; payload: unknown }[] = [];
    const sub = bus.roomEvents.subscribe((row) => events.push(row));

    try {
      const id = await createRoom();

      await request(app.getHttpServer())
        .delete(`/api/v1/channels/${id}/members/me`)
        .set('Authorization', bearer(member, 'student'))
        .expect(204);

      expect(await memberIds(id)).toEqual([moderator, owner].sort());
      expect(events).toContainEqual({
        room: id,
        event: 'channel:members',
        payload: { channelId: id, added: [], removed: [member], byCoreUserId: member },
      });
    } finally {
      sub.unsubscribe();
    }
  });

  it('แชทส่วนตัวนำใครออกไม่ได้ (400)', async () => {
    const dm = await request(app.getHttpServer())
      .post('/api/v1/direct-channels')
      .set('Authorization', bearer(owner, 'staff'))
      .send({ peerCoreUserId: member })
      .expect(201);

    created.push(dm.body.data.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/channels/${dm.body.data.id}/members/${member}`)
      .set('Authorization', bearer(owner, 'staff'))
      .expect(400);
  });
});
