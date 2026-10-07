import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  StorageProvider,
  StoredObjectInfo,
  UploadTicket,
} from './storage.provider.js';

/// เพดานต่อไฟล์ — standards deployment.md ข้อ 4.3 (ตัดตั้งแต่ตอนรับไบต์ ไม่ใช่หลังรับครบ)
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

/// ที่เก็บไฟล์ในฐานข้อมูลของระบบเอง (ตาราง stored_objects) — ใช้ทั้งในเครื่องและบน server
///
/// ทำไมไม่ใช่ดิสก์หรือ Supabase:
///   - ระบบไฟล์ของ container บน server อ่านอย่างเดียว และหายเมื่อเริ่มใหม่ (deployment.md ข้อ 3.4)
///   - ห้ามส่งไฟล์ของผู้ใช้ไปบริการภายนอก · บริการรูปของ Core Hub เปิดสาธารณะ ใช้กับไฟล์ที่ต้องตรวจสิทธิ์ไม่ได้
///
/// URL อัปโหลด/ดาวน์โหลดเป็น **path บนโดเมนเดียวกับหน้าเว็บ** (`/api/v1/asset-blobs/...`) ที่ rewrite
/// ของหน้าเว็บส่งต่อมาที่ api — ห้ามสร้าง URL เต็มหรือฝัง localhost (deployment.md ข้อ 3.4)
/// ความปลอดภัยมาจากลายเซ็น HMAC อายุสั้นในตัว URL (ออกให้หลังตรวจสิทธิ์แล้วเท่านั้น)
@Injectable()
export class DatabaseStorage implements StorageProvider {
  private readonly logger = new Logger(DatabaseStorage.name);
  private readonly secret: string;

  constructor(private readonly prisma: PrismaService) {
    const configured = process.env.STORAGE_URL_SECRET ?? process.env.LOCAL_STORAGE_SECRET;

    if (!configured) {
      // ไม่ทำให้ระบบสตาร์ตไม่ขึ้น — ลิงก์ที่ออกไปแล้วแค่ใช้ไม่ได้หลัง api เริ่มใหม่
      this.logger.warn('ไม่ได้ตั้ง STORAGE_URL_SECRET — สุ่มกุญแจลงนามลิงก์ไฟล์ใหม่ทุกครั้งที่ api เริ่ม');
    }

    this.secret = configured ?? randomBytes(32).toString('hex');
  }

  createUploadTicket(
    bucket: string,
    objectPath: string,
    options: { contentLength: number; ttlSeconds: number },
  ): Promise<UploadTicket> {
    const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000);
    const token = this.sign('put', bucket, objectPath, expiresAt.getTime());

    return Promise.resolve({
      uploadUrl: `${blobPath(bucket, objectPath)}?expires=${expiresAt.getTime()}&signature=${token}`,
      method: 'PUT' as const,
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt,
    });
  }

  async head(bucket: string, objectPath: string): Promise<StoredObjectInfo | null> {
    const row = await this.prisma.storedObject.findUnique({
      where: { bucket_objectPath: { bucket, objectPath } },
      select: { sizeBytes: true },
    });

    return row ? { sizeBytes: BigInt(row.sizeBytes) } : null;
  }

  async readHead(bucket: string, objectPath: string, length: number): Promise<Buffer> {
    // อ่านเฉพาะไบต์หัวไฟล์ — ไม่ลากไฟล์ 10 MB ทั้งก้อนมาตรวจลายเซ็น
    const rows = await this.prisma.$queryRaw<{ head: Uint8Array | null }[]>(
      Prisma.sql`SELECT substring(content from 1 for ${Math.max(1, Math.floor(length))}) AS head
                 FROM stored_objects WHERE bucket = ${bucket} AND object_path = ${objectPath}`,
    );

    if (!rows[0]?.head) throw new Error('ไม่พบไฟล์นี้');

    return Buffer.from(rows[0].head);
  }

  createDownloadUrl(
    bucket: string,
    objectPath: string,
    options: { ttlSeconds: number; fileName: string; asAttachment: boolean },
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000);
    const token = this.sign('get', bucket, objectPath, expiresAt.getTime());

    return Promise.resolve({
      url: `${blobPath(bucket, objectPath)}?expires=${expiresAt.getTime()}&signature=${token}&download=${options.asAttachment ? '1' : '0'}`,
      expiresAt,
    });
  }

  async remove(bucket: string, objectPath: string): Promise<void> {
    await this.prisma.storedObject.deleteMany({ where: { bucket, objectPath } });
  }

  // ---- ใช้โดย AssetBlobsController เท่านั้น ----

  /// บันทึกไฟล์ (อัปโหลดซ้ำ path เดิม = แทนที่) — ส่ง Buffer ให้ Prisma ตรง ๆ
  /// (แปลงเป็น new Uint8Array ก่อนทำให้ไฟล์ 10 MB ช้าเป็นสิบวินาที — เจอจริงใน csmju-canvas)
  async write(bucket: string, objectPath: string, body: Buffer): Promise<void> {
    const content = body as unknown as Uint8Array<ArrayBuffer>;
    const data = { content, sizeBytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };

    await this.prisma.storedObject.upsert({
      where: { bucket_objectPath: { bucket, objectPath } },
      create: { bucket, objectPath, ...data },
      update: data,
    });
  }

  async read(bucket: string, objectPath: string): Promise<{ bytes: Buffer; sha256: string } | null> {
    const row = await this.prisma.storedObject.findUnique({
      where: { bucket_objectPath: { bucket, objectPath } },
      select: { content: true, sha256: true },
    });

    return row ? { bytes: Buffer.from(row.content), sha256: row.sha256 } : null;
  }

  verify(action: 'put' | 'get', bucket: string, objectPath: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || Date.now() > expires || typeof signature !== 'string') {
      return false;
    }

    const expected = Buffer.from(this.sign(action, bucket, objectPath, expires));
    const given = Buffer.from(signature);

    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(action: string, bucket: string, objectPath: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${action}:${bucket}:${objectPath}:${expires}`).digest('hex');
  }
}

function blobPath(bucket: string, objectPath: string): string {
  return `/api/v1/asset-blobs/${encodeURIComponent(bucket)}/${encodeURIComponent(objectPath)}`;
}
