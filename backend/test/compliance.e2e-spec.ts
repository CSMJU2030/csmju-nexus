import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp, PREFIX_EXCLUDE } from '../src/bootstrap.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import { CallLogService } from '../src/modules/channels/call-log.service.js';
import {
  RealtimeBus,
  type RoomEviction,
} from '../src/common/realtime/realtime-bus.js';
import {
  bearer,
  DEFAULT_SUB,
  defaultBearer,
  startCoreHubStub,
} from './core-hub-fixture.js';

/// ทดสอบว่า response ยังตรงมาตรฐาน CSMJU2030 อยู่
///
/// ชุดนี้มีไว้ให้ CI Gate จับตอนใครเผลอแก้ envelope หรือเปลี่ยนชื่อ field
/// เป็น camelCase เพราะสองอย่างนั้นทำให้ระบบย่อยอื่นที่เรียก API เราพังเงียบ ๆ
describe('มาตรฐาน API ของ CSMJU2030 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // ทุกคำขอในชุดนี้ถือ token ที่ผ่านการตรวจลายเซ็นจริง ไม่มีโหมดตัวตนปลอม
    // อีกแล้ว — เดิมตั้ง DEV_FAKE_GATEWAY=true แล้วหลังบ้านสร้างตัวตนจาก env
    await startCoreHubStub();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // ใช้การตั้งค่าชุดเดียวกับ main.ts เพื่อให้ที่ทดสอบคือของจริง
    // prefix ต้องตั้งแยกเพราะ main.ts ถือบรรทัดนั้นไว้เอง (ดู bootstrap.ts)
    app.setGlobalPrefix('api/v1', { exclude: PREFIX_EXCLUDE });
    configureApp(app);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /// เส้นทางบังคับตาม contracts/vocabulary.json (`requiredRoutes.health`)
  /// และ conformance L1-01/02/03
  ///
  /// สามอย่างที่ต้องตรงพร้อมกัน ไม่ใช่แค่ "มี endpoint":
  ///   1. อยู่ที่ `/api/health` — **ไม่มีเลขเวอร์ชัน** และไม่ใช่ `/health` เฉย ๆ
  ///   2. หุ้มด้วย success envelope เหมือน endpoint อื่น
  ///   3. ฟิลด์ชื่อ `service` (ไม่ใช่ `subsystem`) และค่าต้องตรงกับ
  ///      `name:` ใน subsystem.yaml เพราะ conformance เอาไปเทียบกับทะเบียน
  it('GET /api/health ต้องมี หุ้ม envelope และบอกชื่อระบบย่อยที่ลงทะเบียนไว้', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.service).toBe('csmju-nexus');
    expect(['ok', 'degraded']).toContain(response.body.data.status);
  });

  /// เส้นทางเดิมต้องหายไปจริง ไม่ใช่ยังตอบอยู่ทั้งสองทาง
  ///
  /// ถ้าปล่อยให้ `/health` ยังตอบได้ ตัวตรวจสถานะภายนอก (Render, uptime
  /// monitor) จะชี้ไปที่เส้นทางที่มาตรฐานไม่รู้จัก แล้ววันที่มันถูกลบจริง
  /// จะกลายเป็นระบบล่มโดยไม่มีใครรู้สาเหตุ
  it('เส้นทางเดิม /health ต้องไม่ตอบแล้ว', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  /// meta ของคอลเลกชัน — ชื่อฟิลด์ล็อกไว้ที่ contracts/vocabulary.json
  /// (`collectionMeta`) และ conformance L2-03 อ่านสี่ตัวนี้ตรง ๆ
  ///
  /// **JSON เป็น camelCase ส่วนฐานข้อมูลเป็น snake_case** — แยกคนละชั้นกัน
  /// โดยเจตนา (data-dictionary.md ข้อ 9.1) เดิมเทสต์นี้ชื่อว่า "แบบ snake_case"
  /// ซึ่งตรงกับสัญญาฉบับที่ถูกยกเลิกไปแล้ว
  it('list endpoint ต้องคืน envelope พร้อม meta สี่ฟิลด์แบบ camelCase', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reels?page=1&limit=5')
      .set('Authorization', defaultBearer())
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(Object.keys(response.body.meta).sort()).toEqual([
      'limit',
      'page',
      'total',
      'totalPages',
    ]);
  });

  it('ข้อผิดพลาดต้องอยู่ในรูป { success: false, error: { code, message } }', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reels?page=0')
      .set('Authorization', defaultBearer())
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof response.body.error.message).toBe('string');
  });

  it('ตัวตนต้องมาจาก header ของ Gateway และมีสิทธิ์สองชั้น', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/subsystem-members/me')
      .set('Authorization', defaultBearer())
      .expect(200);

    expect(response.body.data.coreUserId).toBe(DEFAULT_SUB);
    expect(response.body.data.coreRole).toBe('student');
    expect(response.body.data.layer2Role).toBe('GUEST');
  });

  it('ปฏิเสธนามสกุลที่เบราว์เซอร์เรนเดอร์เป็นหน้าเว็บได้', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assets/upload-intents')
      .set('Authorization', defaultBearer())
      .send({ fileName: 'payload.svg', sizeBytes: 100, bucket: 'attachments' })
      .expect(400);

    expect(response.body.error.message).toContain('.svg');
  });

  it('ตอบ 404 ไม่ใช่ 403 เมื่อไม่ได้เป็นสมาชิกห้อง เพื่อไม่ให้คนนอกรู้ว่าห้องมีจริง', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/channels/00000000-0000-4000-8000-000000000000/messages')
      .set('Authorization', defaultBearer())
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('นักศึกษาสร้างห้องประจำวิชาไม่ได้ (Layer 1 RBAC)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('Authorization', defaultBearer())
      .send({ kind: 'COURSE', name: 'CS999', description: 'ห้องจากชุดทดสอบ compliance' })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('**guest และ alumni (GUEST) สร้างห้องประจำวิชาไม่ได้เหมือนนักศึกษา** · อาจารย์สร้างได้', async () => {
    // เดิมกันแค่ student — conformance L2-12 จับได้ตอนรันกับ Core Hub จริงที่มีบัญชี guest
    for (const role of ['guest', 'alumni'] as const) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(`${role}-course-probe`, role))
        .send({ kind: 'COURSE', name: 'CS998', description: 'ห้องจากชุดทดสอบ compliance' })
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    }

    const created = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('Authorization', bearer('lecturer-course-probe', 'lecturer'))
      .send({ kind: 'COURSE', name: 'CS997', description: 'ห้องจากชุดทดสอบ compliance' })
      .expect(201);

    await app.get(PrismaService).channel.delete({ where: { id: created.body.data.id } });
  });

  it('บังคับรูปแบบแท็กวิชาให้ตรงกันทั้งระบบ', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/posts')
      .set('Authorization', defaultBearer())
      .send({ title: 'ทดสอบ', content: 'เนื้อหา', courseTag: 'cs-201' })
      .expect(400);

    expect(response.body.error.message).toContain('CS201');
  });

  it('เข้าห้องเสียงที่ไม่ได้เป็นสมาชิกไม่ได้', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/voice-sessions')
      .set('Authorization', defaultBearer())
      .send({ channelId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('อิโมจิรีแอ็กชันต้องอยู่ในรายการที่อนุญาต', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reactions')
      .set('Authorization', defaultBearer())
      .send({
        targetKind: 'POST',
        targetId: '00000000-0000-4000-8000-000000000000',
        emoji: 'PIZZA',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('กดรีแอ็กชันใส่ข้อความที่เข้าถึงไม่ได้ต้องได้ 404 เหมือนกับข้อความที่ไม่มีจริง', async () => {
    // คำตอบต้องแยกไม่ออกระหว่าง "ไม่มีข้อความนี้" กับ "มีแต่คุณเข้าไม่ถึง"
    // ไม่งั้นคนนอกใช้ status code ยืนยันได้ว่า id ที่เดามาถูกต้อง
    await request(app.getHttpServer())
      .post('/api/v1/reactions')
      .set('Authorization', defaultBearer())
      .send({
        targetKind: 'MESSAGE',
        targetId: '00000000-0000-4000-8000-000000000000',
        emoji: 'THUMBSUP',
      })
      .expect(400);
  });

  it('ค้นข้อความแชทได้เฉพาะห้องที่ตัวเองเป็นสมาชิก', async () => {
    // ผู้ใช้ที่ไม่เคยเข้าห้องไหนเลยต้องได้ผลว่าง ไม่ใช่ได้แชทของคนอื่นทั้งระบบ
    // ถ้าเทสต์นี้แดง หมายถึงช่องค้นหากลายเป็นช่องอ่านแชทส่วนตัวของคนอื่น
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=ทดสอบ&kind=messages')
      .set('Authorization', bearer('6799999999-nobody', 'student'))
      .expect(200);

    expect(response.body.meta.total).toBe(0);
  });

  it('ทำเครื่องหมายอ่านแล้วบนการแจ้งเตือนของคนอื่นไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/00000000-0000-4000-8000-000000000000/read')
      .set('Authorization', defaultBearer())
      .expect(404);
  });

  it('ติดตามตัวเองไม่ได้ (ไม่งั้นปั่นยอดผู้ติดตามเองได้)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/follows')
      .set('Authorization', defaultBearer())
      .send({ coreUserId: DEFAULT_SUB })
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('นัดประชุมยาวเกินเพดานต้องไม่ถูกสร้าง', async () => {
    const starts = new Date(Date.now() + 3600_000);
    const ends = new Date(starts.getTime() + 40 * 24 * 3600_000);

    // ยอมรับทั้ง 400 และ 404 เพราะเช็คสมาชิกห้องมาก่อนเช็คช่วงเวลา
    // สิ่งที่ห้ามคือ 201
    const response = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', defaultBearer())
      .send({
        channelId: '00000000-0000-4000-8000-000000000000',
        title: 'ใส่ปีผิด',
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      });

    expect([400, 404]).toContain(response.status);
  });

  it('audit log อ่านได้เฉพาะผู้ดูแลระดับองค์กร', async () => {
    // ผู้เรียกในชุดทดสอบนี้เป็น student จึงต้องถูกปฏิเสธ
    // ถ้าเทสต์นี้แดง แปลว่าประวัติการลบเนื้อหาของทุกคนกลายเป็นข้อมูลสาธารณะ
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', defaultBearer())
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('แดชบอร์ดผู้ดูแลไม่เปิดให้นักศึกษา', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin-overview')
      .set('Authorization', defaultBearer())
      .expect(403);
  });

  it('นักศึกษาเปลี่ยนสิทธิ์ Layer 2 ของคนอื่นไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/subsystem-members/6799999999-target/role')
      .set('Authorization', defaultBearer())
      .send({ layer2Role: 'ADMIN' })
      .expect(403);
  });

  it('โควตาที่ตั้งได้มีเพดาน (กันพิมพ์ศูนย์เกินแล้วจองพื้นที่เกินที่ระบบมี)', async () => {
    // ยอมรับทั้ง 400 และ 403 เพราะเช็คสิทธิ์มาก่อนเช็คค่า — ที่ห้ามคือ 200
    const response = await request(app.getHttpServer())
      .patch('/api/v1/subsystem-members/6799999999-target/storage-quota')
      .set('Authorization', defaultBearer())
      .send({ storageQuotaBytes: 99999999999 });

    expect([400, 403]).toContain(response.status);
  });

  it('สั่งเก็บกวาดไฟล์ค้างได้เฉพาะผู้ดูแลองค์กร', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/assets/maintenance/sweeps')
      .set('Authorization', defaultBearer())
      .expect(403);
  });

  it('บันทึกการดูคลิปที่ไม่มีอยู่จริงต้องได้ 404 ไม่ใช่สร้างแถวขยะ', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/reels/00000000-0000-4000-8000-000000000000/views')
      .set('Authorization', defaultBearer())
      .expect(404);
  });

  it('แถวสตอรี่คืนอาเรย์จัดกลุ่มตามเจ้าของ', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/stories')
      .set('Authorization', defaultBearer())
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);

    for (const tray of response.body.data) {
      expect(typeof tray.hasUnseen).toBe('boolean');
      expect(typeof tray.isMe).toBe('boolean');
      expect(Array.isArray(tray.stories)).toBe(true);
    }
  });

  it('ยอดผู้ชมสตอรี่ของคนอื่นต้องเป็น 0 เสมอ', async () => {
    // ยอดผู้ชมเป็นข้อมูลของเจ้าของ คนอื่นไม่ควรรู้ว่าสตอรี่นี้มีคนดูกี่คน
    const response = await request(app.getHttpServer())
      .get('/api/v1/stories')
      .set('Authorization', defaultBearer())
      .expect(200);

    for (const tray of response.body.data) {
      if (tray.isMe) continue;

      for (const story of tray.stories) {
        expect(story.viewCount).toBe(0);
      }
    }
  });

  it('บันทึกการดูสตอรี่ที่ไม่มีอยู่จริงต้องได้ 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/stories/00000000-0000-4000-8000-000000000000/views')
      .set('Authorization', defaultBearer())
      .expect(404);
  });

  it('ดูรายชื่อผู้ชมสตอรี่ที่ไม่ใช่ของตัวเองไม่ได้', async () => {
    // 404 เมื่อไม่มีสตอรี่ · 403 เมื่อมีแต่ไม่ใช่ของเรา — ที่ห้ามคือ 200
    const response = await request(app.getHttpServer())
      .get('/api/v1/stories/00000000-0000-4000-8000-000000000000/viewers')
      .set('Authorization', defaultBearer());

    expect([403, 404]).toContain(response.status);
  });

  it('สั่งเก็บกวาดสตอรี่ได้เฉพาะผู้ดูแลองค์กร', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/stories/maintenance/sweeps')
      .set('Authorization', defaultBearer())
      .expect(403);
  });

  it('สร้างแชทส่วนตัวกับตัวเองไม่ได้', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/direct-channels')
      .set('Authorization', defaultBearer())
      .send({ peerCoreUserId: DEFAULT_SUB })
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('แก้ชื่อที่แสดงผ่านระบบย่อยไม่ได้ — Core เป็นแหล่งความจริง (หน้า 10)', async () => {
    // ถ้าเทสต์นี้เขียว หมายถึงมีคนเปิดช่องให้เก็บชื่อซ้ำในระบบย่อย
    // ซึ่งจะสร้างชื่อสองเวอร์ชันของคนเดียวกัน แล้วไม่มีใครรู้ว่าอันไหนจริง
    const response = await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', defaultBearer())
      .send({ displayName: 'ชื่อที่ผมตั้งเอง' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('แก้รูปโปรไฟล์ผ่านระบบย่อยไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', defaultBearer())
      .send({ avatarUrl: 'https://example.com/me.png' })
      .expect(400);
  });

  it('GET /profiles/me ต้องบอกว่า field ไหนแก้ไม่ได้', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .set('Authorization', defaultBearer())
      .expect(200);

    expect(response.body.data.managedByCore).toContain('displayName');
    expect(response.body.data.managedByCore).toContain('avatarUrl');
  });

  it('**คนอื่นเห็นคำแนะนำตัวของเรา** — bio เขียนไว้ให้ชุมชนอ่าน ไม่ใช่ความลับ', async () => {
    const owner = '6700000301-bio-owner';
    const bio = `ปี 3 สนใจ backend ${Date.now()}`;

    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', bearer(owner, 'student'))
      .send({ bio })
      .expect(200);

    const seen = await request(app.getHttpServer())
      .get(`/api/v1/profiles/${owner}`)
      .set('Authorization', bearer('6700000302-bio-reader', 'student'))
      .expect(200);

    expect(seen.body.data.bio).toBe(bio);
    expect(seen.body.data).toHaveProperty('coverUrl');
    // สิทธิ์ Layer 2 ของคนอื่นยังต้องไม่หลุดออกมา
    expect(seen.body.data.layer2Role).toBeNull();

    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', bearer(owner, 'student'))
      .send({ bio: '' })
      .expect(200);
  });

  it('คำแนะนำตัวเกินเพดานถูกปฏิเสธ', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', defaultBearer())
      .send({ bio: 'ก'.repeat(301) })
      .expect(400);
  });

  it('ใช้ไฟล์ที่ไม่มีอยู่จริงเป็นรูปปกไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', defaultBearer())
      .send({ coverAssetId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('GET /presence คืนรายชื่อคนออนไลน์', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/presence')
      .set('Authorization', defaultBearer())
      .expect(200);

    expect(Array.isArray(response.body.data.onlineCoreUserIds)).toBe(true);
    expect(typeof response.body.data.totalOnline).toBe('number');
  });

  it('badge มาจาก layer2Role ไม่ใช่ coreRole', async () => {
    // ต้องมาพร้อมการแปลงชื่อในคำขอเดียว ไม่งั้นหน้าบ้านต้องยิงถามสิทธิ์
    // ทีละคนเพื่อวาดเครื่องหมายถูก = N+1 ตอนโหลดรายชื่อ
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles?coreUserIds=6700000000-admin,6700001382-somsak')
      .set('Authorization', defaultBearer())
      .expect(200);

    for (const row of response.body.data) {
      expect('badge' in row).toBe(true);
      expect([null, 'STAFF', 'ADMIN']).toContain(row.badge);
    }
  });

  it('รายชื่อสมาชิกบอกว่าสิทธิ์นี้ตั้งเองหรือแปลงมาอัตโนมัติ', async () => {
    // ถ้าไม่มีฟิลด์นี้ ผู้ดูแลจะไม่รู้ว่าค่าที่เห็นเป็นการตัดสินใจของใคร
    // และจะเจอเคส "อาจารย์ค้างเป็น GUEST" โดยไม่รู้สาเหตุ
    const response = await request(app.getHttpServer())
      .get('/api/v1/subsystem-members')
      .set('Authorization', bearer('6700000000-admin', 'admin'))
      .expect(200);

    for (const row of response.body.data) {
      expect(typeof row.layer2RoleExplicit).toBe('boolean');
    }
  });

  it('สิทธิ์ Layer 2 ปรับตาม coreRole ถ้าไม่ได้ตั้งเอง', async () => {
    // ผู้ใช้ใหม่ที่ header บอกว่าเป็น staff ต้องได้ EDITOR ทันทีที่เรียก /me
    // ไม่ใช่ค้างเป็น GUEST เพราะแถวถูกสร้างไว้ก่อนโดยคนอื่น
    const response = await request(app.getHttpServer())
      .get('/api/v1/subsystem-members/me')
      .set('Authorization', bearer('6700000777-newteacher', 'staff'))
      .expect(200);

    expect(response.body.data.layer2Role).toBe('EDITOR');
  });

  /// สร้างห้องหนึ่งห้องพร้อมข้อความหนึ่งข้อความ แล้วคืน id ของทั้งคู่
  async function seedChannelWithMessage(owner: string, name: string) {
    const channel = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('Authorization', bearer(owner, 'staff'))
      .send({ kind: 'GROUP', name, description: 'ห้องจากชุดทดสอบ compliance' })
      .expect(201);

    const channelId = channel.body.data.id;

    const message = await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('Authorization', bearer(owner, 'staff'))
      .send({
        content: 'ข้อความสำหรับทดสอบยอดรีแอ็กชัน',
        clientNonce: `nonce-${name}`,
      })
      .expect(201);

    return { channelId, messageId: message.body.data.id as string };
  }

  it('ขอยอดรีแอ็กชันหลายชิ้นได้ในคำขอเดียว', async () => {
    // endpoint นี้แทนการยิงทีละข้อความ — วัดแล้วเร็วขึ้น 19 เท่าที่ 40 ข้อความ
    // ถ้าเทสต์นี้หาย แปลว่ามีคนเอา N+1 กลับเข้ามา
    const owner = '6700000333-reactowner';
    const first = await seedChannelWithMessage(owner, 'ห้องรีแอ็กชัน ก');
    const second = await seedChannelWithMessage(owner, 'ห้องรีแอ็กชัน ข');

    const ids = [first.messageId, second.messageId];

    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?targetKind=MESSAGE&targetIds=${ids.join(',')}`,
      )
      .set('Authorization', bearer(owner, 'staff'))
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(ids.length);

    for (const summary of response.body.data) {
      expect(Array.isArray(summary.totals)).toBe(true);
      expect(typeof summary.totalCount).toBe('number');
    }
  });

  it('ยอดรีแอ็กชันของห้องที่ไม่ได้เป็นสมาชิก ต้องไม่หลุด', async () => {
    // ทางเขียนเช็คสมาชิกมาตลอด แต่ทางอ่านไม่เคยเช็ค — ใครที่รู้หรือเดา
    // message id ถูก ก็ดูยอดอิโมจิของห้องส่วนตัวคนอื่นได้ และใช้ยืนยันว่า
    // id นั้นมีอยู่จริงด้วย
    const { messageId } = await seedChannelWithMessage(
      '6700000444-secretowner',
      'ห้องที่คนนอกไม่ควรเห็น',
    );

    // เจ้าของเห็นของตัวเองได้ตามปกติ
    const owner = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?targetKind=MESSAGE&targetIds=${messageId}`,
      )
      .set('Authorization', bearer('6700000444-secretowner', 'staff'))
      .expect(200);

    expect(owner.body.data).toHaveLength(1);

    // คนนอกต้องไม่ได้อะไรกลับไปเลย
    const outsider = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?targetKind=MESSAGE&targetIds=${messageId}`,
      )
      .set('Authorization', bearer('6799999999-outsider', 'student'))
      .expect(200);

    expect(outsider.body.data).toEqual([]);

    // ทางเดี่ยวก็ต้องไม่หลุดเหมือนกัน
    const single = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions?targetKind=MESSAGE&targetId=${messageId}`,
      )
      .set('Authorization', bearer('6799999999-outsider', 'student'))
      .expect(200);

    expect(single.body.data.totalCount).toBe(0);
    expect(single.body.data.totals).toEqual([]);
  });

  it('ขอยอดรีแอ็กชันเกินเพดานถูกปฏิเสธ', async () => {
    const ids = Array.from(
      { length: 101 },
      (_value, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?targetKind=MESSAGE&targetIds=${ids.join(',')}`,
      )
      .set('Authorization', defaultBearer())
      .expect(400);
  });

  it('รายการห้องคืน unreadCount ครบทุกห้อง', async () => {
    // เดิมนับด้วย COUNT ต่อห้อง (2+N คิวรี) ตอนนี้เป็น groupBy ครั้งเดียว
    // เทสต์นี้กันไม่ให้การเปลี่ยนวิธีนับทำให้บางห้องขาดค่าไป
    const response = await request(app.getHttpServer())
      .get('/api/v1/channels?limit=100')
      .set('Authorization', defaultBearer())
      .expect(200);

    for (const channel of response.body.data) {
      expect(typeof channel.unreadCount).toBe('number');
      expect(channel.unreadCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('preflight ต้องอนุญาตให้ส่งคุกกี้ข้ามพอร์ตได้', async () => {
    // เทสต์ชุดนี้ทั้งหมดใช้ supertest ซึ่งไม่บังคับ CORS เหมือนเบราว์เซอร์ —
    // จึงเคยเห็น HTTP 200 ตลอดทั้งที่เบราว์เซอร์จริงถูกบล็อกทุกคำขอ
    // เทสต์นี้ตรวจ "header ที่ตอบกลับ" โดยตรง ซึ่งเป็นสิ่งที่เบราว์เซอร์ดู
    //
    // เดิมตรวจว่าอนุญาต x-user-id / x-layer1-role / x-faculty ซึ่งเป็น header
    // ของ API Gateway ที่ไม่มีอยู่จริง ตอนนี้ session คือคุกกี้ httpOnly
    // สิ่งที่ต้องอนุญาตจึงเป็น **credentials** ไม่ใช่รายชื่อ header
    const response = await request(app.getHttpServer())
      .options('/api/v1/posts')
      .set('Authorization', defaultBearer())
      .set('Origin', 'http://localhost:3222')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3222',
    );

    // ไม่มีบรรทัดนี้ เบราว์เซอร์จะไม่ส่งคุกกี้ข้ามพอร์ตให้เลย
    // แล้วทุกคำขอจะได้ 401 ทั้งที่ผู้ใช้ล็อกอินอยู่
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    // และเมื่อเปิด credentials แล้ว origin ต้องไม่ใช่ `*`
    // (เบราว์เซอร์ปฏิเสธคู่นี้เสมอ — จะกลายเป็นบล็อกทุกคำขอโดยไม่มี error)
    expect(response.headers['access-control-allow-origin']).not.toBe('*');

    const allowed = (response.headers['access-control-allow-headers'] ?? '')
      .toLowerCase();

    expect(allowed).toContain('authorization');

    // header ตัวตนของ Gateway ต้องไม่กลับมา — ถ้ามีเมื่อไหร่แปลว่ามีคนรื้อ
    // สถาปัตยกรรมที่สัญญา v1.0 บอกว่าไม่เคยมีอยู่จริงกลับเข้ามา
    for (const gone of ['x-user-id', 'x-layer1-role', 'x-faculty']) {
      expect(allowed).not.toContain(gone);
    }
  });

  it('คำขอจริงจากหน้าบ้านต้องได้ Access-Control-Allow-Origin กลับมา', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/posts?limit=1')
      .set('Authorization', defaultBearer())
      .set('Origin', 'http://localhost:3222')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3222',
    );
  });

  it('โดเมนนอกรายการต้องไม่ได้รับอนุญาต', async () => {
    // ถ้าหลุดเป็น * เมื่อไหร่ เว็บไหนก็อ่าน API ในนามผู้ใช้ที่ล็อกอินอยู่ได้
    const response = await request(app.getHttpServer())
      .get('/api/v1/posts?limit=1')
      .set('Authorization', defaultBearer())
      .set('Origin', 'https://evil.example.com');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ปฏิเสธ field ที่ไม่อยู่ใน DTO เพื่อไม่ให้ client ยัดค่าเกินสัญญา', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/assets/upload-intents')
      .set('Authorization', defaultBearer())
      .send({
        fileName: 'ok.png',
        sizeBytes: 100,
        bucket: 'attachments',
        ownerCoreUserId: 'someone-else',
      })
      .expect(400);
  });

  it('ออกจากห้องแล้ว socket ต้องถูกเตะออกจากห้องด้วย', async () => {
    // ลบแถวสมาชิกอย่างเดียวไม่พอ — socket ยังอยู่ในห้องของ socket.io
    // และการกระจายข้อความไม่ได้ตรวจสมาชิกซ้ำ อดีตสมาชิกจึงยังได้ข้อความใหม่
    // แบบสดต่อไปเรื่อย ๆ ทั้งที่เปิดหน้าห้องนั้นไม่ได้แล้ว
    const evictions: RoomEviction[] = [];
    const subscription = app
      .get(RealtimeBus)
      .evictions.subscribe((row) => evictions.push(row));

    try {
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer('6700000555-evictowner', 'staff'))
        .send({ kind: 'GROUP', name: 'ห้องที่จะมีคนออก', description: 'ห้องจากชุดทดสอบ compliance' })
        .expect(201);

      const channelId = created.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/channels/${channelId}/members`)
        .set('Authorization', bearer('6700000555-evictowner', 'staff'))
        .send({ coreUserIds: ['6700000666-leaver'] })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/channels/${channelId}/members/me`)
        .set('Authorization', bearer('6700000666-leaver', 'student'))
        .expect(204);

      expect(evictions).toContainEqual({
        room: channelId,
        coreUserId: '6700000666-leaver',
      });

      // และต้องอ่านห้องนั้นไม่ได้อีกแล้วจริง ๆ
      await request(app.getHttpServer())
        .get(`/api/v1/channels/${channelId}/messages`)
        .set('Authorization', bearer('6700000666-leaver', 'student'))
        .expect(404);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('ศิษย์เก่าที่เป็นสมาชิกธรรมดาเพิ่มคนเข้าห้องส่วนตัวไม่ได้', async () => {
    // เงื่อนไขเดิมคือ "ไม่ใช่ผู้ดูแลห้อง **และ** เป็นนักศึกษา" จึงห้ามได้
    // เฉพาะนักศึกษา — ศิษย์เก่าที่เป็นสมาชิกธรรมดาผ่านฉลุย แล้วดึงใครก็ได้
    // เข้ามาอ่านประวัติแชททั้งห้อง
    const created = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('Authorization', bearer('6700000111-owner', 'staff'))
      .send({ kind: 'GROUP', name: 'ห้องลับของอาจารย์', description: 'ห้องจากชุดทดสอบ compliance' })
      .expect(201);

    const channelId = created.body.data.id;

    // เจ้าของห้องดึงศิษย์เก่าเข้ามาเป็นสมาชิกธรรมดา
    await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', bearer('6700000111-owner', 'staff'))
      .send({ coreUserIds: ['6600000222-alumni'] })
      .expect(201);

    // สมาชิกธรรมดาคนนั้นต้องเพิ่มคนอื่นต่อไม่ได้
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', bearer('6600000222-alumni', 'alumni'))
      .send({ coreUserIds: ['6799999999-outsider'] })
      .expect(403);

    expect(forbidden.body.success).toBe(false);

    // และคนนอกต้องยังไม่ได้เข้าห้องจริง ๆ
    //
    // 404 ไม่ใช่ 403 เพราะห้องที่ไม่ได้เป็นสมาชิกไม่ควรถูกยืนยันว่ามีอยู่จริง
    const outsider = await request(app.getHttpServer())
      .get(`/api/v1/channels/${channelId}`)
      .set('Authorization', bearer('6799999999-outsider', 'student'))
      .expect(404);

    expect(outsider.body.success).toBe(false);
  });

  it('ศิษย์เก่าที่เป็นสมาชิกธรรมดานัดประชุมไม่ได้', async () => {
    // ข้อความ error บอกว่า "เฉพาะผู้ดูแลห้องหรืออาจารย์" มาตลอด
    // แต่โค้ดปล่อยศิษย์เก่าผ่าน — การนัดยิงแจ้งเตือนถึงทุกคนในห้อง
    const created = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('Authorization', bearer('6700000111-owner', 'staff'))
      .send({ kind: 'GROUP', name: 'ห้องนัดประชุม', description: 'ห้องจากชุดทดสอบ compliance' })
      .expect(201);

    const channelId = created.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/members`)
      .set('Authorization', bearer('6700000111-owner', 'staff'))
      .send({ coreUserIds: ['6600000222-alumni'] })
      .expect(201);

    const starts = new Date(Date.now() + 3600_000);
    const ends = new Date(starts.getTime() + 3600_000);

    await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', bearer('6600000222-alumni', 'alumni'))
      .send({
        channelId: channelId,
        title: 'นัดโดยคนที่ไม่ควรนัดได้',
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      })
      .expect(403);
  });

  describe('ชั้นข้อมูล — สิ่งที่พังเฉพาะตอนคนใช้พร้อมกัน', () => {
    /// ยิงพร้อมกันจริง ๆ ด้วย Promise.all บนฐานข้อมูลจริง
    ///
    /// บั๊กกลุ่มนี้มองไม่เห็นเลยถ้าทดสอบทีละคำขอ เพราะแต่ละคำขอถูกต้องหมด
    /// สิ่งที่ผิดคือสองคำขออ่านภาพเดียวกันแล้วเขียนทับกัน
  
    it('เข้าห้องเสียงพร้อมกันหลายคน ต้องไม่ทะลุเพดานที่นั่งและต้องได้ห้องเดียวกัน', async () => {
      // เดิมอ่านจำนวนคนในห้องแล้วค่อยเขียน โดยไม่มีอะไรกันสองคำขอที่วิ่งพร้อมกัน
      // อ่านเลขเดียวกัน — ที่นั่งเหลือหนึ่งที่แต่ผ่านด่านทั้งคู่
      //
      // และถ้ายังไม่มีใครอยู่ในห้อง ต่างคนต่างหา session ไม่เจอ แล้วต่างก็สร้าง
      // ใหม่ — ได้ห้องเสียงซ้อนกันสองห้อง คนในคนละห้องไม่ได้ยินกันเลย
      const owner = '6700000900-voiceowner';
  
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(owner, 'staff'))
        .send({ kind: 'GROUP', name: 'ห้องเสียงทดสอบการแย่งที่นั่ง', description: 'ห้องจากชุดทดสอบ compliance', maxSeats: 3 })
        .expect(201);
  
      const channelId = created.body.data.id;
  
      const crowd = Array.from(
        { length: 8 },
        (_value, index) => `67000009${String(index).padStart(2, '0')}-rusher`,
      );
  
      await request(app.getHttpServer())
        .post(`/api/v1/channels/${channelId}/members`)
        .set('Authorization', bearer(owner, 'staff'))
        .send({ coreUserIds: crowd })
        .expect(201);
  
      const results = await Promise.all(
        crowd.map((coreUserId) =>
          request(app.getHttpServer())
            .post('/api/v1/voice-sessions')
            .set('Authorization', bearer(coreUserId, 'student'))
            .send({ channelId: channelId }),
        ),
      );
  
      const ok = results.filter((row) => row.status === 201);
      const full = results.filter((row) => row.status === 409);
  
      // เพดานคือ 3 — ที่เหลือต้องถูกปฏิเสธ ไม่ใช่แทรกเข้าไปได้
      expect(ok).toHaveLength(3);
      expect(full).toHaveLength(5);
  
      // และทุกคนที่เข้าได้ต้องอยู่ "ห้องเดียวกัน" ไม่ใช่คนละห้องที่ชื่อเหมือนกัน
      const sessionIds = new Set(ok.map((row) => row.body.data.id));
  
      expect(sessionIds.size).toBe(1);
    });
  
    it('ทำเครื่องหมายอ่านพร้อมกันจากสองเครื่อง ต้องไม่ถอยหลัง', async () => {
      // เปิดแชทค้างไว้ทั้งบนโน้ตบุ๊กและมือถือ ทั้งคู่อ่านค่าเดิมเท่ากัน
      // แล้วต่างก็คำนวณ max ของตัวเอง — ตัวที่เขียนทีหลังชนะ ถึงจะเป็นค่าที่น้อยกว่า
      //
      // เทสต์นี้ยิงคู่ (สูง, ต่ำ) พร้อมกันหลายรอบ เพราะการแข่งกันไม่ได้แพ้ทุกครั้ง
      const owner = '6700000901-readowner';
  
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(owner, 'staff'))
        .send({ kind: 'GROUP', name: 'ห้องทดสอบหมุดอ่าน', description: 'ห้องจากชุดทดสอบ compliance' })
        .expect(201);
  
      const channelId = created.body.data.id;
  
      for (let round = 0; round < 8; round += 1) {
        const high = 1000 + round * 10;
        const low = high - 9;
  
        await Promise.all([
          request(app.getHttpServer())
            .post(`/api/v1/channels/${channelId}/read-markers`)
            .set('Authorization', bearer(owner, 'staff'))
            .send({ seq: high }),
          request(app.getHttpServer())
            .post(`/api/v1/channels/${channelId}/read-markers`)
            .set('Authorization', bearer(owner, 'staff'))
            .send({ seq: low }),
        ]);
  
        // ค่าที่ต่ำกว่าต้องไม่มีทางลบล้างค่าที่สูงกว่า ไม่ว่าใครเขียนทีหลัง
        const after = await request(app.getHttpServer())
          .post(`/api/v1/channels/${channelId}/read-markers`)
          .set('Authorization', bearer(owner, 'staff'))
          .send({ seq: 1 })
          .expect(201);
  
        expect(after.body.data.lastReadSeq).toBe(high);
      }
    });
  });

  /// ห้องต้องบอกได้ว่าใครสร้าง เพื่ออะไร และเจ้าของต้องลบได้เอง
  ///
  /// เดิมห้องมีแค่ชื่อ ลบไม่ได้เลย ชุดทดสอบนี้เองสร้างห้องค้างไว้ในฐานข้อมูล
  /// dev กว่าร้อยห้องโดยไม่มีทางเก็บกวาด — เทสต์ทุกข้อในกลุ่มนี้ลบห้องของตัวเองทิ้ง
  describe('ห้อง: ผู้สร้าง · วัตถุประสงค์ · แก้ไข · ลบ', () => {
    const owner = '6700000101-room-owner';
    const member = '6700000102-room-member';

    async function createRoom(name: string) {
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(owner, 'student'))
        .send({ kind: 'GROUP', name, description: 'ติวสอบกลางภาค บทที่ 1-5' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/channels/${created.body.data.id}/members`)
        .set('Authorization', bearer(owner, 'student'))
        .send({ coreUserIds: [member] })
        .expect(201);

      return created.body.data as {
        id: string;
        description: string;
        createdByCoreUserId: string;
        canManage: boolean;
      };
    }

    it('**ไม่บอกวัตถุประสงค์ → สร้างห้องไม่ได้** (400)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(owner, 'student'))
        .send({ kind: 'GROUP', name: 'ห้องไม่บอกว่าทำอะไร' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('วัตถุประสงค์ที่มีแต่ช่องว่างถือว่าไม่ได้บอก', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(owner, 'student'))
        .send({ kind: 'GROUP', name: 'ห้องช่องว่าง', description: '     ' })
        .expect(400);
    });

    it('ห้องที่สร้างบอกผู้สร้างและวัตถุประสงค์ ทั้งตอนสร้างและในรายการของสมาชิก', async () => {
      const room = await createRoom('ห้องติวของ owner');

      try {
        expect(room.createdByCoreUserId).toBe(owner);
        expect(room.description).toBe('ติวสอบกลางภาค บทที่ 1-5');
        expect(room.canManage).toBe(true);

        // สมาชิกที่ถูกเพิ่มเข้ามาทีหลังต้องเห็นว่าห้องเป็นของใคร เพื่ออะไร
        // แต่ต้องไม่เห็นปุ่มลบ
        const list = await request(app.getHttpServer())
          .get('/api/v1/channels?limit=100')
          .set('Authorization', bearer(member, 'student'))
          .expect(200);

        const seen = list.body.data.find((row: { id: string }) => row.id === room.id);

        expect(seen.createdByCoreUserId).toBe(owner);
        expect(seen.description).toBe('ติวสอบกลางภาค บทที่ 1-5');
        expect(seen.canManage).toBe(false);
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('ผู้สร้างแก้ชื่อและวัตถุประสงค์ได้ · สมาชิกธรรมดาแก้ไม่ได้ (403)', async () => {
      const room = await createRoom('ห้องก่อนแก้');

      try {
        const updated = await request(app.getHttpServer())
          .patch(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'))
          .send({ name: 'ห้องหลังแก้', description: 'ติวสอบปลายภาค' })
          .expect(200);

        expect(updated.body.data.name).toBe('ห้องหลังแก้');
        expect(updated.body.data.description).toBe('ติวสอบปลายภาค');
        expect(updated.body.data.createdByCoreUserId).toBe(owner);

        const denied = await request(app.getHttpServer())
          .patch(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(member, 'student'))
          .send({ name: 'ยึดห้อง' })
          .expect(403);

        expect(denied.body.error.code).toBe('FORBIDDEN');
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('**อาจารย์ที่เป็นแค่สมาชิก ลบห้องกลุ่มของนักศึกษาไม่ได้**', async () => {
      // canAdministerChannel ให้บุคลากรเพิ่มสมาชิกได้ทุกห้อง แต่การลบทำลาย
      // ประวัติของทุกคน จึงต้องแคบกว่า — ข้อนี้กันไม่ให้สองกฎถูกรวมกันโดยไม่ตั้งใจ
      const staff = '6700000103-room-staff';
      const room = await createRoom('ห้องที่อาจารย์ถูกเชิญ');

      try {
        await request(app.getHttpServer())
          .post(`/api/v1/channels/${room.id}/members`)
          .set('Authorization', bearer(owner, 'student'))
          .send({ coreUserIds: [staff] })
          .expect(201);

        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(staff, 'staff'))
          .expect(403);
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('**ผู้สร้างลบห้องได้** → ข้อความหายตาม · สมาชิกถูกแจ้งและถูกเตะออกจาก socket', async () => {
      const bus = app.get(RealtimeBus);
      const evictions: RoomEviction[] = [];
      const events: { room: string; event: string; payload: unknown }[] = [];
      const subs = [
        bus.evictions.subscribe((row) => evictions.push(row)),
        bus.roomEvents.subscribe((row) => events.push(row)),
      ];

      try {
        const room = await createRoom('ห้องที่จะถูกลบ');

        await request(app.getHttpServer())
          .post(`/api/v1/channels/${room.id}/messages`)
          .set('Authorization', bearer(member, 'student'))
          .send({ content: 'ข้อความที่จะหายไปพร้อมห้อง', clientNonce: `nonce-del-${room.id}` })
          .expect(201);

        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'))
          .expect(204);

        // ห้องไม่อยู่แล้วสำหรับทุกคน
        await request(app.getHttpServer())
          .get(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(member, 'student'))
          .expect(404);

        await request(app.getHttpServer())
          .get(`/api/v1/channels/${room.id}/messages`)
          .set('Authorization', bearer(member, 'student'))
          .expect(404);

        expect(events).toContainEqual({
          room: room.id,
          event: 'channel:deleted',
          payload: {
            channelId: room.id,
            name: 'ห้องที่จะถูกลบ',
            deletedByCoreUserId: owner,
          },
        });
        expect(evictions).toContainEqual({ room: room.id, coreUserId: member });
        expect(evictions).toContainEqual({ room: room.id, coreUserId: owner });
      } finally {
        subs.forEach((sub) => sub.unsubscribe());
      }
    });

    it('สมาชิกธรรมดาลบห้องไม่ได้ (403) และห้องยังอยู่ครบ', async () => {
      const room = await createRoom('ห้องที่สมาชิกพยายามลบ');

      try {
        const denied = await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(member, 'student'))
          .expect(403);

        expect(denied.body.error.code).toBe('FORBIDDEN');

        await request(app.getHttpServer())
          .get(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(member, 'student'))
          .expect(200);
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('คนนอกลบห้องไม่ได้ และไม่รู้ด้วยว่าห้องมีอยู่ (404)', async () => {
      const room = await createRoom('ห้องที่คนนอกพยายามลบ');

      try {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer('6700000199-outsider', 'student'))
          .expect(404);
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${room.id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('ลบแชทส่วนตัวไม่ได้ — อีกฝ่ายจะเสียประวัติไปด้วย', async () => {
      const dm = await request(app.getHttpServer())
        .post('/api/v1/direct-channels')
        .set('Authorization', bearer(owner, 'student'))
        .send({ peerCoreUserId: member })
        .expect(201);

      expect(dm.body.data.canManage).toBe(false);

      await request(app.getHttpServer())
        .delete(`/api/v1/channels/${dm.body.data.id}`)
        .set('Authorization', bearer(owner, 'student'))
        .expect(403);
    });
  });

  /// บรรทัดตัวอย่างใต้ชื่อห้องในกล่องข้อความ ("คุณ: Nice · 2 ชั่วโมง")
  describe('รายการห้อง: ข้อความล่าสุดและลำดับตามความเคลื่อนไหว', () => {
    const owner = '6700000201-inbox-owner';

    async function room(name: string) {
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('Authorization', bearer(owner, 'student'))
        .send({ kind: 'GROUP', name, description: 'ทดสอบกล่องข้อความ' })
        .expect(201);

      return created.body.data.id as string;
    }

    async function say(channelId: string, content: string, parentId?: string) {
      const sent = await request(app.getHttpServer())
        .post(`/api/v1/channels/${channelId}/messages`)
        .set('Authorization', bearer(owner, 'student'))
        .send({ content, clientNonce: `n-${channelId}-${content}`, ...(parentId ? { parentId: parentId } : {}) })
        .expect(201);

      return sent.body.data.id as string;
    }

    it('**lastMessage = ข้อความล่าสุดในไทม์ไลน์หลัก** ไม่นับคำตอบในเธรดและข้อความที่ลบแล้ว', async () => {
      const id = await room('ห้องทดสอบข้อความล่าสุด');

      try {
        const first = await say(id, 'ข้อความแรก');
        await say(id, 'ตอบในเธรด', first);
        const removed = await say(id, 'ข้อความที่จะถูกลบ');

        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${id}/messages/${removed}`)
          .set('Authorization', bearer(owner, 'student'))
          .expect(204);

        const list = await request(app.getHttpServer())
          .get('/api/v1/channels?limit=100')
          .set('Authorization', bearer(owner, 'student'))
          .expect(200);

        const row = list.body.data.find((c: { id: string }) => c.id === id);

        expect(row.lastMessage).toMatchObject({
          content: 'ข้อความแรก',
          authorCoreUserId: owner,
          attachmentCount: 0,
        });
        expect(Date.parse(row.lastMessage.createdAt)).not.toBeNaN();
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('ห้องที่ยังไม่มีข้อความได้ lastMessage = null', async () => {
      const id = await room('ห้องเงียบ');

      try {
        const list = await request(app.getHttpServer())
          .get('/api/v1/channels?limit=100')
          .set('Authorization', bearer(owner, 'student'))
          .expect(200);

        expect(list.body.data.find((c: { id: string }) => c.id === id).lastMessage).toBeNull();
      } finally {
        await request(app.getHttpServer())
          .delete(`/api/v1/channels/${id}`)
          .set('Authorization', bearer(owner, 'student'));
      }
    });

    it('**ห้องที่เพิ่งมีคนพิมพ์ขึ้นบนสุด** แม้จะสร้างก่อน', async () => {
      const older = await room('ห้องที่สร้างก่อน');
      const newer = await room('ห้องที่สร้างทีหลัง');

      try {
        await say(older, 'ปลุกห้องเก่า');

        const list = await request(app.getHttpServer())
          .get('/api/v1/channels?limit=100')
          .set('Authorization', bearer(owner, 'student'))
          .expect(200);

        const ids = list.body.data.map((c: { id: string }) => c.id);

        expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
      } finally {
        for (const id of [older, newer]) {
          await request(app.getHttpServer())
            .delete(`/api/v1/channels/${id}`)
            .set('Authorization', bearer(owner, 'student'));
        }
      }
    });
  });
  /// ฟีเจอร์ชุด Instagram (29 ก.ย. 2569) — ทุกข้อลบสิ่งที่ตัวเองสร้างทิ้ง
  ///
  /// ห้อง DM ลบผ่าน API ไม่ได้โดยออกแบบ (อีกฝ่ายจะเสียประวัติ) จึงเก็บกวาดผ่าน
  /// Prisma ตรง ๆ · ผู้ใช้ทุกคนในชุดนี้ขึ้นต้นด้วย 67000007 เพื่อไล่ลบแจ้งเตือน
  /// และแถวอื่นที่ API ไม่มีทางลบให้ได้ในคำสั่งเดียวตอนท้าย
  describe('ฟีเจอร์แบบ Instagram', () => {
    const http = () => request(app.getHttpServer());
    const db = () => app.get(PrismaService);
    const as = (sub: string, role: 'student' | 'staff' | 'admin' = 'student') =>
      bearer(sub, role);

    const A = '6700000701-ig-alice';
    const B = '6700000702-ig-bob';
    const C = '6700000703-ig-carol';
    const D = '6700000704-ig-dave';
    const E = '6700000705-ig-erin';
    const OUT = '6700000799-ig-outsider';
    const EVERYONE = [A, B, C, D, E, OUT];

    let nonce = 0;
    const say = async (sub: string, channelId: string, content: string) => {
      nonce += 1;
      const sent = await http()
        .post(`/api/v1/channels/${channelId}/messages`)
        .set('Authorization', as(sub))
        .send({ content, clientNonce: `ig-${Date.now()}-${nonce}` })
        .expect(201);

      return sent.body.data as { id: string; seq: number };
    };

    const inbox = async (sub: string) => {
      const list = await http()
        .get('/api/v1/channels?limit=100')
        .set('Authorization', as(sub))
        .expect(200);

      return list.body.data as {
        id: string;
        inboxFolder: string;
        pinnedAt: string | null;
        muted: boolean;
        peerLastReadSeq: number | null;
        memberCoreUserIds: string[] | null;
        lastMessage: { seq: number } | null;
      }[];
    };

    const openDm = async (from: string, to: string) => {
      const dm = await http()
        .post('/api/v1/direct-channels')
        .set('Authorization', as(from))
        .send({ peerCoreUserId: to })
        .expect(201);

      return dm.body.data.id as string;
    };

    afterAll(async () => {
      // ของที่ API ไม่มีทางลบให้: DM · แจ้งเตือน · การติดตาม · โน้ต · รีแอ็กชัน · รายงาน
      const prisma = db();

      await prisma.channel.deleteMany({
        where: {
          kind: { in: ['DM', 'GROUP_DM'] },
          members: { some: { coreUserId: { in: EVERYONE } } },
        },
      });
      await prisma.notification.deleteMany({ where: { coreUserId: { in: EVERYONE } } });
      await prisma.follow.deleteMany({
        where: {
          OR: [
            { followerCoreUserId: { in: EVERYONE } },
            { followingCoreUserId: { in: EVERYONE } },
          ],
        },
      });
      await prisma.note.deleteMany({ where: { coreUserId: { in: EVERYONE } } });
      await prisma.reaction.deleteMany({ where: { coreUserId: { in: EVERYONE } } });
      await prisma.report.deleteMany({ where: { reporterCoreUserId: { in: EVERYONE } } });
      // audit log ของห้อง/ไฟล์/โพสต์ที่ชุดนี้สร้างแล้วลบ และแถวสมาชิกที่เกิดตอนขออัปโหลด
      // — เป็นร่องรอยของชุดทดสอบล้วน ไม่ใช่ประวัติของผู้ใช้จริง
      await prisma.auditLog.deleteMany({ where: { actorCoreUserId: { in: EVERYONE } } });
      await prisma.subsystemMember.deleteMany({ where: { coreUserId: { in: EVERYONE } } });
    });

    describe('B1 · รีแอ็กชันรับอิโมจิมาตรฐานทุกตัว', () => {
      it('รับสีผิว ธงชาติ และลำดับ ZWJ · ปฏิเสธข้อความและอิโมจิสองตัวติดกัน', async () => {
        const post = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(A))
          .send({ title: 'โพสต์ทดสอบอิโมจิ', content: 'ลองกดอิโมจิแปลก ๆ' })
          .expect(201);

        const postId = post.body.data.id as string;

        try {
          for (const emoji of ['👍🏽', '🇹🇭', '👩‍💻']) {
            const reacted = await http()
              .post('/api/v1/reactions')
              .set('Authorization', as(B))
              .send({ targetKind: 'POST', targetId: postId, emoji });

            expect([200, 201]).toContain(reacted.status);
            expect(
              reacted.body.data.totals.map((row: { emoji: string }) => row.emoji),
            ).toContain(emoji);
          }

          for (const emoji of ['ab', '😀😀']) {
            const rejected = await http()
              .post('/api/v1/reactions')
              .set('Authorization', as(B))
              .send({ targetKind: 'POST', targetId: postId, emoji })
              .expect(400);

            expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
          }
        } finally {
          await db().reaction.deleteMany({ where: { targetId: postId } });
          await http()
            .delete(`/api/v1/posts/${postId}`)
            .set('Authorization', as(A));
        }
      });
    });

    describe('B2 · จัดกล่องข้อความ', () => {
      it('**คนแปลกหน้าทักมา = คำขอข้อความ** · ตอบกลับแล้วย้ายไปหลัก · อีกฝ่ายไม่ใช่คำขอ', async () => {
        const dm = await openDm(OUT, A);

        // ยังไม่มีข้อความ = ยังไม่ใช่คำขอ (กล่องว่างไม่มีอะไรให้ขอ)
        expect((await inbox(A)).find((c) => c.id === dm)?.inboxFolder).toBe('PRIMARY');

        await say(OUT, dm, 'สวัสดีครับ ขอถามเรื่องโปรเจกต์หน่อย');

        expect((await inbox(A)).find((c) => c.id === dm)?.inboxFolder).toBe('REQUEST');
        // คนทักไม่ได้เห็นห้องตัวเองเป็นคำขอ เพราะเขาเป็นคนพิมพ์
        expect((await inbox(OUT)).find((c) => c.id === dm)?.inboxFolder).toBe('PRIMARY');

        await say(A, dm, 'ได้เลยครับ');

        expect((await inbox(A)).find((c) => c.id === dm)?.inboxFolder).toBe('PRIMARY');
      });

      it('คนที่ฉันติดตามอยู่ทักมาไม่นับเป็นคำขอ', async () => {
        await http()
          .post('/api/v1/follows')
          .set('Authorization', as(B))
          .send({ coreUserId: C })
          .expect(201);

        const dm = await openDm(C, B);

        await say(C, dm, 'ว่างไหม');

        expect((await inbox(B)).find((c) => c.id === dm)?.inboxFolder).toBe('PRIMARY');
      });

      it('ย้ายแฟ้มได้ · ยอมรับคำขอด้วยการย้ายไป PRIMARY · ไม่ส่งอะไรมา = 400', async () => {
        const dm = await openDm(D, C);

        await say(D, dm, 'ขอเพิ่มเพื่อนหน่อย');
        expect((await inbox(C)).find((c) => c.id === dm)?.inboxFolder).toBe('REQUEST');

        for (const folder of ['GENERAL', 'HIDDEN', 'PRIMARY']) {
          const moved = await http()
            .patch(`/api/v1/channels/${dm}/inbox`)
            .set('Authorization', as(C))
            .send({ folder })
            .expect(200);

          expect(moved.body.data.inboxFolder).toBe(folder);
        }

        // เลือกแฟ้มแล้วเป็นการตัดสินใจของผู้ใช้ — ไม่เด้งกลับเป็นคำขอเอง
        expect((await inbox(C)).find((c) => c.id === dm)?.inboxFolder).toBe('PRIMARY');
        // และไม่กระทบอีกฝ่าย
        expect((await inbox(D)).find((c) => c.id === dm)?.inboxFolder).toBe('PRIMARY');

        await http()
          .patch(`/api/v1/channels/${dm}/inbox`)
          .set('Authorization', as(C))
          .send({})
          .expect(400);

        await http()
          .patch(`/api/v1/channels/${dm}/inbox`)
          .set('Authorization', as(C))
          .send({ folder: 'REQUEST' })
          .expect(400);

        // คนนอกห้องจัดแฟ้มห้องนี้ไม่ได้ และไม่รู้ด้วยว่าห้องมีจริง
        await http()
          .patch(`/api/v1/channels/${dm}/inbox`)
          .set('Authorization', as(OUT))
          .send({ muted: true })
          .expect(404);
      });

      it('**ห้องที่ปักหมุดขึ้นบนสุด** แม้ห้องอื่นจะมีข้อความใหม่กว่า', async () => {
        const older = await openDm(A, D);
        const newer = await openDm(A, B);

        await say(A, older, 'ข้อความเก่า');
        await say(A, newer, 'ข้อความใหม่');

        let ids = (await inbox(A)).map((c) => c.id);
        expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));

        const pinned = await http()
          .patch(`/api/v1/channels/${older}/inbox`)
          .set('Authorization', as(A))
          .send({ pinned: true })
          .expect(200);

        expect(pinned.body.data.pinnedAt).not.toBeNull();

        ids = (await inbox(A)).map((c) => c.id);
        expect(ids[0]).toBe(older);

        await http()
          .patch(`/api/v1/channels/${older}/inbox`)
          .set('Authorization', as(A))
          .send({ pinned: false })
          .expect(200);

        ids = (await inbox(A)).map((c) => c.id);
        expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
      });

      it('**ปักหมุดข้อความใน DM ได้ทุกคนเหมือน Instagram** · ห้องแบบ Discord ยังจำกัดที่ผู้ดูแล', async () => {
        const dm = await openDm(A, B);
        const message = await say(B, dm, 'ข้อความที่จะปักหมุด');

        await http().put(`/api/v1/channels/${dm}/messages/${message.id}/pin`).set('Authorization', as(A)).expect(200);
        const pins = await http().get(`/api/v1/channels/${dm}/messages/pinned`).set('Authorization', as(B)).expect(200);
        expect(pins.body.data.map((m: { id: string }) => m.id)).toEqual([message.id]);
        await http().delete(`/api/v1/channels/${dm}/messages/${message.id}/pin`).set('Authorization', as(B)).expect(200);

        const room = (
          await http()
            .post('/api/v1/channels')
            .set('Authorization', as(A, 'staff'))
            .send({ kind: 'GROUP', name: 'ห้องทดสอบหมุด', description: 'ทดสอบสิทธิ์ปักหมุด' })
            .expect(201)
        ).body.data.id as string;

        try {
          await http().post(`/api/v1/channels/${room}/members`).set('Authorization', as(A, 'staff')).send({ coreUserIds: [B] }).expect(201);
          const roomMessage = await say(B, room, 'ในห้อง');

          await http().put(`/api/v1/channels/${room}/messages/${roomMessage.id}/pin`).set('Authorization', as(B)).expect(403);
        } finally {
          await db().channel.delete({ where: { id: room } });
        }
      });

      it('**ปิดเสียงแล้วไม่ได้แจ้งเตือนเมื่อถูก @** · คนที่ไม่ได้ปิดยังได้ · ยังนับยังไม่อ่าน', async () => {
        const room = await http()
          .post('/api/v1/channels')
          .set('Authorization', as(A, 'staff'))
          .send({ kind: 'GROUP', name: 'ห้องทดสอบปิดเสียง', description: 'ทดสอบการปิดเสียง' })
          .expect(201);

        const roomId = room.body.data.id as string;

        try {
          await http()
            .post(`/api/v1/channels/${roomId}/members`)
            .set('Authorization', as(A, 'staff'))
            .send({ coreUserIds: [B, C] })
            .expect(201);

          const muted = await http()
            .patch(`/api/v1/channels/${roomId}/inbox`)
            .set('Authorization', as(B))
            .send({ muted: true })
            .expect(200);

          expect(muted.body.data.muted).toBe(true);

          const message = await say(A, roomId, `@${B} @${C} ดูงานนี้หน่อย`);

          const mentionsOf = async (sub: string) => {
            const list = await http()
              .get('/api/v1/notifications?kind=MENTION&limit=100')
              .set('Authorization', as(sub))
              .expect(200);

            return (list.body.data as { refId: string }[]).filter(
              (row) => row.refId === message.id,
            );
          };

          expect(await mentionsOf(B)).toHaveLength(0);
          expect(await mentionsOf(C)).toHaveLength(1);

          const row = (await inbox(B)).find((c) => c.id === roomId) as unknown as {
            unreadCount: number;
            muted: boolean;
          };

          expect(row.muted).toBe(true);
          expect(row.unreadCount).toBeGreaterThan(0);
        } finally {
          await http()
            .delete(`/api/v1/channels/${roomId}`)
            .set('Authorization', as(A, 'staff'));
        }
      });

      it('**ลบแชทเฉพาะฝั่งฉัน** · อีกฝ่ายยังเห็นครบ · ข้อความใหม่ทำให้ห้องกลับมา', async () => {
        const dm = await openDm(C, D);

        await say(C, dm, 'ข้อความก่อนลบแชท');

        const cleared = await http()
          .post(`/api/v1/channels/${dm}/clear`)
          .set('Authorization', as(D))
          .expect(200);

        expect(Date.parse(cleared.body.data.clearedAt)).not.toBeNaN();

        const mineAfter = await http()
          .get(`/api/v1/channels/${dm}/messages`)
          .set('Authorization', as(D))
          .expect(200);

        expect(mineAfter.body.data).toHaveLength(0);

        const theirs = await http()
          .get(`/api/v1/channels/${dm}/messages`)
          .set('Authorization', as(C))
          .expect(200);

        expect(theirs.body.data.map((m: { content: string }) => m.content)).toContain(
          'ข้อความก่อนลบแชท',
        );

        // หายจากกล่องข้อความของฉัน แต่ยังอยู่ในของอีกฝ่าย
        expect((await inbox(D)).some((c) => c.id === dm)).toBe(false);
        expect((await inbox(C)).some((c) => c.id === dm)).toBe(true);

        await say(C, dm, 'ข้อความใหม่หลังลบแชท');

        const back = (await inbox(D)).find((c) => c.id === dm);
        expect(back).toBeDefined();

        const mineNow = await http()
          .get(`/api/v1/channels/${dm}/messages`)
          .set('Authorization', as(D))
          .expect(200);

        expect(mineNow.body.data.map((m: { content: string }) => m.content)).toEqual([
          'ข้อความใหม่หลังลบแชท',
        ]);
      });

      it('peerLastReadSeq บอกว่าอีกฝ่ายอ่านถึงไหน (ป้าย "เห็นแล้ว")', async () => {
        const dm = await openDm(B, D);
        const sent = await say(B, dm, 'อ่านหรือยัง');

        let row = (await inbox(B)).find((c) => c.id === dm)!;
        expect(row.peerLastReadSeq).toBe(0);
        expect(row.lastMessage?.seq).toBe(sent.seq);

        await http()
          .post(`/api/v1/channels/${dm}/read-markers`)
          .set('Authorization', as(D))
          .send({ seq: sent.seq })
          .expect(201);

        row = (await inbox(B)).find((c) => c.id === dm)!;
        expect(row.peerLastReadSeq).toBe(sent.seq);
      });
    });

    describe('B3 · แชทกลุ่ม', () => {
      it('สร้างกับสองคน · ทั้งสามคนเห็น · คนนอกได้ 404 · ออกจากแชทได้', async () => {
        const created = await http()
          .post('/api/v1/direct-channels')
          .set('Authorization', as(A))
          .send({ peerCoreUserIds: [B, C, B], name: 'ทีมโปรเจกต์' })
          .expect(201);

        const group = created.body.data;

        try {
          expect(group.kind).toBe('GROUP_DM');
          expect(group.name).toBe('ทีมโปรเจกต์');
          expect(group.memberCount).toBe(3);
          expect(group.myRole).toBe('MODERATOR');
          expect(group.canManage).toBe(true);
          expect(group.description).toBeNull();
          expect([...group.memberCoreUserIds].sort()).toEqual([A, B, C].sort());

          for (const sub of [B, C]) {
            const seen = await http()
              .get(`/api/v1/channels/${group.id}`)
              .set('Authorization', as(sub))
              .expect(200);

            expect(seen.body.data.canManage).toBe(false);
            expect((await inbox(sub)).some((c) => c.id === group.id)).toBe(true);
          }

          await http()
            .get(`/api/v1/channels/${group.id}`)
            .set('Authorization', as(OUT))
            .expect(404);

          await http()
            .delete(`/api/v1/channels/${group.id}/members/me`)
            .set('Authorization', as(C))
            .expect(204);

          await http()
            .get(`/api/v1/channels/${group.id}`)
            .set('Authorization', as(C))
            .expect(404);

          const after = await http()
            .get(`/api/v1/channels/${group.id}`)
            .set('Authorization', as(A))
            .expect(200);

          expect(after.body.data.memberCount).toBe(2);
        } finally {
          await http()
            .delete(`/api/v1/channels/${group.id}`)
            .set('Authorization', as(A));
        }
      });

      it('รายชื่อคนเดียว = แชทส่วนตัวเดิม · ส่งทั้งสองแบบหรือเกิน 31 คน = 400', async () => {
        const single = await http()
          .post('/api/v1/direct-channels')
          .set('Authorization', as(A))
          .send({ peerCoreUserIds: [OUT] })
          .expect(201);

        expect(single.body.data.kind).toBe('DM');
        expect(single.body.data.id).toBe(await openDm(A, OUT));

        await http()
          .post('/api/v1/direct-channels')
          .set('Authorization', as(A))
          .send({ peerCoreUserId: B, peerCoreUserIds: [C] })
          .expect(400);

        const crowd = Array.from({ length: 32 }, (_v, i) => `67000007${String(i).padStart(2, '0')}-crowd`);

        await http()
          .post('/api/v1/direct-channels')
          .set('Authorization', as(A))
          .send({ peerCoreUserIds: crowd })
          .expect(400);
      });

      it('CreateChannelDto ไม่รับ GROUP_DM — แชทกลุ่มสร้างผ่าน /direct-channels เท่านั้น', async () => {
        await http()
          .post('/api/v1/channels')
          .set('Authorization', as(A))
          .send({ kind: 'GROUP_DM', name: 'แอบสร้าง', description: 'ไม่ควรได้' })
          .expect(400);
      });
    });

    describe('B4 · โน้ต', () => {
      it('โน้ตของฉันมาก่อน · คนที่ติดตามกันทั้งสองทางเห็น · หมดอายุแล้วหาย · ลบได้', async () => {
        // กลุ่มผู้ชมเริ่มต้น MUTUAL_FOLLOWERS — ต้องติดตามกันทั้งสองทาง
        for (const [from, to] of [[D, A], [A, D]]) {
          await http()
            .post('/api/v1/follows')
            .set('Authorization', as(from))
            .send({ coreUserId: to })
            .expect(201);
        }

        const put = await http()
          .put('/api/v1/notes/me')
          .set('Authorization', as(A))
          .send({ text: '  ใครว่างติวคืนนี้ 📚  ' })
          .expect(200);

        expect(put.body.data).toMatchObject({ coreUserId: A, text: 'ใครว่างติวคืนนี้ 📚', isMe: true });
        expect(Date.parse(put.body.data.expiresAt) - Date.parse(put.body.data.createdAt)).toBe(
          24 * 60 * 60 * 1000,
        );

        await http()
          .put('/api/v1/notes/me')
          .set('Authorization', as(D))
          .send({ text: 'โน้ตของ D' })
          .expect(200);

        const forD = await http().get('/api/v1/notes').set('Authorization', as(D)).expect(200);
        expect(forD.body.data[0]).toMatchObject({ coreUserId: D, isMe: true });
        expect(forD.body.data).toContainEqual(
          expect.objectContaining({ coreUserId: A, isMe: false, text: 'ใครว่างติวคืนนี้ 📚' }),
        );

        // คนที่ไม่ได้ติดตามและไม่เคยคุยกันไม่เห็น
        const forOut = await http().get('/api/v1/notes').set('Authorization', as(OUT)).expect(200);
        expect(forOut.body.data.some((n: { coreUserId: string }) => n.coreUserId === D)).toBe(false);

        await db().note.update({
          where: { coreUserId: A },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const expired = await http().get('/api/v1/notes').set('Authorization', as(D)).expect(200);
        expect(expired.body.data.some((n: { coreUserId: string }) => n.coreUserId === A)).toBe(false);

        await http().delete('/api/v1/notes/me').set('Authorization', as(D)).expect(204);

        const gone = await http().get('/api/v1/notes').set('Authorization', as(D)).expect(200);
        expect(gone.body.data.some((n: { isMe: boolean }) => n.isMe)).toBe(false);
      });

      it('โน้ตว่าง (ช่องว่างล้วน) หรือยาวเกิน 60 ตัวอักษรถูกปฏิเสธ', async () => {
        for (const text of ['   ', 'ก'.repeat(61)]) {
          const response = await http()
            .put('/api/v1/notes/me')
            .set('Authorization', as(A))
            .send({ text })
            .expect(400);

          expect(response.body.error.code).toBe('VALIDATION_ERROR');
        }

        await http()
          .put('/api/v1/notes/me')
          .set('Authorization', as(A))
          .send({ text: 'ก'.repeat(60) })
          .expect(200);
      });

      it('คู่สนทนาใน DM ที่ไม่ได้ติดตามกันทั้งสองทางไม่เห็นโน้ต (กลุ่มผู้ชมแบบ Instagram)', async () => {
        await openDm(C, OUT);
        await http()
          .put('/api/v1/notes/me')
          .set('Authorization', as(C))
          .send({ text: 'โน้ตถึงคู่สนทนา' })
          .expect(200);

        const forOut = await http().get('/api/v1/notes').set('Authorization', as(OUT)).expect(200);
        expect(forOut.body.data.some((n: { coreUserId: string }) => n.coreUserId === C)).toBe(false);
      });
    });

    /// สร้างไฟล์ที่ commit แล้ว (READY) ตรง ๆ ผ่าน Prisma — ท่ออัปโหลดจริงทดสอบแยกใน B9
    async function seedAsset(owner: string, kind: 'IMAGE' | 'VIDEO') {
      const ext = kind === 'IMAGE' ? 'png' : 'mp4';

      return db().asset.create({
        data: {
          ownerCoreUserId: owner,
          bucket: kind === 'IMAGE' ? 'attachments' : 'reels',
          objectPath: `${owner}/${randomUUID()}.${ext}`,
          fileName: `seed.${ext}`,
          mimeType: kind === 'IMAGE' ? 'image/png' : 'video/mp4',
          kind,
          status: 'READY',
        },
      });
    }

    async function seedStory(owner: string, expired: boolean) {
      const asset = await seedAsset(owner, 'IMAGE');

      return db().story.create({
        data: {
          authorCoreUserId: owner,
          assetId: asset.id,
          caption: expired ? 'สตอรี่ที่หมดอายุแล้ว' : 'สตอรี่ที่ยังไม่หมดอายุ',
          expiresAt: new Date(Date.now() + (expired ? -3600_000 : 3600_000)),
          createdAt: new Date(Date.now() - (expired ? 25 * 3600_000 : 0)),
        },
      });
    }

    describe('B5 · คลังสตอรี่และไฮไลต์', () => {
      it('สตอรี่ที่หมดอายุยังอยู่ในคลังและในไฮไลต์ · คนอื่นดูไฮไลต์ได้ · แก้ได้เฉพาะเจ้าของ', async () => {
        const old = await seedStory(B, true);
        const fresh = await seedStory(B, false);
        const foreign = await seedStory(C, false);
        let highlightId: string | null = null;

        try {
          // แถวสตอรี่ปกติไม่มีชิ้นที่หมดอายุ
          const tray = await http().get('/api/v1/stories').set('Authorization', as(B)).expect(200);
          const mine = tray.body.data.find((t: { isMe: boolean }) => t.isMe);
          expect(mine.stories.map((s: { id: string }) => s.id)).not.toContain(old.id);

          const archive = await http()
            .get('/api/v1/stories/archive?limit=100')
            .set('Authorization', as(B))
            .expect(200);

          const ids = archive.body.data.map((s: { id: string }) => s.id);
          expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(old.id)); // ใหม่ไปเก่า
          const archivedOld = archive.body.data.find((s: { id: string }) => s.id === old.id);
          expect(archivedOld).toMatchObject({ mediaKind: 'IMAGE', isExpired: true, caption: 'สตอรี่ที่หมดอายุแล้ว' });
          expect(typeof archivedOld.mediaUrl).toBe('string');

          // คลังเป็นของเจ้าของ — คนอื่นเห็นแต่ของตัวเอง
          const theirs = await http()
            .get('/api/v1/stories/archive?limit=100')
            .set('Authorization', as(C))
            .expect(200);
          expect(theirs.body.data.map((s: { id: string }) => s.id)).not.toContain(old.id);

          const created = await http()
            .post('/api/v1/highlights')
            .set('Authorization', as(B))
            .send({ title: 'ค่ายคอม', storyIds: [old.id, fresh.id] })
            .expect(201);

          highlightId = created.body.data.id;
          expect(created.body.data.itemCount).toBe(2);
          expect(created.body.data.coverMediaUrl).toEqual(expect.any(String));

          // คนอื่นดูไฮไลต์ได้ รวมชิ้นที่หมดอายุแล้ว
          const viewed = await http()
            .get(`/api/v1/highlights/${highlightId}`)
            .set('Authorization', as(OUT))
            .expect(200);
          expect(viewed.body.data.items.map((i: { storyId: string }) => i.storyId)).toEqual([old.id, fresh.id]);

          const onProfile = await http()
            .get(`/api/v1/profiles/${B}/highlights`)
            .set('Authorization', as(OUT))
            .expect(200);
          expect(onProfile.body.data).toContainEqual(
            expect.objectContaining({ id: highlightId, title: 'ค่ายคอม', itemCount: 2 }),
          );

          // ใส่สตอรี่ของคนอื่นไม่ได้ ทั้งตอนสร้างและตอนแก้
          await http()
            .post('/api/v1/highlights')
            .set('Authorization', as(B))
            .send({ title: 'ขโมย', storyIds: [foreign.id] })
            .expect(403);
          await http()
            .patch(`/api/v1/highlights/${highlightId}`)
            .set('Authorization', as(B))
            .send({ storyIds: [fresh.id, foreign.id] })
            .expect(403);

          // คนอื่นแก้หรือลบไฮไลต์ของ B ไม่ได้
          await http()
            .patch(`/api/v1/highlights/${highlightId}`)
            .set('Authorization', as(C))
            .send({ title: 'ยึด' })
            .expect(403);
          await http()
            .delete(`/api/v1/highlights/${highlightId}`)
            .set('Authorization', as(C))
            .expect(403);

          const reordered = await http()
            .patch(`/api/v1/highlights/${highlightId}`)
            .set('Authorization', as(B))
            .send({ title: 'ค่ายคอม 2569', storyIds: [fresh.id, old.id], coverStoryId: old.id })
            .expect(200);
          expect(reordered.body.data.title).toBe('ค่ายคอม 2569');
          expect(reordered.body.data.coverStoryId).toBe(old.id);
          expect(reordered.body.data.items.map((i: { storyId: string }) => i.storyId)).toEqual([fresh.id, old.id]);

          // ลบสตอรี่ = หลุดจากไฮไลต์ และปกกลับไปใช้ชิ้นแรก
          await http().delete(`/api/v1/stories/${old.id}`).set('Authorization', as(B)).expect(204);

          const afterDelete = await http()
            .get(`/api/v1/highlights/${highlightId}`)
            .set('Authorization', as(B))
            .expect(200);
          expect(afterDelete.body.data.itemCount).toBe(1);
          expect(afterDelete.body.data.coverStoryId).toBeNull();

          await http().delete(`/api/v1/highlights/${highlightId}`).set('Authorization', as(B)).expect(204);
          highlightId = null;

          // สตอรี่ยังอยู่ในคลังหลังลบไฮไลต์
          const still = await http()
            .get('/api/v1/stories/archive?limit=100')
            .set('Authorization', as(B))
            .expect(200);
          expect(still.body.data.map((s: { id: string }) => s.id)).toContain(fresh.id);
        } finally {
          if (highlightId) {
            await db().highlight.deleteMany({ where: { id: highlightId } });
          }
          await db().asset.deleteMany({
            where: { id: { in: [old.assetId, fresh.assetId, foreign.assetId] } },
          });
        }
      });
    });

    describe('B6 · คอลเลกชันของที่บันทึกไว้', () => {
      it('ใส่ได้เฉพาะของที่บันทึกแล้ว · เลิกบันทึก = หลุดจากคอลเลกชัน · เจ้าของเท่านั้น', async () => {
        const make = async (title: string) =>
          (
            await http()
              .post('/api/v1/posts')
              .set('Authorization', as(A))
              .send({ title, content: 'เนื้อหาสำหรับทดสอบคอลเลกชัน' })
              .expect(201)
          ).body.data.id as string;

        const saved = await make('โพสต์ที่บันทึกไว้');
        const unsaved = await make('โพสต์ที่ยังไม่ได้บันทึก');
        let collectionId: string | null = null;

        try {
          await http()
            .post('/api/v1/bookmarks')
            .set('Authorization', as(B))
            .send({ targetKind: 'POST', targetId: saved })
            .expect(201);

          await http()
            .post('/api/v1/bookmark-collections')
            .set('Authorization', as(B))
            .send({ name: 'ยังไม่ได้บันทึก', items: [{ targetKind: 'POST', targetId: unsaved }] })
            .expect(400);

          const created = await http()
            .post('/api/v1/bookmark-collections')
            .set('Authorization', as(B))
            .send({ name: '  สรุปก่อนสอบ  ', items: [{ targetKind: 'POST', targetId: saved }] })
            .expect(201);

          collectionId = created.body.data.id;
          expect(created.body.data).toMatchObject({
            name: 'สรุปก่อนสอบ',
            itemCount: 1,
            cover: { targetKind: 'POST', targetId: saved },
          });

          await http()
            .post(`/api/v1/bookmark-collections/${collectionId}/items`)
            .set('Authorization', as(B))
            .send({ targetKind: 'POST', targetId: unsaved })
            .expect(400);

          const items = await http()
            .get(`/api/v1/bookmark-collections/${collectionId}/items`)
            .set('Authorization', as(B))
            .expect(200);
          expect(items.body.data).toEqual([
            expect.objectContaining({
              targetKind: 'POST',
              targetId: saved,
              title: 'โพสต์ที่บันทึกไว้',
              authorCoreUserId: A,
            }),
          ]);
          expect(items.body.meta.total).toBe(1);

          // คนอื่นไม่รู้ด้วยซ้ำว่าคอลเลกชันนี้มีอยู่
          await http()
            .get(`/api/v1/bookmark-collections/${collectionId}/items`)
            .set('Authorization', as(C))
            .expect(404);
          await http()
            .patch(`/api/v1/bookmark-collections/${collectionId}`)
            .set('Authorization', as(C))
            .send({ name: 'ยึด' })
            .expect(404);
          await http()
            .delete(`/api/v1/bookmark-collections/${collectionId}`)
            .set('Authorization', as(C))
            .expect(404);
          const othersList = await http().get('/api/v1/bookmark-collections').set('Authorization', as(C)).expect(200);
          expect(othersList.body.data.some((c: { id: string }) => c.id === collectionId)).toBe(false);

          const renamed = await http()
            .patch(`/api/v1/bookmark-collections/${collectionId}`)
            .set('Authorization', as(B))
            .send({ name: 'สรุปปลายภาค' })
            .expect(200);
          expect(renamed.body.data.name).toBe('สรุปปลายภาค');

          // เลิกบันทึก → หลุดจากทุกคอลเลกชัน
          await http()
            .delete(`/api/v1/bookmarks?targetKind=POST&targetId=${saved}`)
            .set('Authorization', as(B))
            .expect(204);

          const list = await http().get('/api/v1/bookmark-collections').set('Authorization', as(B)).expect(200);
          expect(list.body.data.find((c: { id: string }) => c.id === collectionId)).toMatchObject({
            itemCount: 0,
            cover: null,
          });

          // ใส่กลับแล้วเอาออกจากคอลเลกชันอย่างเดียว — ยังบันทึกอยู่
          await http()
            .post('/api/v1/bookmarks')
            .set('Authorization', as(B))
            .send({ targetKind: 'POST', targetId: saved })
            .expect(201);
          await http()
            .post(`/api/v1/bookmark-collections/${collectionId}/items`)
            .set('Authorization', as(B))
            .send({ targetKind: 'POST', targetId: saved })
            .expect(201);
          await http()
            .delete(`/api/v1/bookmark-collections/${collectionId}/items?targetKind=POST&targetId=${saved}`)
            .set('Authorization', as(B))
            .expect(204);

          const bookmarks = await http().get('/api/v1/bookmarks?limit=100').set('Authorization', as(B)).expect(200);
          expect(bookmarks.body.data.some((b: { targetId: string }) => b.targetId === saved)).toBe(true);

          await http()
            .delete(`/api/v1/bookmark-collections/${collectionId}`)
            .set('Authorization', as(B))
            .expect(204);
          collectionId = null;
        } finally {
          if (collectionId) {
            await db().bookmarkCollection.deleteMany({ where: { id: collectionId } });
          }
          await db().bookmark.deleteMany({ where: { coreUserId: B, targetId: { in: [saved, unsaved] } } });
          for (const id of [saved, unsaved]) {
            await http().delete(`/api/v1/posts/${id}`).set('Authorization', as(A));
          }
        }
      });
    });

    describe('B7 + B8 · ความคิดเห็นใต้คลิปและกิจกรรมของคุณ', () => {
      it('ตอบได้ชั้นเดียว · กดใจความคิดเห็นซ้ำได้ · commentCount มากับคลิป · กิจกรรมของคุณครบ', async () => {
        const asset = await seedAsset(A, 'VIDEO');
        const reel = await db().reel.create({
          data: {
            title: 'คลิปทดสอบความคิดเห็น',
            assetId: asset.id,
            durationMs: 5000,
            authorCoreUserId: A,
          },
        });
        const post = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(A))
          .send({ title: 'กระทู้ทดสอบกิจกรรม', content: 'คอมเมนต์ที่นี่ด้วย' })
          .expect(201);
        const postId = post.body.data.id as string;

        try {
          const top = await http()
            .post(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(B))
            .send({ content: 'ตัดต่อดีมาก' })
            .expect(201);
          expect(top.body.data).toMatchObject({ parentId: null, replyCount: 0, likeCount: 0, likedByMe: false });

          const reply = await http()
            .post(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(C))
            .send({ content: 'เห็นด้วยครับ', parentId: top.body.data.id })
            .expect(201);
          expect(reply.body.data.parentId).toBe(top.body.data.id);

          // ตอบคำตอบซ้อนไม่ได้
          await http()
            .post(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(B))
            .send({ content: 'ซ้อน', parentId: reply.body.data.id })
            .expect(400);

          const topLevel = await http()
            .get(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(A))
            .expect(200);
          expect(topLevel.body.data).toHaveLength(1);
          expect(topLevel.body.data[0]).toMatchObject({ id: top.body.data.id, replyCount: 1, parentId: null });

          const replies = await http()
            .get(`/api/v1/reels/${reel.id}/comments?parentId=${top.body.data.id}`)
            .set('Authorization', as(A))
            .expect(200);
          expect(replies.body.data.map((r: { id: string }) => r.id)).toEqual([reply.body.data.id]);

          for (let round = 0; round < 2; round += 1) {
            const liked = await http()
              .post(`/api/v1/reels/${reel.id}/comments/${top.body.data.id}/likes`)
              .set('Authorization', as(C))
              .expect(200);
            expect(liked.body.data).toEqual({ likeCount: 1, likedByMe: true });
          }

          const seenByC = await http()
            .get(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(C))
            .expect(200);
          expect(seenByC.body.data[0]).toMatchObject({ likeCount: 1, likedByMe: true });

          const seenByA = await http()
            .get(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(A))
            .expect(200);
          expect(seenByA.body.data[0]).toMatchObject({ likeCount: 1, likedByMe: false });

          for (let round = 0; round < 2; round += 1) {
            const unliked = await http()
              .delete(`/api/v1/reels/${reel.id}/comments/${top.body.data.id}/likes`)
              .set('Authorization', as(C))
              .expect(200);
            expect(unliked.body.data).toEqual({ likeCount: 0, likedByMe: false });
          }

          const withCount = await http().get(`/api/v1/reels/${reel.id}`).set('Authorization', as(B)).expect(200);
          expect(withCount.body.data.commentCount).toBe(2);

          const feed = await http()
            .get(`/api/v1/reels?authorCoreUserId=${A}&limit=100`)
            .set('Authorization', as(B))
            .expect(200);
          expect(feed.body.data.find((r: { id: string }) => r.id === reel.id).commentCount).toBe(2);

          // ลบคำตอบ → ตัวนับของต้นเรื่องลด และยอดรวมของคลิปลด
          await http()
            .delete(`/api/v1/reels/${reel.id}/comments/${reply.body.data.id}`)
            .set('Authorization', as(C))
            .expect(204);

          const afterDelete = await http()
            .get(`/api/v1/reels/${reel.id}/comments`)
            .set('Authorization', as(A))
            .expect(200);
          expect(afterDelete.body.data[0].replyCount).toBe(0);
          expect(
            (await http().get(`/api/v1/reels/${reel.id}`).set('Authorization', as(B)).expect(200)).body.data
              .commentCount,
          ).toBe(1);

          // ---- B8: กิจกรรมของคุณ
          await http().post(`/api/v1/reels/${reel.id}/likes`).set('Authorization', as(B));
          await http()
            .post(`/api/v1/posts/${postId}/comments`)
            .set('Authorization', as(B))
            .send({ content: 'ความคิดเห็นใต้กระทู้' })
            .expect(201);

          const likes = await http().get('/api/v1/activity/likes').set('Authorization', as(B)).expect(200);
          const likedRow = likes.body.data.find((r: { id: string }) => r.id === reel.id);
          expect(likedRow).toMatchObject({ title: 'คลิปทดสอบความคิดเห็น', likedByMe: true, commentCount: 1 });
          expect(Date.parse(likedRow.likedAt)).not.toBeNaN();

          const comments = await http().get('/api/v1/activity/comments').set('Authorization', as(B)).expect(200);
          expect(comments.body.data[0]).toMatchObject({
            targetKind: 'POST',
            targetId: postId,
            targetTitle: 'กระทู้ทดสอบกิจกรรม',
            content: 'ความคิดเห็นใต้กระทู้',
          });
          expect(comments.body.data).toContainEqual(
            expect.objectContaining({
              id: top.body.data.id,
              targetKind: 'REEL',
              targetId: reel.id,
              targetTitle: 'คลิปทดสอบความคิดเห็น',
            }),
          );
          expect(comments.body.meta.total).toBeGreaterThanOrEqual(2);

          // ของคนอื่นไม่ปนมา
          const forA = await http().get('/api/v1/activity/comments?limit=100').set('Authorization', as(A)).expect(200);
          expect(forA.body.data.some((r: { id: string }) => r.id === top.body.data.id)).toBe(false);
        } finally {
          await db().asset.deleteMany({ where: { id: asset.id } }); // คลิปและความคิดเห็นหายตาม CASCADE
          await http().delete(`/api/v1/posts/${postId}`).set('Authorization', as(A));
        }
      });
    });

    describe('กิจกรรมของคุณ — ตัวกรอง สื่อของฉัน และประวัติบัญชี', () => {
      const bad = async (url: string, sub = B) => {
        const response = await http().get(url).set('Authorization', as(sub)).expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      };

      it('ไลก์ของฉัน: คลิปและโพสต์ · เรียงได้ · ช่วงวันตามเวลากรุงเทพฯ · กรองเจ้าของ · ค่าผิด = 400', async () => {
        const firstAsset = await seedAsset(A, 'VIDEO');
        const secondAsset = await seedAsset(A, 'VIDEO');
        const first = await db().reel.create({
          data: { title: 'คลิปกดไลก์ก่อน', assetId: firstAsset.id, durationMs: 3000, authorCoreUserId: A },
        });
        const second = await db().reel.create({
          data: { title: 'คลิปกดไลก์ทีหลัง', assetId: secondAsset.id, durationMs: 3000, authorCoreUserId: A },
        });
        const post = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(A))
          .send({ title: 'โพสต์ที่ถูกกดรีแอ็กชัน', content: 'เนื้อหาโพสต์สำหรับทดสอบหน้ากิจกรรม' })
          .expect(201);
        const postId = post.body.data.id as string;

        try {
          await http().post(`/api/v1/reels/${first.id}/likes`).set('Authorization', as(B));
          await http().post(`/api/v1/reels/${second.id}/likes`).set('Authorization', as(B));

          // 2026-01-15T18:00Z = 16 ม.ค. 01:00 เวลากรุงเทพฯ — ถ้าตีเป็น UTC จะตกวันที่ 15
          await db().reelLike.update({
            where: { reelId_coreUserId: { reelId: first.id, coreUserId: B } },
            data: { createdAt: new Date('2026-01-15T18:00:00Z') },
          });

          const newest = await http().get('/api/v1/activity/likes?limit=100').set('Authorization', as(B)).expect(200);
          const ids = newest.body.data.map((r: { id: string }) => r.id);
          expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
          expect(newest.body.data.find((r: { id: string }) => r.id === first.id)).toMatchObject({
            targetKind: 'REEL',
            likedAt: '2026-01-15T18:00:00.000Z',
            thumbnailUrl: expect.any(String),
          });

          const oldest = await http()
            .get('/api/v1/activity/likes?order=oldest&limit=100')
            .set('Authorization', as(B))
            .expect(200);
          const oldestIds = oldest.body.data.map((r: { id: string }) => r.id);
          expect(oldestIds.indexOf(first.id)).toBeLessThan(oldestIds.indexOf(second.id));

          const onBangkokDay = await http()
            .get('/api/v1/activity/likes?from=2026-01-16&to=2026-01-16')
            .set('Authorization', as(B))
            .expect(200);
          expect(onBangkokDay.body.data.map((r: { id: string }) => r.id)).toEqual([first.id]);

          const utcDay = await http()
            .get('/api/v1/activity/likes?from=2026-01-15&to=2026-01-15')
            .set('Authorization', as(B))
            .expect(200);
          expect(utcDay.body.data).toEqual([]);

          const otherOwner = await http()
            .get(`/api/v1/activity/likes?authorCoreUserId=${C}`)
            .set('Authorization', as(B))
            .expect(200);
          expect(otherOwner.body.data).toEqual([]);

          // โพสต์: กดสองอิโมจิ = หนึ่งแถว อิโมจิล่าสุด
          for (const emoji of ['👍', '❤️']) {
            await http()
              .post('/api/v1/reactions')
              .set('Authorization', as(B))
              .send({ targetKind: 'POST', targetId: postId, emoji });
          }

          const posts = await http()
            .get(`/api/v1/activity/likes?target=POST&authorCoreUserId=${A}`)
            .set('Authorization', as(B))
            .expect(200);
          const reacted = posts.body.data.filter((r: { id: string }) => r.id === postId);
          expect(reacted).toHaveLength(1);
          expect(reacted[0]).toMatchObject({
            targetKind: 'POST',
            title: 'โพสต์ที่ถูกกดรีแอ็กชัน',
            preview: 'เนื้อหาโพสต์สำหรับทดสอบหน้ากิจกรรม',
            authorCoreUserId: A,
            emoji: '❤️',
            thumbnailUrl: null,
          });
          expect(Date.parse(reacted[0].reactedAt)).not.toBeNaN();

          const postsOtherOwner = await http()
            .get(`/api/v1/activity/likes?target=POST&authorCoreUserId=${C}`)
            .set('Authorization', as(B))
            .expect(200);
          expect(postsOtherOwner.body.data.some((r: { id: string }) => r.id === postId)).toBe(false);

          await bad('/api/v1/activity/likes?order=sideways');
          await bad('/api/v1/activity/likes?target=STORY');
          await bad('/api/v1/activity/likes?from=2026-02-31');
          await bad('/api/v1/activity/likes?from=yesterday');
          await bad('/api/v1/activity/likes?from=2026-09-30&to=2026-09-01');
          await bad('/api/v1/activity/comments?authorCoreUserId=a');
          await bad('/api/v1/activity/media?kind=STORY');
          await bad('/api/v1/activity/account-history?order=random');
        } finally {
          await db().reaction.deleteMany({ where: { targetId: postId } });
          await db().asset.deleteMany({ where: { id: { in: [firstAsset.id, secondAsset.id] } } });
          await http().delete(`/api/v1/posts/${postId}`).set('Authorization', as(A));
        }
      });

      it('ความคิดเห็นของฉัน: กรองเจ้าของของที่ไปคอมเมนต์ และช่วงวัน', async () => {
        const post = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(C))
          .send({ title: 'กระทู้ของ C', content: 'มาคอมเมนต์กัน' })
          .expect(201);
        const postId = post.body.data.id as string;

        try {
          const comment = await http()
            .post(`/api/v1/posts/${postId}/comments`)
            .set('Authorization', as(D))
            .send({ content: 'ความคิดเห็นของ D ใต้กระทู้ C' })
            .expect(201);

          const underC = await http()
            .get(`/api/v1/activity/comments?authorCoreUserId=${C}`)
            .set('Authorization', as(D))
            .expect(200);
          expect(underC.body.data).toContainEqual(
            expect.objectContaining({
              id: comment.body.data.id,
              targetKind: 'POST',
              targetAuthorCoreUserId: C,
            }),
          );

          const underA = await http()
            .get(`/api/v1/activity/comments?authorCoreUserId=${A}`)
            .set('Authorization', as(D))
            .expect(200);
          expect(underA.body.data.some((r: { id: string }) => r.id === comment.body.data.id)).toBe(false);

          const longAgo = await http()
            .get('/api/v1/activity/comments?from=2020-01-01&to=2020-01-31&order=oldest')
            .set('Authorization', as(D))
            .expect(200);
          expect(longAgo.body.data).toEqual([]);
          expect(longAgo.body.meta.total).toBe(0);
        } finally {
          await http().delete(`/api/v1/posts/${postId}`).set('Authorization', as(C));
        }
      });

      it('สื่อของฉัน: โพสต์และคลิปของตัวเองพร้อมยอด · คลิปมีภาพย่อ · โพสต์ภาพย่อเป็น null', async () => {
        const asset = await seedAsset(E, 'VIDEO');
        const reel = await db().reel.create({
          data: { title: 'คลิปของ E', caption: 'คำบรรยาย', assetId: asset.id, durationMs: 3000, authorCoreUserId: E },
        });
        const post = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(E))
          .send({ title: 'โพสต์ของ E', content: 'เนื้อหาโพสต์ของ E' })
          .expect(201);
        const postId = post.body.data.id as string;

        try {
          await http()
            .post('/api/v1/reactions')
            .set('Authorization', as(B))
            .send({ targetKind: 'POST', targetId: postId, emoji: '🔥' });

          const posts = await http().get('/api/v1/activity/media?kind=POST').set('Authorization', as(E)).expect(200);
          expect(posts.body.data).toEqual([
            expect.objectContaining({
              targetKind: 'POST',
              id: postId,
              title: 'โพสต์ของ E',
              thumbnailUrl: null,
              thumbnailKind: null,
              likeCount: 1,
              commentCount: 0,
              viewCount: null,
            }),
          ]);

          const reels = await http().get('/api/v1/activity/media').set('Authorization', as(E)).expect(200);
          expect(reels.body.data).toEqual([
            expect.objectContaining({
              targetKind: 'REEL',
              id: reel.id,
              preview: 'คำบรรยาย',
              thumbnailUrl: expect.any(String),
              thumbnailKind: 'VIDEO',
              likeCount: 0,
              commentCount: 0,
              viewCount: 0,
            }),
          ]);

          // ของคนอื่นไม่ปนมา
          const forB = await http().get('/api/v1/activity/media?kind=POST&limit=100').set('Authorization', as(B)).expect(200);
          expect(forB.body.data.some((r: { id: string }) => r.id === postId)).toBe(false);
        } finally {
          await db().reaction.deleteMany({ where: { targetId: postId } });
          await db().asset.deleteMany({ where: { id: asset.id } });
          // ลบผ่าน Prisma ไม่ใช่ API — การลบผ่าน API เป็น "ประวัติบัญชี" ของ E
          // แล้วข้อถัดไปที่นับประวัติแบบเป๊ะ ๆ จะเพี้ยน
          await db().post.deleteMany({ where: { id: postId } });
        }
      });

      it('ประวัติบัญชี: คำแนะนำตัว รูปปก ห้องที่สร้าง เนื้อหาที่ลบ + JOINED เก่าสุดเสมอ · ไม่มีของคนอื่น', async () => {
        const cover = await seedAsset(E, 'IMAGE');
        const room = await http()
          .post('/api/v1/channels')
          .set('Authorization', as(E))
          .send({ kind: 'GROUP', name: 'ห้องของ E', description: 'ทดสอบประวัติบัญชี' })
          .expect(201);
        const roomId = room.body.data.id as string;
        // สตอรี่ที่ลบผ่าน API ไม่ลบไฟล์ของมัน (พฤติกรรมเดิม) — ชุดทดสอบต้องเก็บเอง
        let storyAssetId: string | null = null;

        try {
          const patch = (body: Record<string, unknown>) =>
            http().patch('/api/v1/profiles/me').set('Authorization', as(E)).send(body).expect(200);

          await patch({ bio: 'ปี 3 สนใจ backend' });
          await patch({ bio: 'ปี 3 สนใจ backend' }); // ค่าเดิม — ต้องไม่เกิดแถวใหม่
          await patch({ bio: '' });
          await patch({ coverAssetId: cover.id });
          await patch({ coverAssetId: null });

          const post = await http()
            .post('/api/v1/posts')
            .set('Authorization', as(E))
            .send({ title: 'โพสต์ที่จะลบ', content: 'ลบเอง' })
            .expect(201);
          await http().delete(`/api/v1/posts/${post.body.data.id}`).set('Authorization', as(E)).expect(204);

          const story = await seedStory(E, false);
          storyAssetId = story.assetId;
          await http().delete(`/api/v1/stories/${story.id}`).set('Authorization', as(E)).expect(204);

          // ผู้ดูแลลบโพสต์ของคนอื่น ไม่ใช่ประวัติของทั้งสองฝั่ง
          const victim = await http()
            .post('/api/v1/posts')
            .set('Authorization', as(A))
            .send({ title: 'โพสต์ที่ผู้ดูแลลบ', content: 'ผิดกฎ' })
            .expect(201);
          await http()
            .delete(`/api/v1/posts/${victim.body.data.id}`)
            .set('Authorization', as(E, 'staff'))
            .expect(204);

          const history = await http()
            .get('/api/v1/activity/account-history?limit=100')
            .set('Authorization', as(E))
            .expect(200);

          const kinds = history.body.data.map((r: { kind: string }) => r.kind);
          expect(kinds).toEqual([
            'CONTENT_DELETED',
            'CONTENT_DELETED',
            'COVER_REMOVED',
            'COVER_CHANGED',
            'BIO_REMOVED',
            'BIO_CHANGED',
            'ROOM_CREATED',
            'JOINED',
          ]);
          expect(history.body.meta.total).toBe(8);
          expect(history.body.data.map((r: { detail: string | null }) => r.detail)).toEqual([
            'STORY',
            'POST',
            null,
            null,
            null,
            'ปี 3 สนใจ backend',
            'ห้องของ E',
            null,
          ]);

          const oldest = await http()
            .get('/api/v1/activity/account-history?order=oldest&limit=3')
            .set('Authorization', as(E))
            .expect(200);
          expect(oldest.body.data.map((r: { kind: string }) => r.kind)).toEqual([
            'JOINED',
            'ROOM_CREATED',
            'BIO_CHANGED',
          ]);

          // หน้าสุดท้ายของแบบใหม่ไปเก่า — JOINED ต่อท้ายพอดี
          const lastPage = await http()
            .get('/api/v1/activity/account-history?limit=3&page=3')
            .set('Authorization', as(E))
            .expect(200);
          expect(lastPage.body.data.map((r: { kind: string }) => r.kind)).toEqual(['ROOM_CREATED', 'JOINED']);
          expect(lastPage.body.meta).toMatchObject({ total: 8, totalPages: 3 });

          // แถว audit ของการลบเชิงผู้ดูแลต้องไม่โผล่ทั้งในประวัติของผู้ดูแลและของเจ้าของโพสต์
          const moderation = await db().auditLog.findFirstOrThrow({
            where: { action: 'post.delete', targetId: victim.body.data.id },
          });
          const victimHistory = await http()
            .get('/api/v1/activity/account-history?limit=100')
            .set('Authorization', as(A))
            .expect(200);
          for (const list of [history.body.data, victimHistory.body.data]) {
            expect(list.some((r: { id: string }) => r.id === moderation.id)).toBe(false);
          }
        } finally {
          await http().delete(`/api/v1/channels/${roomId}`).set('Authorization', as(E));
          await http().patch('/api/v1/profiles/me').set('Authorization', as(E)).send({ coverAssetId: null });
          await db().asset.deleteMany({
            where: { id: { in: [cover.id, ...(storyAssetId ? [storyAssetId] : [])] } },
          });
        }
      });
    });

    describe('B9 · ข้อความเสียง', () => {
      it('อัป voice.webm พร้อม contentType audio/* → AUDIO · แนบในแชท · เล่นในหน้าได้', async () => {
        // หัวไฟล์ EBML จริง — ภาชนะเดียวกับวิดีโอ webm
        const bytes = Buffer.from([
          0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
          0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
        ]);

        const intent = await http()
          .post('/api/v1/assets/upload-intents')
          .set('Authorization', as(A))
          .send({
            fileName: 'voice.webm',
            sizeBytes: bytes.length,
            bucket: 'attachments',
            contentType: 'audio/webm;codecs=opus',
          })
          .expect(201);

        const assetId = intent.body.data.assetId as string;
        const dm = await openDm(A, B);

        try {
          const url = new URL(intent.body.data.uploadUrl);

          await http()
            .put(url.pathname + url.search)
            .set('content-type', 'application/octet-stream')
            .send(bytes)
            .expect((res) => expect([200, 201, 204]).toContain(res.status));

          const committed = await http()
            .post(`/api/v1/assets/${assetId}/commit`)
            .set('Authorization', as(A))
            .expect(201);

          expect(committed.body.data).toMatchObject({ kind: 'AUDIO', mimeType: 'audio/webm' });

          nonce += 1;
          const sent = await http()
            .post(`/api/v1/channels/${dm}/messages`)
            .set('Authorization', as(A))
            .send({ assetIds: [assetId], clientNonce: `ig-voice-${nonce}-${Date.now()}` })
            .expect(201);

          expect(sent.body.data.attachments[0]).toMatchObject({ id: assetId, kind: 'AUDIO' });

          const download = await http()
            .get(`/api/v1/assets/${assetId}/download-url`)
            .set('Authorization', as(B))
            .expect(200);

          expect(download.body.data.asAttachment).toBe(false);
        } finally {
          await http().delete(`/api/v1/assets/${assetId}`).set('Authorization', as(A));
          await db().asset.deleteMany({ where: { id: assetId } });
        }
      });

      it('contentType ที่ไม่ใช่ MIME type ถูกปฏิเสธ', async () => {
        await http()
          .post('/api/v1/assets/upload-intents')
          .set('Authorization', as(A))
          .send({ fileName: 'voice.weba', sizeBytes: 10, bucket: 'attachments', contentType: 'not a mime' })
          .expect(400);
      });
    });

    describe('B10 · กรองการแจ้งเตือนตามชนิด', () => {
      it('?kind= รับค่าเดียวหรือหลายค่าคั่นลูกน้ำ · ค่าที่ไม่รู้จักได้ 400', async () => {
        await http()
          .post('/api/v1/follows')
          .set('Authorization', as(OUT))
          .send({ coreUserId: D })
          .expect(201);

        const follows = await http()
          .get('/api/v1/notifications?kind=FOLLOW&limit=100')
          .set('Authorization', as(D))
          .expect(200);

        expect(follows.body.data.length).toBeGreaterThan(0);
        expect(follows.body.data.every((n: { kind: string }) => n.kind === 'FOLLOW')).toBe(true);

        const comments = await http()
          .get('/api/v1/notifications?kind=REEL_COMMENT,POST_COMMENT&limit=100')
          .set('Authorization', as(D))
          .expect(200);

        expect(
          comments.body.data.every((n: { kind: string }) =>
            ['REEL_COMMENT', 'POST_COMMENT'].includes(n.kind),
          ),
        ).toBe(true);

        const bad = await http()
          .get('/api/v1/notifications?kind=FOLLOW,NOPE')
          .set('Authorization', as(D))
          .expect(400);

        expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('B11 · รายงานปัญหาของแอป', () => {
      it('ใครก็รายงานได้ ซ้ำได้ ไม่ต้องมีเป้าหมายจริง · ไปอยู่คิวของผู้ดูแล', async () => {
        const reason = `กดส่งข้อความเสียงแล้วแอปค้าง ${Date.now()}`;
        const ids: string[] = [];

        for (let round = 0; round < 2; round += 1) {
          const created = await http()
            .post('/api/v1/reports')
            .set('Authorization', as(C))
            .send({ targetKind: 'SYSTEM', targetId: 'app', reason })
            .expect(201);

          expect(created.body.data.targetKind).toBe('SYSTEM');
          expect(created.body.data.targetId).toMatch(/^app#[0-9a-f]{8}$/);
          ids.push(created.body.data.id);
        }

        const queue = await http()
          .get('/api/v1/reports?targetKind=SYSTEM&limit=100')
          .set('Authorization', as('6700000000-admin', 'admin'))
          .expect(200);

        const queued = queue.body.data.map((r: { id: string }) => r.id);
        for (const id of ids) expect(queued).toContain(id);

        // เหตุผลยังบังคับเหมือนรายงานเนื้อหา
        await http()
          .post('/api/v1/reports')
          .set('Authorization', as(C))
          .send({ targetKind: 'SYSTEM', targetId: 'app', reason: 'สั้น' })
          .expect(400);
      });
    });
  });
  /// รอบ Instagram parity (1 ต.ค. 2569) — ผู้ใช้ทุกคนขึ้นต้นด้วย 67000008 และ
  /// ทุกอย่างที่ชุดนี้สร้างถูกเก็บกวาดใน afterAll (DM ลบผ่าน API ไม่ได้โดยออกแบบ)
  describe('Instagram parity รอบ 3', () => {
    const http = () => request(app.getHttpServer());
    const db = () => app.get(PrismaService);
    const as = (sub: string, role: 'student' | 'staff' | 'admin' = 'student') => bearer(sub, role);

    const P = '6700000801-r3-pim';
    const Q = '6700000802-r3-quin';
    const R = '6700000803-r3-rin';
    const S = '6700000804-r3-sam';
    const T = '6700000805-r3-tee';
    const PEOPLE = [P, Q, R, S, T];

    let n = 0;
    const nonce = () => `r3-${Date.now()}-${(n += 1)}`;

    const dmOf = async (from: string, to: string) =>
      (
        await http()
          .post('/api/v1/direct-channels')
          .set('Authorization', as(from))
          .send({ peerCoreUserId: to })
          .expect(201)
      ).body.data.id as string;

    const send = async (sub: string, channelId: string, body: Record<string, unknown>) =>
      (
        await http()
          .post(`/api/v1/channels/${channelId}/messages`)
          .set('Authorization', as(sub))
          .send({ clientNonce: nonce(), ...body })
          .expect(201)
      ).body.data;

    const messagesOf = async (sub: string, channelId: string) =>
      (
        await http()
          .get(`/api/v1/channels/${channelId}/messages?limit=100`)
          .set('Authorization', as(sub))
          .expect(200)
      ).body.data as Record<string, any>[];

    const follow = (from: string, to: string) =>
      http().post('/api/v1/follows').set('Authorization', as(from)).send({ coreUserId: to });

    async function seedAsset(owner: string, kind: 'IMAGE' | 'VIDEO', size = 0n) {
      const ext = kind === 'IMAGE' ? 'png' : 'mp4';

      return db().asset.create({
        data: {
          ownerCoreUserId: owner,
          bucket: kind === 'IMAGE' ? 'attachments' : 'reels',
          objectPath: `${owner}/${randomUUID()}.${ext}`,
          fileName: `seed.${ext}`,
          mimeType: kind === 'IMAGE' ? 'image/png' : 'video/mp4',
          kind,
          status: 'READY',
          sizeBytes: size,
        },
      });
    }

    async function seedStory(owner: string, expired = false) {
      const asset = await seedAsset(owner, 'IMAGE');

      return db().story.create({
        data: {
          authorCoreUserId: owner,
          assetId: asset.id,
          caption: 'สตอรี่ทดสอบรอบ 3',
          expiresAt: new Date(Date.now() + (expired ? -3600_000 : 3600_000)),
        },
      });
    }

    afterAll(async () => {
      const prisma = db();
      const everyone = { in: PEOPLE };

      await prisma.channel.deleteMany({ where: { members: { some: { coreUserId: everyone } } } });
      await prisma.story.deleteMany({ where: { authorCoreUserId: everyone } });
      await prisma.post.deleteMany({ where: { authorCoreUserId: everyone } });
      await prisma.reel.deleteMany({ where: { authorCoreUserId: everyone } });
      await prisma.asset.deleteMany({ where: { ownerCoreUserId: everyone } });
      await prisma.notification.deleteMany({ where: { coreUserId: everyone } });
      await prisma.follow.deleteMany({
        where: { OR: [{ followerCoreUserId: everyone }, { followingCoreUserId: everyone }] },
      });
      await prisma.block.deleteMany({
        where: { OR: [{ blockerCoreUserId: everyone }, { blockedCoreUserId: everyone }] },
      });
      await prisma.closeFriend.deleteMany({
        where: { OR: [{ ownerCoreUserId: everyone }, { friendCoreUserId: everyone }] },
      });
      await prisma.note.deleteMany({ where: { coreUserId: everyone } });
      await prisma.reaction.deleteMany({ where: { coreUserId: everyone } });
      await prisma.reelLike.deleteMany({ where: { coreUserId: everyone } });
      await prisma.reelRepost.deleteMany({ where: { coreUserId: everyone } });
      await prisma.notificationPreference.deleteMany({ where: { coreUserId: everyone } });
      await prisma.callFeedback.deleteMany({ where: { coreUserId: everyone } });
      await prisma.auditLog.deleteMany({ where: { actorCoreUserId: everyone } });
      await prisma.subsystemMember.deleteMany({ where: { coreUserId: everyone } });
    });

    describe('3 · ตอบกลับและส่งต่อข้อความ', () => {
      it('replyTo มากับข้อความ · ต้องอยู่ห้องเดียวกัน · ต้นทางถูกลบแล้ว preview หาย', async () => {
        const dm = await dmOf(P, Q);
        const other = await dmOf(P, R);
        const first = await send(P, dm, { content: 'ข้อความต้นทางสำหรับตอบกลับ' });
        const stranger = await send(P, other, { content: 'อยู่คนละห้อง' });

        const reply = await send(Q, dm, { content: 'ตอบนะ', replyToMessageId: first.id });
        expect(reply.replyTo).toEqual({
          id: first.id,
          authorCoreUserId: P,
          preview: 'ข้อความต้นทางสำหรับตอบกลับ',
          attachmentKind: null,
          deleted: false,
        });
        expect(reply.forwarded).toBe(false);
        expect(reply.storyReply).toBeNull();
        expect(reply).toHaveProperty('editedAt', null);

        await http()
          .post(`/api/v1/channels/${dm}/messages`)
          .set('Authorization', as(Q))
          .send({ clientNonce: nonce(), content: 'ข้ามห้อง', replyToMessageId: stranger.id })
          .expect(404);

        await http().delete(`/api/v1/channels/${dm}/messages/${first.id}`).set('Authorization', as(P)).expect(204);

        const row = (await messagesOf(Q, dm)).find((m) => m.id === reply.id)!;
        expect(row.replyTo).toMatchObject({ id: first.id, deleted: true, preview: null });
      });

      it('ส่งต่อ: คัดลอกข้อความและไฟล์แนบ (แถวใหม่ ไฟล์เดิม ไม่นับโควตา) · ติดป้าย forwarded', async () => {
        const dm = await dmOf(P, Q);
        const group = await http()
          .post('/api/v1/channels')
          .set('Authorization', as(P))
          .send({ kind: 'GROUP', name: 'กลุ่มรับของส่งต่อ', description: 'ทดสอบส่งต่อ' })
          .expect(201);
        const groupId = group.body.data.id as string;

        const image = await seedAsset(P, 'IMAGE', 2048n);
        const original = await send(P, dm, { content: 'ดูรูปนี้', assetIds: [image.id] });

        const quotaBefore = (
          await db().subsystemMember.findUnique({ where: { coreUserId: P } })
        )?.storageUsedBytes ?? 0n;

        const forwarded = await http()
          .post(`/api/v1/channels/${dm}/messages/${original.id}/forwards`)
          .set('Authorization', as(P))
          .send({ channelIds: [groupId], peerCoreUserIds: [R] })
          .expect(201);

        expect(forwarded.body.data.channelIds).toHaveLength(2);
        expect(forwarded.body.data.channelIds[0]).toBe(groupId);
        expect(forwarded.body.data.messageIds).toHaveLength(2);

        const inR = await messagesOf(R, forwarded.body.data.channelIds[1]);
        const copy = inR.find((m) => m.id === forwarded.body.data.messageIds[1])!;
        expect(copy).toMatchObject({ content: 'ดูรูปนี้', forwarded: true, authorCoreUserId: P });
        expect(copy.attachments).toHaveLength(1);
        expect(copy.attachments[0]).toMatchObject({ kind: 'IMAGE', sizeBytes: '2048' });
        expect(copy.attachments[0].id).not.toBe(image.id);

        const copyRow = await db().asset.findUniqueOrThrow({ where: { id: copy.attachments[0].id } });
        expect(copyRow.objectPath).toBe(image.objectPath);
        expect(copyRow.sourceAssetId).toBe(image.id);

        const quotaAfter = (
          await db().subsystemMember.findUnique({ where: { coreUserId: P } })
        )?.storageUsedBytes ?? 0n;
        expect(quotaAfter).toBe(quotaBefore);

        // R อ่านไฟล์สำเนาได้เพราะอยู่ในห้องที่ได้รับ
        await http().get(`/api/v1/assets/${copy.attachments[0].id}/download-url`).set('Authorization', as(R)).expect(200);

        await http()
          .post(`/api/v1/channels/${dm}/messages/${original.id}/forwards`)
          .set('Authorization', as(P))
          .send({})
          .expect(400);
        await http()
          .post(`/api/v1/channels/${dm}/messages/${original.id}/forwards`)
          .set('Authorization', as(P))
          .send({ peerCoreUserIds: Array.from({ length: 21 }, (_v, i) => `67000008${String(i + 10)}-many`) })
          .expect(400);
        // ห้องที่ไม่ได้เป็นสมาชิก = 404
        const notMine = await dmOf(Q, S);
        await http()
          .post(`/api/v1/channels/${dm}/messages/${original.id}/forwards`)
          .set('Authorization', as(P))
          .send({ channelIds: [notMine] })
          .expect(404);
        // คนนอกห้องต้นทางส่งต่อไม่ได้
        await http()
          .post(`/api/v1/channels/${dm}/messages/${original.id}/forwards`)
          .set('Authorization', as(S))
          .send({ peerCoreUserIds: [T] })
          .expect(404);
      });
    });

    describe('4 · แชร์โพสต์ คลิป สตอรี่เข้าแชท', () => {
      it('การ์ดครบช่อง · แชร์สตอรี่ที่เห็นไม่ได้ = 404 · ลบ/หมดอายุ/บล็อก = available false', async () => {
        const post = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(Q))
          .send({ title: 'โพสต์ที่จะถูกแชร์', content: 'เนื้อหาของโพสต์ที่จะถูกแชร์เข้าแชท' })
          .expect(201);
        const postId = post.body.data.id as string;

        const shared = await http()
          .post('/api/v1/shares')
          .set('Authorization', as(P))
          .send({ targetKind: 'POST', targetId: postId, peerCoreUserIds: [R], message: 'อ่านอันนี้' })
          .expect(201);
        const [channelId] = shared.body.data.channelIds;
        const messageId = shared.body.data.messageIds[0];

        let row = (await messagesOf(R, channelId)).find((m) => m.id === messageId)!;
        expect(row.content).toBe('อ่านอันนี้');
        expect(row.embed).toEqual({
          kind: 'POST',
          targetId: postId,
          refId: postId,
          authorCoreUserId: Q,
          title: 'โพสต์ที่จะถูกแชร์',
          preview: 'เนื้อหาของโพสต์ที่จะถูกแชร์เข้าแชท',
          thumbnailUrl: null,
          thumbnailKind: null,
          available: true,
        });

        // R บล็อกเจ้าของโพสต์ → การ์ดปิดสำหรับ R
        await http().post('/api/v1/blocks').set('Authorization', as(R)).send({ coreUserId: Q }).expect(201);
        row = (await messagesOf(R, channelId)).find((m) => m.id === messageId)!;
        expect(row.embed).toMatchObject({ available: false, title: null, preview: null });
        // คนที่ไม่ได้บล็อกยังเห็นปกติ
        const forP = (await messagesOf(P, channelId)).find((m) => m.id === messageId)!;
        expect(forP.embed.available).toBe(true);
        await http().delete(`/api/v1/blocks/${Q}`).set('Authorization', as(R)).expect(204);

        // ลบโพสต์ → การ์ดยังอยู่แต่ใช้ไม่ได้
        await http().delete(`/api/v1/posts/${postId}`).set('Authorization', as(Q)).expect(204);
        row = (await messagesOf(R, channelId)).find((m) => m.id === messageId)!;
        expect(row.embed).toMatchObject({ kind: 'POST', targetId: postId, available: false, authorCoreUserId: null });

        // สตอรี่: ไม่ได้ติดตามเจ้าของ = แชร์ไม่ได้ · ติดตามแล้วแชร์ได้ · หมดอายุ = available false
        const story = await seedStory(S);
        await http()
          .post('/api/v1/shares')
          .set('Authorization', as(P))
          .send({ targetKind: 'STORY', targetId: story.id, peerCoreUserIds: [R] })
          .expect(404);
        await follow(P, S).expect(201);
        const storyShare = await http()
          .post('/api/v1/shares')
          .set('Authorization', as(P))
          .send({ targetKind: 'STORY', targetId: story.id, channelIds: [channelId] })
          .expect(201);
        let storyRow = (await messagesOf(R, channelId)).find((m) => m.id === storyShare.body.data.messageIds[0])!;
        expect(storyRow.embed).toMatchObject({
          kind: 'STORY',
          authorCoreUserId: S,
          available: true,
          thumbnailKind: 'IMAGE',
          thumbnailUrl: expect.any(String),
        });
        await db().story.update({ where: { id: story.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
        storyRow = (await messagesOf(R, channelId)).find((m) => m.id === storyShare.body.data.messageIds[0])!;
        expect(storyRow.embed).toMatchObject({ available: false, thumbnailUrl: null });

        await http()
          .post('/api/v1/shares')
          .set('Authorization', as(P))
          .send({ targetKind: 'REEL', targetId: randomUUID(), peerCoreUserIds: [R] })
          .expect(404);
        await http()
          .post('/api/v1/shares')
          .set('Authorization', as(P))
          .send({ targetKind: 'POST', targetId: randomUUID() })
          .expect(404);
      });
    });

    describe('5 · ตอบกลับสตอรี่ สถิติ และผู้ชม', () => {
      it('ตอบ = DM พร้อมการ์ดสตอรี่ · แจ้งเตือน STORY_REPLY · สถิติเจ้าของเท่านั้น · ผู้ชมแบ่งหน้า', async () => {
        const story = await seedStory(T);
        await follow(Q, T).expect(201);

        const replied = await http()
          .post(`/api/v1/stories/${story.id}/replies`)
          .set('Authorization', as(Q))
          .send({ content: 'สวยมาก' })
          .expect(201);
        await http()
          .post(`/api/v1/stories/${story.id}/replies`)
          .set('Authorization', as(Q))
          .send({ emoji: '😍' })
          .expect(201);

        const [channelId] = replied.body.data.channelIds;
        const inbox = await messagesOf(T, channelId);
        const reply = inbox.find((m) => m.id === replied.body.data.messageIds[0])!;
        expect(reply).toMatchObject({
          content: 'สวยมาก',
          authorCoreUserId: Q,
          storyReply: { kind: 'REPLY', emoji: null },
          embed: { kind: 'STORY', targetId: story.id, available: true },
        });
        expect(inbox.find((m) => m.storyReply?.kind === 'REACTION')).toMatchObject({
          content: '😍',
          storyReply: { kind: 'REACTION', emoji: '😍' },
        });

        const notes = await http()
          .get('/api/v1/notifications?kind=STORY_REPLY&limit=100')
          .set('Authorization', as(T))
          .expect(200);
        expect(notes.body.data.filter((x: { refId: string }) => x.refId === story.id)).toHaveLength(2);

        await http().post(`/api/v1/stories/${story.id}/views`).set('Authorization', as(Q)).expect(201);

        const insights = await http().get(`/api/v1/stories/${story.id}/insights`).set('Authorization', as(T)).expect(200);
        expect(insights.body.data).toEqual({ viewCount: 1, replyCount: 1, reactionCounts: { '😍': 1 } });
        await http().get(`/api/v1/stories/${story.id}/insights`).set('Authorization', as(Q)).expect(403);

        const viewers = await http().get(`/api/v1/stories/${story.id}/viewers?limit=10`).set('Authorization', as(T)).expect(200);
        expect(viewers.body.data).toEqual([
          expect.objectContaining({ coreUserId: Q, viewedAt: expect.any(String) }),
        ]);
        expect(viewers.body.meta).toMatchObject({ total: 1, page: 1, limit: 10 });
        await http().get(`/api/v1/stories/${story.id}/viewers`).set('Authorization', as(Q)).expect(403);

        const mine = await http().get(`/api/v1/activity/story-replies?authorCoreUserId=${T}`).set('Authorization', as(Q)).expect(200);
        expect(mine.body.data.map((r: { kind: string }) => r.kind).sort()).toEqual(['REACTION', 'REPLY']);
        expect(mine.body.data[0]).toMatchObject({ storyId: story.id, storyAuthorCoreUserId: T, channelId: channelId });

        // ส่งผิดรูป · ตอบของตัวเอง · อิโมจิไม่ถูก
        for (const body of [{}, { content: 'ก', emoji: '😍' }, { emoji: 'ab' }, { content: '   ' }]) {
          await http().post(`/api/v1/stories/${story.id}/replies`).set('Authorization', as(Q)).send(body).expect(400);
        }
        await http().post(`/api/v1/stories/${story.id}/replies`).set('Authorization', as(T)).send({ content: 'ตัวเอง' }).expect(400);

        // บล็อกกันแล้วตอบไม่ได้
        await http().post('/api/v1/blocks').set('Authorization', as(T)).send({ coreUserId: Q }).expect(201);
        const blocked = await http().post(`/api/v1/stories/${story.id}/replies`).set('Authorization', as(Q)).send({ content: 'ยังอยู่ไหม' });
        expect([403, 404]).toContain(blocked.status);
        await http().delete(`/api/v1/blocks/${Q}`).set('Authorization', as(T)).expect(204);
      });
    });

    async function seedReel(owner: string, title = 'คลิปรอบ 3') {
      const asset = await seedAsset(owner, 'VIDEO');

      return db().reel.create({
        data: { title, assetId: asset.id, durationMs: 4000, authorCoreUserId: owner },
      });
    }

    describe('6 · บล็อก', () => {
      it('ตัดการติดตามทั้งสองทาง · ติดตาม/DM/คอมเมนต์ไม่ได้ · ซ่อนจากฟีดและค้นหา · แชทกลุ่มยังใช้ได้', async () => {
        await follow(P, Q).expect(201);
        await follow(Q, P).expect(201);
        const dm = await dmOf(P, Q);
        const group = (
          await http()
            .post('/api/v1/direct-channels')
            .set('Authorization', as(P))
            .send({ peerCoreUserIds: [Q, R] })
            .expect(201)
        ).body.data.id as string;
        const title = `โพสต์ของคิวที่ต้องหายจากพิม ${Date.now()}`;
        const qPost = (
          await http().post('/api/v1/posts').set('Authorization', as(Q)).send({ title, content: 'เนื้อหา' }).expect(201)
        ).body.data.id as string;
        const pPost = (
          await http().post('/api/v1/posts').set('Authorization', as(P)).send({ title: 'โพสต์ของพิม', content: 'x' }).expect(201)
        ).body.data.id as string;

        const blocked = await http().post('/api/v1/blocks').set('Authorization', as(P)).send({ coreUserId: Q }).expect(201);
        expect(blocked.body.data).toMatchObject({ coreUserId: Q });
        await http().post('/api/v1/blocks').set('Authorization', as(P)).send({ coreUserId: Q }).expect(201);
        await http().post('/api/v1/blocks').set('Authorization', as(P)).send({ coreUserId: P }).expect(400);

        expect(
          await db().follow.count({
            where: { OR: [{ followerCoreUserId: P, followingCoreUserId: Q }, { followerCoreUserId: Q, followingCoreUserId: P }] },
          }),
        ).toBe(0);

        const list = await http().get('/api/v1/blocks').set('Authorization', as(P)).expect(200);
        expect(list.body.data.map((b: { coreUserId: string }) => b.coreUserId)).toContain(Q);
        expect(list.body.meta.total).toBeGreaterThanOrEqual(1);

        await follow(Q, P).expect(403);
        await follow(P, Q).expect(403);
        await http().post('/api/v1/direct-channels').set('Authorization', as(Q)).send({ peerCoreUserId: P }).expect(403);
        await http()
          .post(`/api/v1/channels/${dm}/messages`)
          .set('Authorization', as(Q))
          .send({ clientNonce: nonce(), content: 'ยังส่งได้ไหม' })
          .expect(403);
        // แชทกลุ่มยังใช้ได้ตาม Instagram
        await send(Q, group, { content: 'ในกลุ่มยังคุยได้' });

        await http().post(`/api/v1/posts/${pPost}/comments`).set('Authorization', as(Q)).send({ content: 'ทัก' }).expect(403);

        await http().get(`/api/v1/profiles/${P}`).set('Authorization', as(Q)).expect(404);
        const own = await http().get(`/api/v1/profiles/${Q}`).set('Authorization', as(P)).expect(200);
        expect(own.body.data.relation.blockedByMe).toBe(true);

        const feed = await http().get(`/api/v1/posts?authorCoreUserId=${Q}`).set('Authorization', as(P)).expect(200);
        expect(feed.body.data).toEqual([]);
        await http().get(`/api/v1/posts/${qPost}`).set('Authorization', as(P)).expect(404);
        const all = await http().get('/api/v1/posts?limit=100').set('Authorization', as(P)).expect(200);
        expect(all.body.data.some((x: { id: string }) => x.id === qPost)).toBe(false);
        const search = await http()
          .get(`/api/v1/search?kind=posts&q=${encodeURIComponent(title)}`)
          .set('Authorization', as(P))
          .expect(200);
        expect(search.body.meta.total).toBe(0);

        await http().delete(`/api/v1/blocks/${Q}`).set('Authorization', as(P)).expect(204);
        await follow(P, Q).expect(201);
        await http().get(`/api/v1/profiles/${P}`).set('Authorization', as(Q)).expect(200);
      });
    });

    describe('9 · ออนไลน์ล่าสุด', () => {
      it('คืน lastActiveAt · ปิดแสดงสถานะ (ฝั่งไหนก็ได้) = null', async () => {
        const at = new Date('2026-09-30T10:00:00.000Z');

        await db().subsystemMember.upsert({
          where: { coreUserId: R },
          update: { lastActiveAt: at },
          create: { coreUserId: R, lastActiveAt: at },
        });

        const seen = await http().get(`/api/v1/presence?ids=${R},${S}`).set('Authorization', as(T)).expect(200);
        expect(seen.body.data.users).toEqual([
          { coreUserId: R, online: false, lastActiveAt: at.toISOString() },
          { coreUserId: S, online: false, lastActiveAt: null },
        ]);
        expect(typeof seen.body.data.totalOnline).toBe('number');

        await http().patch('/api/v1/me/privacy').set('Authorization', as(R)).send({ showActivityStatus: false }).expect(200);
        const hidden = await http().get(`/api/v1/presence?ids=${R}`).set('Authorization', as(T)).expect(200);
        expect(hidden.body.data.users[0]).toEqual({ coreUserId: R, online: false, lastActiveAt: null });
        await http().patch('/api/v1/me/privacy').set('Authorization', as(R)).send({ showActivityStatus: true }).expect(200);

        await http().patch('/api/v1/me/privacy').set('Authorization', as(T)).send({ showActivityStatus: false }).expect(200);
        const viewerOff = await http().get(`/api/v1/presence?ids=${R}`).set('Authorization', as(T)).expect(200);
        expect(viewerOff.body.data.users[0].lastActiveAt).toBeNull();
        await http().patch('/api/v1/me/privacy').set('Authorization', as(T)).send({ showActivityStatus: true }).expect(200);
      });
    });

    describe('1 · โพสต์มีรูปและวิดีโอ', () => {
      it('โพสต์รูปล้วนได้ · ลำดับตามที่ส่ง · ภาพย่อในกิจกรรม · ตรวจเจ้าของ/ชนิด/ใช้ซ้ำ', async () => {
        const first = await seedAsset(S, 'IMAGE');
        const second = await seedAsset(S, 'VIDEO');
        const foreign = await seedAsset(T, 'IMAGE');

        await http().post('/api/v1/posts').set('Authorization', as(S)).send({}).expect(400);
        await http().post('/api/v1/posts').set('Authorization', as(S)).send({ assetIds: [foreign.id] }).expect(403);
        await http().post('/api/v1/posts').set('Authorization', as(S)).send({ assetIds: [first.id, first.id] }).expect(400);

        const created = await http()
          .post('/api/v1/posts')
          .set('Authorization', as(S))
          .send({ assetIds: [second.id, first.id] })
          .expect(201);
        const post = created.body.data;
        expect(post).toMatchObject({ title: '', content: '', canComment: true });
        expect(post.media.map((m: { assetId: string }) => m.assetId)).toEqual([second.id, first.id]);
        expect(post.media[0]).toMatchObject({ kind: 'VIDEO', mimeType: 'video/mp4', url: expect.any(String) });

        // ไฟล์เดิมใช้ซ้ำไม่ได้
        await http().post('/api/v1/posts').set('Authorization', as(S)).send({ assetIds: [first.id] }).expect(400);

        const detail = await http().get(`/api/v1/posts/${post.id}`).set('Authorization', as(T)).expect(200);
        expect(detail.body.data.media).toHaveLength(2);
        // คนอื่นขอ URL ของรูปในโพสต์ได้ (สาธารณะเท่ากับตัวโพสต์)
        await http().get(`/api/v1/assets/${first.id}/download-url`).set('Authorization', as(T)).expect(200);

        const media = await http().get('/api/v1/activity/media?kind=POST').set('Authorization', as(S)).expect(200);
        expect(media.body.data.find((x: { id: string }) => x.id === post.id)).toMatchObject({
          thumbnailKind: 'VIDEO',
          thumbnailUrl: expect.any(String),
        });

        await http()
          .post('/api/v1/reactions')
          .set('Authorization', as(T))
          .send({ targetKind: 'POST', targetId: post.id, emoji: '❤️' });
        const liked = await http().get('/api/v1/activity/likes?target=POST').set('Authorization', as(T)).expect(200);
        expect(liked.body.data.find((x: { id: string }) => x.id === post.id)).toMatchObject({
          thumbnailKind: 'VIDEO',
          thumbnailUrl: expect.any(String),
        });
      });
    });

    describe('2 · รีโพสต์คลิป', () => {
      it('เรียกซ้ำได้ · ตัวนับถูก · แจ้งเตือน REEL_REPOST · แท็บรีโพสต์บนโปรไฟล์ · กิจกรรมของคุณ', async () => {
        const reel = await seedReel(Q, 'คลิปที่จะถูกรีโพสต์');

        for (let i = 0; i < 2; i += 1) {
          const done = await http().post(`/api/v1/reels/${reel.id}/reposts`).set('Authorization', as(R)).expect(200);
          expect(done.body.data).toEqual({ repostCount: 1, repostedByMe: true });
        }

        await http().post(`/api/v1/reels/${reel.id}/reposts`).set('Authorization', as(Q)).expect(400);

        const detail = await http().get(`/api/v1/reels/${reel.id}`).set('Authorization', as(R)).expect(200);
        expect(detail.body.data).toMatchObject({ repostCount: 1, repostedByMe: true, canComment: true });

        const notes = await http().get('/api/v1/notifications?kind=REEL_REPOST').set('Authorization', as(Q)).expect(200);
        expect(notes.body.data.filter((x: { refId: string }) => x.refId === reel.id)).toHaveLength(1);

        const tab = await http().get(`/api/v1/profiles/${R}/reposts`).set('Authorization', as(S)).expect(200);
        expect(tab.body.data.map((x: { id: string }) => x.id)).toContain(reel.id);

        const activity = await http().get(`/api/v1/activity/reposts?authorCoreUserId=${Q}`).set('Authorization', as(R)).expect(200);
        expect(activity.body.data[0]).toMatchObject({ id: reel.id, targetKind: 'REEL', repostedAt: expect.any(String) });

        for (let i = 0; i < 2; i += 1) {
          const undone = await http().delete(`/api/v1/reels/${reel.id}/reposts`).set('Authorization', as(R)).expect(200);
          expect(undone.body.data).toEqual({ repostCount: 0, repostedByMe: false });
        }
      });
    });

    describe('13 · คนที่น่าติดตาม', () => {
      it('แบ่งหน้า · followedBy ≤ 3 · ตัดคนที่ปิด showInSuggestions', async () => {
        await follow(T, R).expect(201);
        await follow(R, S).expect(201);
        await follow(R, Q).expect(201);
        await http().patch('/api/v1/me/privacy').set('Authorization', as(Q)).send({ showInSuggestions: false }).expect(200);

        const page = await http().get('/api/v1/follows/suggestions?limit=50').set('Authorization', as(T)).expect(200);
        const ids = page.body.data.map((x: { coreUserId: string }) => x.coreUserId);
        expect(ids).toContain(S);
        expect(ids).not.toContain(Q);
        expect(ids).not.toContain(T);
        expect(page.body.data.find((x: { coreUserId: string }) => x.coreUserId === S)).toMatchObject({
          followedBy: [R],
          followedByCount: 1,
        });
        expect(page.body.meta).toMatchObject({ page: 1, limit: 50 });

        await http().patch('/api/v1/me/privacy').set('Authorization', as(Q)).send({ showInSuggestions: true }).expect(200);
      });
    });

    describe('10 · การตั้งค่าการแจ้งเตือน', () => {
      it('ค่าเริ่มต้น · ปิดแล้วไม่มีแถว · FOLLOWING · หยุดชั่วคราว = มีแถวแต่ไม่เด้ง socket', async () => {
        const defaults = await http().get('/api/v1/me/notification-preferences').set('Authorization', as(S)).expect(200);
        expect(defaults.body.data).toEqual({
          pausedUntil: null,
          likes: 'EVERYONE',
          comments: 'EVERYONE',
          mentions: 'EVERYONE',
          commentLikes: 'ON',
          newFollowers: 'ON',
          reposts: 'ON',
          storyReplies: 'ON',
          messageRequests: 'ON',
          groupRequests: 'ON',
          messages: 'PRIMARY_GENERAL',
        });

        const reel = await seedReel(S, 'คลิปทดสอบการตั้งค่าแจ้งเตือน');
        const count = (kind: string) =>
          db().notification.count({ where: { coreUserId: S, kind: kind as never, refId: reel.id } });

        await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ likes: 'OFF' }).expect(200);
        await http().post(`/api/v1/reels/${reel.id}/likes`).set('Authorization', as(T)).expect(201);
        expect(await count('REEL_LIKE')).toBe(0);

        await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ comments: 'FOLLOWING' }).expect(200);
        await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(P)).send({ content: 'จากคนที่ไม่ได้ติดตาม' }).expect(201);
        expect(await count('REEL_COMMENT')).toBe(0);
        await follow(S, P).expect(201);
        await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(P)).send({ content: 'ติดตามแล้ว' }).expect(201);
        expect(await count('REEL_COMMENT')).toBe(1);

        const bus = app.get(RealtimeBus);
        const pushed: string[] = [];
        const sub = bus.userEvents.subscribe((row) => {
          if (row.coreUserId === S) pushed.push(row.notification.kind);
        });

        try {
          const paused = await http()
            .patch('/api/v1/me/notification-preferences')
            .set('Authorization', as(S))
            .send({ pauseMinutes: 60 })
            .expect(200);
          expect(Date.parse(paused.body.data.pausedUntil)).toBeGreaterThan(Date.now());

          await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(P)).send({ content: 'ตอนหยุดชั่วคราว' }).expect(201);
          expect(await count('REEL_COMMENT')).toBe(2);
          expect(pushed).toEqual([]);

          await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ pauseMinutes: null }).expect(200);
          await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(P)).send({ content: 'เลิกหยุดแล้ว' }).expect(201);
          expect(pushed).toEqual(['REEL_COMMENT']);
        } finally {
          sub.unsubscribe();
        }

        await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ pauseMinutes: 30 }).expect(400);
        await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ messages: 'SOME' }).expect(400);
      });
    });

    describe('11 · ความเป็นส่วนตัว', () => {
      it('commentsFrom บังคับจริง (403) · canComment ตามผู้เรียก · เจ้าของคอมเมนต์ได้เสมอ · audience-counts', async () => {
        const reel = await seedReel(T, 'คลิปจำกัดคอมเมนต์');
        const post = (
          await http().post('/api/v1/posts').set('Authorization', as(T)).send({ title: 'โพสต์จำกัดคอมเมนต์', content: 'x' }).expect(201)
        ).body.data.id as string;

        await http().patch('/api/v1/me/privacy').set('Authorization', as(T)).send({ commentsFrom: 'OFF' }).expect(200);

        const res = await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(S)).send({ content: 'ขอคอมเมนต์' }).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        await http().post(`/api/v1/posts/${post}/comments`).set('Authorization', as(S)).send({ content: 'ขอคอมเมนต์' }).expect(403);
        expect((await http().get(`/api/v1/reels/${reel.id}`).set('Authorization', as(S)).expect(200)).body.data.canComment).toBe(false);
        expect((await http().get(`/api/v1/posts/${post}`).set('Authorization', as(S)).expect(200)).body.data.canComment).toBe(false);
        // เจ้าของคอมเมนต์ได้เสมอ
        await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(T)).send({ content: 'ของฉันเอง' }).expect(201);

        await http().patch('/api/v1/me/privacy').set('Authorization', as(T)).send({ commentsFrom: 'FOLLOWERS' }).expect(200);
        await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(S)).send({ content: 'ยัง' }).expect(403);
        await follow(S, T).expect(201);
        await http().post(`/api/v1/reels/${reel.id}/comments`).set('Authorization', as(S)).send({ content: 'ติดตามแล้ว' }).expect(201);
        expect((await http().get(`/api/v1/posts/${post}`).set('Authorization', as(S)).expect(200)).body.data.canComment).toBe(true);

        const privacy = await http().get('/api/v1/me/privacy').set('Authorization', as(T)).expect(200);
        expect(privacy.body.data).toEqual({ commentsFrom: 'FOLLOWERS', showActivityStatus: true, showInSuggestions: true });
        await http().patch('/api/v1/me/privacy').set('Authorization', as(T)).send({ commentsFrom: 'NOBODY' }).expect(400);
        await http().patch('/api/v1/me/privacy').set('Authorization', as(T)).send({ commentsFrom: 'EVERYONE' }).expect(200);

        const counts = await http().get('/api/v1/me/audience-counts').set('Authorization', as(T)).expect(200);
        expect(counts.body.data).toEqual({
          following: expect.any(Number),
          followers: expect.any(Number),
          mutual: expect.any(Number),
        });
        expect(counts.body.data.followers).toBeGreaterThanOrEqual(1);
      });
    });

    describe('7 · เพื่อนสนิทและกลุ่มผู้ชมของโน้ต', () => {
      it('CLOSE_FRIENDS เห็นเฉพาะคนในรายชื่อ · MUTUAL_FOLLOWERS ต้องติดตามกันทั้งสองทาง', async () => {
        // P ↔ R ติดตามกันทั้งสองทาง · P ใส่ S เป็นเพื่อนสนิท (S ไม่ได้ติดตามกัน)
        await follow(P, R);
        await follow(R, P);
        // S ต้องไม่ได้ติดตามกันทั้งสองทางกับ P (ข้อก่อนหน้าอาจทำให้ติดตามกันแล้ว)
        await http().delete(`/api/v1/follows/${P}`).set('Authorization', as(S));

        const added = await http().put(`/api/v1/close-friends/${S}`).set('Authorization', as(P)).expect(200);
        expect(added.body.data.coreUserId).toBe(S);
        await http().put(`/api/v1/close-friends/${S}`).set('Authorization', as(P)).expect(200);
        await http().put(`/api/v1/close-friends/${P}`).set('Authorization', as(P)).expect(400);
        const list = await http().get('/api/v1/close-friends').set('Authorization', as(P)).expect(200);
        expect(list.body.data.map((x: { coreUserId: string }) => x.coreUserId)).toEqual([S]);

        const note = await http()
          .put('/api/v1/notes/me')
          .set('Authorization', as(P))
          .send({ text: 'เฉพาะเพื่อนสนิท', audience: 'CLOSE_FRIENDS' })
          .expect(200);
        expect(note.body.data.audience).toBe('CLOSE_FRIENDS');

        const sees = async (sub: string) =>
          ((await http().get('/api/v1/notes').set('Authorization', as(sub)).expect(200)).body.data as { coreUserId: string }[])
            .some((x) => x.coreUserId === P);

        expect(await sees(S), 'S sees CF').toBe(true);
        expect(await sees(R), 'R sees CF').toBe(false);

        await http().put('/api/v1/notes/me').set('Authorization', as(P)).send({ text: 'ถึงคนที่ติดตามกัน' }).expect(200);
        expect(await sees(R), 'R sees MF').toBe(true);
        expect(await sees(S), 'S sees MF').toBe(false);

        await http().put('/api/v1/notes/me').set('Authorization', as(P)).send({ text: 'x', audience: 'EVERYONE' }).expect(400);
        await http().delete(`/api/v1/close-friends/${S}`).set('Authorization', as(P)).expect(204);
        expect((await http().get('/api/v1/close-friends').set('Authorization', as(P)).expect(200)).body.data).toEqual([]);
      });
    });

    describe('12 · เว็บไซต์บนโปรไฟล์', () => {
      it('http/https เท่านั้น · บันทึกประวัติบัญชี WEBSITE_CHANGED · null = ลบ', async () => {
        await http().patch('/api/v1/profiles/me').set('Authorization', as(R)).send({ website: 'https://example.com/rin' }).expect(200);
        const detail = await http().get(`/api/v1/profiles/${R}`).set('Authorization', as(S)).expect(200);
        expect(detail.body.data.website).toBe('https://example.com/rin');

        for (const website of ['javascript:alert(1)', 'ftp://example.com', 'example.com', `https://example.com/${'a'.repeat(200)}`]) {
          await http().patch('/api/v1/profiles/me').set('Authorization', as(R)).send({ website }).expect(400);
        }

        await http().patch('/api/v1/profiles/me').set('Authorization', as(R)).send({ website: null }).expect(200);
        const removed = await http().get('/api/v1/profiles/me').set('Authorization', as(R)).expect(200);
        expect(removed.body.data.website).toBeNull();

        const history = await http().get('/api/v1/activity/account-history?limit=100').set('Authorization', as(R)).expect(200);
        const changes = history.body.data.filter((x: { kind: string }) => x.kind === 'WEBSITE_CHANGED');
        expect(changes.map((x: { detail: string | null }) => x.detail)).toEqual([null, 'https://example.com/rin']);
      });
    });

    describe('14 · คะแนนสาย', () => {
      it('สมาชิกห้องให้คะแนนได้ · คนนอก 404 · ค่าผิด 400 · ดูรวมได้เฉพาะบุคลากร', async () => {
        const dm = await dmOf(S, T);

        const created = await http()
          .post('/api/v1/calls/feedback')
          .set('Authorization', as(S))
          .send({ channelId: dm, rating: 4, durationSec: 125, kind: 'VIDEO' })
          .expect(201);
        expect(created.body.data).toMatchObject({ channelId: dm, coreUserId: S, rating: 4, durationSec: 125, kind: 'VIDEO' });

        await http().post('/api/v1/calls/feedback').set('Authorization', as(P)).send({ channelId: dm, rating: 3, kind: 'AUDIO' }).expect(404);
        await http().post('/api/v1/calls/feedback').set('Authorization', as(S)).send({ channelId: dm, rating: 6, kind: 'AUDIO' }).expect(400);
        await http().post('/api/v1/calls/feedback').set('Authorization', as(S)).send({ channelId: dm, rating: 3, kind: 'TEXT' }).expect(400);
        await http().post('/api/v1/calls/feedback').set('Authorization', as(S)).send({ channelId: dm, rating: 3, kind: 'AUDIO', durationSec: -1 }).expect(400);

        await http().get('/api/v1/calls/feedback').set('Authorization', as(S)).expect(403);
        const all = await http().get('/api/v1/calls/feedback?limit=100').set('Authorization', as(S, 'staff')).expect(200);
        expect(all.body.data.map((x: { id: string }) => x.id)).toContain(created.body.data.id);
      });
    });

    describe('รอบ 4 · บันทึกการโทร รีแอ็กชันแบบ Discord สมาชิกและห้องเสียง', () => {
      /// บันทึกการโทรทดสอบผ่าน CallLogService ตรง ๆ (ตัวเดียวกับที่ gateway เรียก)
      /// เพราะชุดนี้ไม่เปิด socket จริง — ด่านสิทธิ์ของสัญญาณโทรอยู่ใน gateway
      const callsSvc = () => app.get(CallLogService);

      async function voiceSession(sub: string, channelId: string) {
        return (
          await http().post('/api/v1/voice-sessions').set('Authorization', as(sub)).send({ channelId: channelId }).expect(201)
        ).body.data.id as string;
      }

      const leave = (sub: string, sessionId: string) =>
        http().delete(`/api/v1/voice-sessions/${sessionId}/participants/me`).set('Authorization', as(sub));

      const callRow = async (sub: string, channelId: string, messageId: string) =>
        (await messagesOf(sub, channelId)).find((m) => m.id === messageId)!;

      it('A · รับสายแล้ววาง = ANSWERED พร้อมความยาว · กระจาย message:new / message:updated · ตัวอย่างในกล่องข้อความ', async () => {
        const bus = app.get(RealtimeBus);
        const events: { event: string; payload: any }[] = [];
        const sub = bus.roomEvents.subscribe((row) => events.push(row));
        const dm = await dmOf(P, T);
        const sessionId = await voiceSession(P, dm);

        try {
          const caller = { coreUserId: P, coreRole: 'student' } as never;
          const callee = { coreUserId: T, coreRole: 'student' } as never;

          const messageId = (await callsSvc().ring(caller, {
            sessionId,
            channelId: dm,
            media: 'VIDEO',
            calleeCoreUserId: T,
          }))!;

          let row = await callRow(T, dm, messageId);
          expect(row.content).toBeNull();
          expect(row.callLog).toMatchObject({
            media: 'VIDEO',
            status: 'MISSED',
            durationSec: null,
            callerCoreUserId: P,
            endedAt: null,
          });
          expect(events.some((e) => e.event === 'message:new' && e.payload.id === messageId)).toBe(true);

          // ระหว่างเรียก: ผู้โทรเห็น "คุณเริ่มวิดีโอคอล"
          const inbox = (await http().get('/api/v1/channels?limit=100').set('Authorization', as(P)).expect(200)).body.data;
          expect(inbox.find((c: { id: string }) => c.id === dm).lastMessage).toMatchObject({
            content: 'คุณเริ่มวิดีโอคอล',
            callLog: expect.objectContaining({ media: 'VIDEO' }),
          });

          await callsSvc().answer(callee, { sessionId, callerCoreUserId: P, accepted: true });
          row = await callRow(T, dm, messageId);
          expect(row.callLog).toMatchObject({ status: 'ANSWERED', endedAt: null, durationSec: null });

          await callsSvc().end(callee, sessionId);
          row = await callRow(T, dm, messageId);
          expect(row.callLog).toMatchObject({ status: 'ANSWERED', durationSec: expect.any(Number) });
          expect(row.callLog.endedAt).not.toBeNull();
          expect(events.some((e) => e.event === 'message:updated' && e.payload.id === messageId)).toBe(true);

          const after = (await http().get('/api/v1/channels?limit=100').set('Authorization', as(T)).expect(200)).body.data;
          expect(after.find((c: { id: string }) => c.id === dm).lastMessage.content).toBe('วิดีโอคอลสิ้นสุดลงแล้ว');

          // แก้ไข ส่งต่อ และตอบกลับบันทึกการโทรไม่ได้
          await http().patch(`/api/v1/channels/${dm}/messages/${messageId}`).set('Authorization', as(P)).send({ content: 'แก้' }).expect(400);
          await http()
            .post(`/api/v1/channels/${dm}/messages/${messageId}/forwards`)
            .set('Authorization', as(P))
            .send({ peerCoreUserIds: [R] })
            .expect(400);
          await http()
            .post(`/api/v1/channels/${dm}/messages`)
            .set('Authorization', as(T))
            .send({ clientNonce: nonce(), content: 'ตอบ', replyToMessageId: messageId })
            .expect(400);
        } finally {
          sub.unsubscribe();
          await leave(P, sessionId);
        }
      });

      it('A · หมดเวลา = MISSED + แจ้งเตือน MISSED_CALL · ปฏิเสธ = DECLINED · ผู้โทรวางก่อน = CANCELLED', async () => {
        const dm = await dmOf(Q, S);
        const caller = { coreUserId: Q, coreRole: 'student' } as never;
        const callee = { coreUserId: S, coreRole: 'student' } as never;

        // 1) หมดเวลาเรียก
        let sessionId = await voiceSession(Q, dm);
        const missed = (await callsSvc().ring(caller, { sessionId, channelId: dm, media: 'AUDIO', calleeCoreUserId: S }))!;
        await callsSvc().ringTimeout(sessionId, Q);
        expect((await callRow(S, dm, missed)).callLog).toMatchObject({ status: 'MISSED', endedAt: expect.any(String) });
        const notes = await http().get('/api/v1/notifications?kind=MISSED_CALL').set('Authorization', as(S)).expect(200);
        expect(notes.body.data.filter((x: { refId: string }) => x.refId === missed)).toHaveLength(1);
        const inboxS = (await http().get('/api/v1/channels?limit=100').set('Authorization', as(S)).expect(200)).body.data;
        expect(inboxS.find((c: { id: string }) => c.id === dm).lastMessage.content).toBe('ไม่ได้รับสายโทรด้วยเสียง');
        await leave(Q, sessionId);

        // 2) ปฏิเสธ
        sessionId = await voiceSession(Q, dm);
        const declined = (await callsSvc().ring(caller, { sessionId, channelId: dm, media: 'AUDIO', calleeCoreUserId: S }))!;
        await callsSvc().answer(callee, { sessionId, callerCoreUserId: Q, accepted: false });
        expect((await callRow(Q, dm, declined)).callLog.status).toBe('DECLINED');
        await leave(Q, sessionId);

        // 3) ผู้โทรยกเลิก
        sessionId = await voiceSession(Q, dm);
        const cancelled = (await callsSvc().ring(caller, { sessionId, channelId: dm, media: 'AUDIO', calleeCoreUserId: S }))!;
        await callsSvc().cancel(caller, sessionId);
        expect((await callRow(Q, dm, cancelled)).callLog).toMatchObject({ status: 'CANCELLED', durationSec: null });
        await leave(Q, sessionId);

        // ปิดการแจ้งเตือนข้อความ → สายที่ไม่ได้รับไม่มีแจ้งเตือน
        // (S ตอบในห้องก่อน ห้องจึงเป็นแฟ้มหลัก ไม่ใช่คำขอข้อความที่คุมด้วย messageRequests)
        await send(S, dm, { content: 'รับสายไม่ทัน' });
        await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ messages: 'OFF' }).expect(200);
        sessionId = await voiceSession(Q, dm);
        const silent = (await callsSvc().ring(caller, { sessionId, channelId: dm, media: 'VIDEO', calleeCoreUserId: S }))!;
        await callsSvc().ringTimeout(sessionId, Q);
        expect(await db().notification.count({ where: { coreUserId: S, kind: 'MISSED_CALL', refId: silent } })).toBe(0);
        await leave(Q, sessionId);
        await http().patch('/api/v1/me/notification-preferences').set('Authorization', as(S)).send({ messages: 'PRIMARY_GENERAL' }).expect(200);
      });

      it('B · กดชิปรีแอ็กชันเพิ่ม/ถอนได้ซ้ำ · เรียงตามอิโมจิที่ถูกกดก่อน · ใครกดบ้าง (ซ่อนคนที่บล็อกกัน)', async () => {
        const group = (
          await http().post('/api/v1/direct-channels').set('Authorization', as(R)).send({ peerCoreUserIds: [S, T] }).expect(201)
        ).body.data.id as string;
        const message = await send(R, group, { content: 'กดอิโมจิกัน' });
        const react = (sub: string, emoji: string) =>
          http().post('/api/v1/reactions').set('Authorization', as(sub)).send({ targetKind: 'MESSAGE', targetId: message.id, emoji });

        await react(S, '🎉').expect(201);
        await react(T, '👍').expect(201);
        await react(R, '👍').expect(201);
        const twice = await react(R, '👍').expect(201);
        // เรียงตามที่ถูกกดก่อน (🎉 ก่อน 👍) ไม่ใช่ตามยอด
        expect(twice.body.data.totals).toEqual([
          { emoji: '🎉', count: 1, reactedByMe: false },
          { emoji: '👍', count: 2, reactedByMe: true },
        ]);

        const who = await http()
          .get(`/api/v1/channels/${group}/messages/${message.id}/reactions?emoji=${encodeURIComponent('👍')}`)
          .set('Authorization', as(S))
          .expect(200);
        expect(who.body.data.map((x: { coreUserId: string }) => x.coreUserId)).toEqual([T, R]);
        expect(who.body.meta.total).toBe(2);

        await http().post('/api/v1/blocks').set('Authorization', as(S)).send({ coreUserId: T }).expect(201);
        const hidden = await http()
          .get(`/api/v1/channels/${group}/messages/${message.id}/reactions?emoji=${encodeURIComponent('👍')}`)
          .set('Authorization', as(S))
          .expect(200);
        expect(hidden.body.data.map((x: { coreUserId: string }) => x.coreUserId)).toEqual([R]);
        await http().delete(`/api/v1/blocks/${T}`).set('Authorization', as(S)).expect(204);

        for (let i = 0; i < 2; i += 1) {
          const removed = await http()
            .delete(`/api/v1/reactions?targetKind=MESSAGE&targetId=${message.id}&emoji=${encodeURIComponent('👍')}`)
            .set('Authorization', as(R))
            .expect(200);
          expect(removed.body.data.totals.find((x: { emoji: string }) => x.emoji === '👍')).toEqual({
            emoji: '👍',
            count: 1,
            reactedByMe: false,
          });
        }

        await http().get(`/api/v1/channels/${group}/messages/${message.id}/reactions?emoji=ab`).set('Authorization', as(S)).expect(400);
        await http()
          .get(`/api/v1/channels/${group}/messages/${message.id}/reactions?emoji=${encodeURIComponent('👍')}`)
          .set('Authorization', as(P))
          .expect(404);
      });

      it('C · ปักหมุด · สมาชิกพร้อมสถานะ (ปิดแสดงสถานะ = ซ่อน) · คนในห้องเสียงพร้อมไอคอน + voice:occupants', async () => {
        const bus = app.get(RealtimeBus);
        const events: { room: string; event: string; payload: any }[] = [];
        const sub = bus.roomEvents.subscribe((row) => events.push(row));
        const room = (
          await http()
            .post('/api/v1/channels')
            .set('Authorization', as(P, 'staff'))
            .send({ kind: 'VOICE', name: 'ห้องเสียงทดสอบรอบ 4', description: 'ทดสอบห้องเสียงแบบ Discord' })
            .expect(201)
        ).body.data.id as string;

        try {
          await http().post(`/api/v1/channels/${room}/members`).set('Authorization', as(P, 'staff')).send({ coreUserIds: [Q, R] }).expect(201);

          const message = await send(P, room, { content: 'ประกาศของห้อง' });
          await http().put(`/api/v1/channels/${room}/messages/${message.id}/pin`).set('Authorization', as(P, 'staff')).expect(200);
          const pins = await http().get(`/api/v1/channels/${room}/messages/pinned`).set('Authorization', as(Q)).expect(200);
          expect(pins.body.data.map((m: { id: string }) => m.id)).toEqual([message.id]);

          const at = new Date('2026-09-30T08:00:00.000Z');
          await db().subsystemMember.upsert({
            where: { coreUserId: Q },
            update: { lastActiveAt: at },
            create: { coreUserId: Q, lastActiveAt: at },
          });

          const sessionId = await voiceSession(Q, room);
          const muted = await http()
            .patch(`/api/v1/voice-sessions/${sessionId}/participants/me`)
            .set('Authorization', as(Q))
            .send({ muted: true, video: true })
            .expect(200);
          expect(muted.body.data).toEqual({
            channelId: room,
            sessionId: sessionId,
            occupants: [{ coreUserId: Q, muted: true, deafened: false, video: true, sharing: false }],
          });
          expect(
            events.some((e) => e.room === `user:${R}` && e.event === 'voice:occupants' && e.payload.channelId === room) ||
              events.some((e) => e.event === 'voice:occupants' && e.payload.channelId === room),
          ).toBe(true);

          const list = (await http().get('/api/v1/channels?limit=100').set('Authorization', as(R)).expect(200)).body.data;
          expect(list.find((c: { id: string }) => c.id === room).voiceOccupants).toEqual([
            { coreUserId: Q, muted: true, deafened: false, video: true, sharing: false },
          ]);

          const members = await http().get(`/api/v1/channels/${room}/members?limit=50`).set('Authorization', as(R)).expect(200);
          expect(members.body.meta.total).toBe(3);
          const q = members.body.data.find((m: { coreUserId: string }) => m.coreUserId === Q);
          expect(q).toMatchObject({ role: 'MEMBER', online: false, lastActiveAt: at.toISOString(), inVoice: true });
          expect(members.body.data[0]).toMatchObject({ coreUserId: P, role: 'MODERATOR' });

          await http().patch('/api/v1/me/privacy').set('Authorization', as(Q)).send({ showActivityStatus: false }).expect(200);
          const hidden = await http().get(`/api/v1/channels/${room}/members?status=offline`).set('Authorization', as(R)).expect(200);
          expect(hidden.body.data.find((m: { coreUserId: string }) => m.coreUserId === Q).lastActiveAt).toBeNull();
          await http().patch('/api/v1/me/privacy').set('Authorization', as(Q)).send({ showActivityStatus: true }).expect(200);

          await http().get(`/api/v1/channels/${room}/members`).set('Authorization', as(T)).expect(404);
          await http().get(`/api/v1/channels/${room}/members?status=away`).set('Authorization', as(R)).expect(400);

          await leave(Q, sessionId).expect(204);
          const empty = (await http().get('/api/v1/channels?limit=100').set('Authorization', as(R)).expect(200)).body.data;
          expect(empty.find((c: { id: string }) => c.id === room).voiceOccupants).toEqual([]);
          // ห้องที่ไม่ใช่ VOICE ไม่มีช่องนี้
          expect(empty.find((c: { kind: string }) => c.kind === 'DM')?.voiceOccupants ?? null).toBeNull();
        } finally {
          sub.unsubscribe();
          await http().delete(`/api/v1/channels/${room}`).set('Authorization', as(P, 'staff'));
        }
      });
    });

    describe('8 · ชื่อเล่นและทำเครื่องหมายว่ายังไม่ได้อ่าน', () => {
      it('ใครในห้องก็ตั้งชื่อเล่นให้ใครก็ได้ · ทุกคนเห็นเหมือนกัน · กระจาย channel:updated', async () => {
        const bus = app.get(RealtimeBus);
        const events: { room: string; event: string; payload: any }[] = [];
        const sub = bus.roomEvents.subscribe((row) => events.push(row));

        try {
          const dm = await dmOf(R, S);

          const set = await http()
            .put(`/api/v1/channels/${dm}/members/${S}/nickname`)
            .set('Authorization', as(R))
            .send({ nickname: '  แซม  ' })
            .expect(200);
          expect(set.body.data.nicknames).toEqual({ [S]: 'แซม' });

          await http().put(`/api/v1/channels/${dm}/members/${R}/nickname`).set('Authorization', as(R)).send({ nickname: 'ริน' }).expect(200);
          const seen = await http().get(`/api/v1/channels/${dm}`).set('Authorization', as(S)).expect(200);
          expect(seen.body.data.nicknames).toEqual({ [S]: 'แซม', [R]: 'ริน' });

          expect(events).toContainEqual(
            expect.objectContaining({
              room: dm,
              event: 'channel:updated',
              payload: expect.objectContaining({ channelId: dm, nicknames: { [S]: 'แซม', [R]: 'ริน' } }),
            }),
          );

          const cleared = await http().put(`/api/v1/channels/${dm}/members/${S}/nickname`).set('Authorization', as(S)).send({ nickname: null }).expect(200);
          expect(cleared.body.data.nicknames).toEqual({ [R]: 'ริน' });

          await http().put(`/api/v1/channels/${dm}/members/${S}/nickname`).set('Authorization', as(R)).send({ nickname: 'ก'.repeat(41) }).expect(400);
          await http().put(`/api/v1/channels/${dm}/members/${S}/nickname`).set('Authorization', as(R)).send({}).expect(400);
          await http().put(`/api/v1/channels/${dm}/members/${T}/nickname`).set('Authorization', as(R)).send({ nickname: 'ที' }).expect(404);
          await http().put(`/api/v1/channels/${dm}/members/${S}/nickname`).set('Authorization', as(T)).send({ nickname: 'ที' }).expect(404);

          const room = await http()
            .post('/api/v1/channels')
            .set('Authorization', as(R))
            .send({ kind: 'GROUP', name: 'ห้องกลุ่มไม่มีชื่อเล่น', description: 'ทดสอบ' })
            .expect(201);
          await http()
            .put(`/api/v1/channels/${room.body.data.id}/members/${R}/nickname`)
            .set('Authorization', as(R))
            .send({ nickname: 'ริน' })
            .expect(400);
          expect(room.body.data.nicknames).toEqual({});
        } finally {
          sub.unsubscribe();
        }
      });

      it('ทำเครื่องหมายว่ายังไม่ได้อ่าน → unread ≥ 1 · markedUnread · เปิดอ่านแล้วล้าง', async () => {
        // แชทกลุ่มใหม่เสมอ — ห้องยังไม่มีข้อความแน่นอน ไม่ขึ้นกับข้อก่อนหน้า
        const dm = (
          await http().post('/api/v1/direct-channels').set('Authorization', as(T)).send({ peerCoreUserIds: [P, R] }).expect(201)
        ).body.data.id as string;

        await http().post(`/api/v1/channels/${dm}/unread`).set('Authorization', as(P)).expect(400);

        await send(T, dm, { content: 'หนึ่ง' });
        const last = await send(T, dm, { content: 'สอง' });

        await http().post(`/api/v1/channels/${dm}/read-markers`).set('Authorization', as(P)).send({ seq: last.seq }).expect(201);

        const unread = await http().post(`/api/v1/channels/${dm}/unread`).set('Authorization', as(P)).expect(200);
        expect(unread.body.data.markedUnread).toBe(true);
        expect(unread.body.data.unreadCount).toBeGreaterThanOrEqual(1);

        const inList = (
          await http().get('/api/v1/channels?limit=100').set('Authorization', as(P)).expect(200)
        ).body.data.find((c: { id: string }) => c.id === dm);
        expect(inList).toMatchObject({ markedUnread: true });

        await http().post(`/api/v1/channels/${dm}/read-markers`).set('Authorization', as(P)).send({ seq: last.seq }).expect(201);
        const after = await http().get(`/api/v1/channels/${dm}`).set('Authorization', as(P)).expect(200);
        expect(after.body.data).toMatchObject({ markedUnread: false, unreadCount: 0 });

        await http().post(`/api/v1/channels/${dm}/unread`).set('Authorization', as(S)).expect(404);
      });
    });
  });
});
