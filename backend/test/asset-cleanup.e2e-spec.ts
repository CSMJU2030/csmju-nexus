import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp, PREFIX_EXCLUDE } from '../src/bootstrap.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/common/storage/storage.provider.js';
import { AssetsSweeper } from '../src/modules/assets/assets-sweeper.service.js';
import { bearer, startCoreHubStub } from './core-hub-fixture.js';

/// ลบโพสต์ คลิป สตอรี่ → ไฟล์ต้องถูกคืน: ไม่กินโควตา ดาวน์โหลดไม่ได้ ไบต์หายจากที่เก็บ
///
/// เดิมไฟล์ค้าง READY ตลอดไป (ตัวกวาดเก็บแค่ PENDING) — ลบเนื้อหาเท่าไหร่พื้นที่ก็ไม่คืน
///
/// อัปโหลดผ่านท่อจริงสามจังหวะ (intent → PUT → commit) ให้มีไฟล์จริงในที่เก็บ
/// แล้วตรวจที่เก็บตรง ๆ ผ่าน StorageProvider.head · ทุกอย่างที่สร้างถูกลบใน afterAll
describe('คืนไฟล์เมื่อลบโพสต์ คลิป สตอรี่ (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;

  const run = randomUUID().slice(0, 8);
  const author = `e2e-${run}-author`;
  const viewer = `e2e-${run}-viewer`;
  const peer = `e2e-${run}-peer`;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  // กล่อง ftyp ของ mp4 แบบ isom — ตัวตรวจดู "ftyp" ที่ไบต์ 4-7
  const MP4 = Buffer.from([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0x02, 0,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);

  const http = () => request(app.getHttpServer());

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
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);
  });

  afterAll(async () => {
    const prefix = { startsWith: `e2e-${run}-` };
    const leftovers = await prisma.asset.findMany({ where: { ownerCoreUserId: prefix } });

    for (const asset of leftovers) {
      await storage.remove(asset.bucket, asset.objectPath);
    }

    await prisma.channel.deleteMany({ where: { members: { some: { coreUserId: prefix } } } });
    await prisma.reel.deleteMany({ where: { authorCoreUserId: prefix } });
    await prisma.story.deleteMany({ where: { authorCoreUserId: prefix } });
    await prisma.post.deleteMany({ where: { authorCoreUserId: prefix } });
    await prisma.asset.deleteMany({ where: { ownerCoreUserId: prefix } });
    await prisma.reaction.deleteMany({ where: { coreUserId: prefix } });
    await prisma.notification.deleteMany({ where: { coreUserId: prefix } });
    await prisma.auditLog.deleteMany({ where: { actorCoreUserId: prefix } });
    await prisma.profileCache.deleteMany({ where: { coreUserId: prefix } });
    await prisma.subsystemMember.deleteMany({ where: { coreUserId: prefix } });
    await app.close();
  });

  async function upload(owner: string, kind: 'IMAGE' | 'VIDEO') {
    const bytes = kind === 'IMAGE' ? PNG : MP4;
    const intent = await http()
      .post('/api/v1/assets/upload-intents')
      .set('Authorization', bearer(owner))
      .send({
        fileName: kind === 'IMAGE' ? 'photo.png' : 'clip.mp4',
        sizeBytes: bytes.length,
        bucket: kind === 'IMAGE' ? 'attachments' : 'reels',
      })
      .expect(201);

    const url = new URL(intent.body.data.uploadUrl);

    await http()
      .put(url.pathname + url.search)
      .set('content-type', 'application/octet-stream')
      .send(bytes)
      .expect((res) => expect([200, 201, 204]).toContain(res.status));

    await http()
      .post(`/api/v1/assets/${intent.body.data.assetId}/commit`)
      .set('Authorization', bearer(owner))
      .expect(201);

    return prisma.asset.findUniqueOrThrow({ where: { id: intent.body.data.assetId as string } });
  }

  async function used(owner: string): Promise<bigint> {
    const member = await prisma.subsystemMember.findUniqueOrThrow({ where: { coreUserId: owner } });

    return member.storageUsedBytes;
  }

  async function react(targetKind: 'POST' | 'REEL', targetId: string) {
    await http()
      .post('/api/v1/reactions')
      .set('Authorization', bearer(viewer))
      .send({ targetKind, targetId, emoji: '👍' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    expect(await prisma.reaction.count({ where: { targetKind, targetId } })).toBe(1);
  }

  /// ไฟล์ถูกคืนครบ: ไม่มีแถว · ไบต์หายจากที่เก็บ · ดาวน์โหลดไม่ได้
  async function expectReleased(asset: { id: string; bucket: string; objectPath: string }) {
    expect(await prisma.asset.findUnique({ where: { id: asset.id } })).toBeNull();
    expect(await storage.head(asset.bucket, asset.objectPath)).toBeNull();

    await http()
      .get(`/api/v1/assets/${asset.id}/download-url`)
      .set('Authorization', bearer(author))
      .expect(404);
  }

  it('ลบโพสต์ → รูปทุกรูปถูกลบจากที่เก็บ · โควตาคืน · รีแอ็กชันของโพสต์หายตาม', async () => {
    const before = await used(author).catch(() => 0n);
    const first = await upload(author, 'IMAGE');
    const second = await upload(author, 'IMAGE');

    expect(await used(author)).toBe(before + BigInt(PNG.length * 2));
    expect(await storage.head(first.bucket, first.objectPath)).not.toBeNull();

    const post = await http()
      .post('/api/v1/posts')
      .set('Authorization', bearer(author))
      .send({ title: `โพสต์ทดสอบ ${run}`, content: 'ทดสอบคืนไฟล์', assetIds: [first.id, second.id] })
      .expect(201);

    await react('POST', post.body.data.id);

    await http()
      .delete(`/api/v1/posts/${post.body.data.id}`)
      .set('Authorization', bearer(author))
      .expect(204);

    await expectReleased(first);
    await expectReleased(second);
    expect(await used(author)).toBe(before);
    expect(await prisma.reaction.count({ where: { targetKind: 'POST', targetId: post.body.data.id } })).toBe(0);
  });

  it('ลบคลิป → วิดีโอถูกลบจากที่เก็บ · โควตาคืน · รีแอ็กชันหายตาม', async () => {
    const before = await used(author).catch(() => 0n);
    const video = await upload(author, 'VIDEO');

    const reel = await http()
      .post('/api/v1/reels')
      .set('Authorization', bearer(author))
      .send({ title: `คลิปทดสอบ ${run}`, assetId: video.id, durationMs: 1000 })
      .expect(201);

    await react('REEL', reel.body.data.id);
    expect(await used(author)).toBe(before + BigInt(MP4.length));

    await http()
      .delete(`/api/v1/reels/${reel.body.data.id}`)
      .set('Authorization', bearer(author))
      .expect(204);

    await expectReleased(video);
    expect(await used(author)).toBe(before);
    expect(await prisma.reaction.count({ where: { targetKind: 'REEL', targetId: reel.body.data.id } })).toBe(0);
  });

  it('ลบสตอรี่ → รูปถูกลบจากที่เก็บ · โควตาคืน', async () => {
    const before = await used(author).catch(() => 0n);
    const image = await upload(author, 'IMAGE');

    const story = await http()
      .post('/api/v1/stories')
      .set('Authorization', bearer(author))
      .send({ assetId: image.id })
      .expect(201);

    await http()
      .delete(`/api/v1/stories/${story.body.data.id}`)
      .set('Authorization', bearer(author))
      .expect(204);

    await expectReleased(image);
    expect(await used(author)).toBe(before);
  });

  it('บุคลากรลบโพสต์ของคนอื่น → คืนโควตาให้ **เจ้าของ** ไม่ใช่คนที่กดลบ', async () => {
    const image = await upload(author, 'IMAGE');
    const authorBefore = await used(author);

    const post = await http()
      .post('/api/v1/posts')
      .set('Authorization', bearer(author))
      .send({ title: `โพสต์ที่ถูกลบโดยบุคลากร ${run}`, content: 'ทดสอบ', assetIds: [image.id] })
      .expect(201);

    await http()
      .delete(`/api/v1/posts/${post.body.data.id}`)
      .set('Authorization', bearer(viewer, 'staff'))
      .expect(204);

    await expectReleased(image);
    expect(await used(author)).toBe(authorBefore - BigInt(PNG.length));
  });

  it('ไฟล์ที่ยังมีแถวอื่นชี้อยู่ (สำเนาจากการส่งต่อ) → ลบแถว DELETED แต่ไบต์ต้องอยู่ต่อ', async () => {
    const image = await upload(author, 'IMAGE');

    // สำเนาแบบเดียวกับที่การส่งต่อข้อความสร้าง: แถวใหม่ ชี้ objectPath เดิม
    const dm = await http()
      .post('/api/v1/direct-channels')
      .set('Authorization', bearer(author))
      .send({ peerCoreUserId: peer })
      .expect(201);
    const message = await http()
      .post(`/api/v1/channels/${dm.body.data.id}/messages`)
      .set('Authorization', bearer(author))
      .send({ content: 'ไฟล์ที่ถูกส่งต่อ', clientNonce: `e2e-${run}-fwd` })
      .expect(201);
    const copy = await prisma.asset.create({
      data: {
        ownerCoreUserId: peer,
        bucket: image.bucket,
        objectPath: image.objectPath,
        fileName: image.fileName,
        mimeType: image.mimeType,
        kind: image.kind,
        sizeBytes: image.sizeBytes,
        status: 'READY',
        messageId: message.body.data.id,
        sourceAssetId: image.id,
      },
    });

    const post = await http()
      .post('/api/v1/posts')
      .set('Authorization', bearer(author))
      .send({ title: `โพสต์ไฟล์ที่ถูกแชร์ ${run}`, content: 'ทดสอบ', assetIds: [image.id] })
      .expect(201);

    await http()
      .delete(`/api/v1/posts/${post.body.data.id}`)
      .set('Authorization', bearer(author))
      .expect(204);

    expect(await prisma.asset.findUnique({ where: { id: image.id } })).toBeNull();
    // สำเนายังดาวน์โหลดได้ และไบต์ยังอยู่
    expect(await storage.head(copy.bucket, copy.objectPath)).not.toBeNull();
    await http()
      .get(`/api/v1/assets/${copy.id}/download-url`)
      .set('Authorization', bearer(peer))
      .expect(200);
  });

  it('ตัวเก็บกวาดลบไฟล์ DELETED ที่ค้าง (ลบจากที่เก็บไม่สำเร็จรอบก่อน) และรีแอ็กชันกำพร้า', async () => {
    const image = await upload(author, 'IMAGE');

    // เหมือนรอบก่อนลบจากที่เก็บไม่สำเร็จ: แถวค้าง DELETED · ไบต์ยังอยู่
    await prisma.asset.update({ where: { id: image.id }, data: { status: 'DELETED' } });

    // รีแอ็กชันกำพร้าจากก่อนมีการล้างตอนลบ — เป้าหมายไม่มีอยู่จริง
    const ghost = randomUUID();

    await prisma.reaction.create({
      data: { targetKind: 'POST', targetId: ghost, coreUserId: viewer, emoji: '🔥' },
    });

    const result = await app.get(AssetsSweeper).sweep();

    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(result.orphanReactions).toBeGreaterThanOrEqual(1);
    await expectReleased(image);
    expect(await prisma.reaction.count({ where: { targetId: ghost } })).toBe(0);
  });

  it('ไฟล์ที่ยังถูกใช้เป็นรูปปกด้วย → ไม่ถูกปล่อยตอนลบโพสต์', async () => {
    const image = await upload(author, 'IMAGE');

    await prisma.subsystemMember.update({
      where: { coreUserId: author },
      data: { coverAssetId: image.id },
    });

    try {
      const post = await prisma.post.create({
        data: { title: `โพสต์ที่ใช้รูปปก ${run}`, content: 'ทดสอบ', authorCoreUserId: author },
      });

      await prisma.postMedia.create({ data: { postId: post.id, assetId: image.id, position: 0 } }).catch(() => null);

      const before = await used(author);

      await http()
        .delete(`/api/v1/posts/${post.id}`)
        .set('Authorization', bearer(author))
        .expect(204);

      const still = await prisma.asset.findUniqueOrThrow({ where: { id: image.id } });

      expect(still.status).toBe('READY');
      expect(await storage.head(still.bucket, still.objectPath)).not.toBeNull();
      expect(await used(author)).toBe(before);
    } finally {
      await prisma.subsystemMember.update({
        where: { coreUserId: author },
        data: { coverAssetId: null },
      });
    }
  });
});
