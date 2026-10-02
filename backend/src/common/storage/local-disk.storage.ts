import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  StorageProvider,
  StoredObjectInfo,
  UploadTicket,
} from './storage.provider.js';

/// ที่เก็บไฟล์สำหรับ dev — เขียนลงดิสก์ในเครื่อง ไม่ต้องมี credential ของใคร
///
/// ตัวนี้ให้ signed URL ที่ชี้กลับมาที่ backend เอง (ไบต์จึงไหลผ่าน backend)
/// ซึ่งต่างจาก production ที่ไบต์ไม่ผ่าน backend เลย — ยอมรับความต่างนี้ได้
/// เพราะ dev ไม่มีข้อจำกัดเรื่อง bandwidth และมันทำให้พัฒนาได้โดยไม่ต้องรอ
/// ใครออก key ให้
@Injectable()
export class LocalDiskStorage implements StorageProvider {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor() {
    this.root = resolve(process.env.LOCAL_STORAGE_DIR ?? './storage-dev');
    this.baseUrl = (
      process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`
    ).replace(/\/$/, '');

    // ใช้ลงนาม upload/download token — dev เท่านั้น จึงสุ่มใหม่ได้ถ้าไม่ตั้งค่า
    this.secret =
      process.env.LOCAL_STORAGE_SECRET ?? randomBytes(32).toString('hex');

    this.logger.warn(
      `ใช้ที่เก็บไฟล์ในเครื่องที่ ${this.root} — production ต้องตั้ง SUPABASE_URL`,
    );
  }

  createUploadTicket(
    bucket: string,
    objectPath: string,
    options: { contentLength: number; ttlSeconds: number },
  ): Promise<UploadTicket> {
    const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000);
    const token = this.sign('put', bucket, objectPath, expiresAt.getTime());

    return Promise.resolve({
      uploadUrl:
        `${this.baseUrl}/api/v1/asset-blobs/${bucket}/${encodeURIComponent(objectPath)}` +
        `?expires=${expiresAt.getTime()}&signature=${token}`,
      method: 'PUT' as const,
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt,
    });
  }

  async head(
    bucket: string,
    objectPath: string,
  ): Promise<StoredObjectInfo | null> {
    try {
      const info = await stat(this.pathFor(bucket, objectPath));

      return { sizeBytes: BigInt(info.size) };
    } catch {
      return null;
    }
  }

  async readHead(
    bucket: string,
    objectPath: string,
    length: number,
  ): Promise<Buffer> {
    const handle = await open(this.pathFor(bucket, objectPath), 'r');

    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);

      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  createDownloadUrl(
    bucket: string,
    objectPath: string,
    options: { ttlSeconds: number; fileName: string; asAttachment: boolean },
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000);
    const token = this.sign('get', bucket, objectPath, expiresAt.getTime());

    return Promise.resolve({
      url:
        `${this.baseUrl}/api/v1/asset-blobs/${bucket}/${encodeURIComponent(objectPath)}` +
        `?expires=${expiresAt.getTime()}&signature=${token}` +
        `&download=${options.asAttachment ? '1' : '0'}`,
      expiresAt,
    });
  }

  async remove(bucket: string, objectPath: string): Promise<void> {
    await rm(this.pathFor(bucket, objectPath), { force: true });
  }

  // ---- ใช้โดย AssetBlobsController เท่านั้น ----

  async write(
    bucket: string,
    objectPath: string,
    body: Buffer,
  ): Promise<void> {
    const target = this.pathFor(bucket, objectPath);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  pathFor(bucket: string, objectPath: string): string {
    const target = resolve(join(this.root, bucket, objectPath));

    // กัน path traversal: objectPath ที่มี ../ ต้องไม่หลุดออกนอก root
    if (!target.startsWith(resolve(this.root))) {
      throw new Error('objectPath ไม่ถูกต้อง');
    }

    return target;
  }

  verify(
    action: 'put' | 'get',
    bucket: string,
    objectPath: string,
    expires: number,
    signature: string,
  ): boolean {
    if (!Number.isFinite(expires) || Date.now() > expires) {
      return false;
    }

    const expected = Buffer.from(
      this.sign(action, bucket, objectPath, expires),
    );
    const given = Buffer.from(signature);

    return (
      expected.length === given.length && timingSafeEqual(expected, given)
    );
  }

  private sign(
    action: string,
    bucket: string,
    objectPath: string,
    expires: number,
  ): string {
    return createHmac('sha256', this.secret)
      .update(`${action}:${bucket}:${objectPath}:${expires}`)
      .digest('hex');
  }
}
