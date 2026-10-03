import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  StorageProvider,
  StoredObjectInfo,
  UploadTicket,
} from './storage.provider.js';

/// ที่เก็บไฟล์สำหรับ staging/production — Supabase Storage
///
/// ใช้เฉพาะส่วน Storage ไม่ได้ใช้ Supabase Auth เพราะตัวตนมาจาก CSMJU2030 Core
/// ทางเดียว (Blueprint หน้า 8)
///
/// bucket ต้องเป็นแบบส่วนตัวทั้งคู่ ("reels", "attachments") — ถ้าเปิดสาธารณะ
/// ใครเดา URL ถูกก็อ่านไฟล์การบ้านของคนอื่นได้ทั้งหมด
@Injectable()
export class SupabaseStorage implements StorageProvider {
  private readonly logger = new Logger(SupabaseStorage.name);
  private readonly url: string;
  private readonly serviceKey: string;

  constructor() {
    this.url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    this.serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

    if (!this.url || !this.serviceKey) {
      throw new Error(
        'SupabaseStorage ต้องมี SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY',
      );
    }
  }

  async createUploadTicket(
    bucket: string,
    objectPath: string,
    options: { contentLength: number; ttlSeconds: number },
  ): Promise<UploadTicket> {
    const body = await this.call<{ url: string; token: string }>(
      'POST',
      `/storage/v1/object/upload/sign/${bucket}/${objectPath}`,
      { expiresIn: options.ttlSeconds },
    );

    return {
      // signed URL นี้ให้เบราว์เซอร์ PUT ตรง — ไบต์ไม่ผ่าน backend เลย
      uploadUrl: `${this.url}/storage/v1/${body.url.replace(/^\/+/, '')}`,
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt: new Date(Date.now() + options.ttlSeconds * 1000),
    };
  }

  async head(
    bucket: string,
    objectPath: string,
  ): Promise<StoredObjectInfo | null> {
    const response = await fetch(
      `${this.url}/storage/v1/object/authenticated/${bucket}/${objectPath}`,
      { method: 'HEAD', headers: this.authHeaders() },
    );

    if (!response.ok) {
      return null;
    }

    const length = response.headers.get('content-length');

    return length ? { sizeBytes: BigInt(length) } : null;
  }

  async readHead(
    bucket: string,
    objectPath: string,
    length: number,
  ): Promise<Buffer> {
    const response = await fetch(
      `${this.url}/storage/v1/object/authenticated/${bucket}/${objectPath}`,
      {
        headers: { ...this.authHeaders(), range: `bytes=0-${length - 1}` },
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException('อ่านไฟล์จากที่เก็บไม่สำเร็จ');
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async createDownloadUrl(
    bucket: string,
    objectPath: string,
    options: { ttlSeconds: number; fileName: string; asAttachment: boolean },
  ): Promise<{ url: string; expiresAt: Date }> {
    const body = await this.call<{ signedURL: string }>(
      'POST',
      `/storage/v1/object/sign/${bucket}/${objectPath}`,
      {
        expiresIn: options.ttlSeconds,
        // บังคับดาวน์โหลดสำหรับทุกอย่างที่ไม่ใช่ภาพ/วิดีโอ เพื่อไม่ให้เบราว์เซอร์
        // เรนเดอร์ไฟล์ของผู้ใช้เป็นหน้าเว็บ
        ...(options.asAttachment ? { download: options.fileName } : {}),
      },
    );

    return {
      url: `${this.url}/storage/v1${body.signedURL}`,
      expiresAt: new Date(Date.now() + options.ttlSeconds * 1000),
    };
  }

  async remove(bucket: string, objectPath: string): Promise<void> {
    const response = await fetch(
      `${this.url}/storage/v1/object/${bucket}/${objectPath}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );

    if (!response.ok && response.status !== 404) {
      this.logger.error(
        `ลบไฟล์ ${bucket}/${objectPath} ไม่สำเร็จ (${response.status})`,
      );
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
    };
  }

  private async call<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      this.logger.error(
        `Supabase Storage ตอบ ${response.status} ที่ ${path}: ${await response.text()}`,
      );
      throw new ServiceUnavailableException('ที่เก็บไฟล์ไม่พร้อมใช้งาน');
    }

    return (await response.json()) as T;
  }
}
