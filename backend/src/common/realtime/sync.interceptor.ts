import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import type { RequestWithCoreUser } from '../../auth/core-hub-jwt.guard.js';
import type { SyncTopic } from './events.js';
import { RealtimeBus } from './realtime-bus.js';

/// หลังการเขียนผ่าน REST สำเร็จ (POST/PATCH/PUT/DELETE) ส่ง `sync:changed` ให้หน้าเว็บที่เปิดอยู่ดึงใหม่ทันที
///
/// ทำที่จุดเดียวแทนการไล่ใส่ในทุก service — endpoint ใหม่ในหมวดเดิมได้ realtime เองโดยไม่ต้องจำ
/// สัญญาณไม่มีเนื้อหา (มีแค่ชื่อหัวข้อ) ผู้รับดึงข้อมูลผ่าน REST ที่ตรวจสิทธิ์ตามปกติ จึงไม่รั่ว
///
///   หัวข้อสาธารณะ (โพสต์ คลิป สตอรี่ ติดตาม …) → ทุกคนที่ต่ออยู่
///   หัวข้อส่วนตัว (ที่บันทึกไว้ การแจ้งเตือน บล็อก …) → เฉพาะทุกเครื่องของคนที่ทำ
///   ห้องแชท → `inbox` ของคนที่ทำ (สมาชิกคนอื่นได้จาก gateway ตอนกระจาย event ของห้อง)
const PUBLIC: Record<string, SyncTopic> = {
  posts: 'posts',
  reels: 'reels',
  stories: 'stories',
  highlights: 'highlights',
  follows: 'follows',
  notes: 'notes',
  profiles: 'profiles',
  'subsystem-members': 'profiles',
  reactions: 'reactions',
  meetings: 'meetings',
};

const PERSONAL: Record<string, SyncTopic> = {
  bookmarks: 'bookmarks',
  'bookmark-collections': 'bookmarks',
  notifications: 'notifications',
  blocks: 'blocks',
  'close-friends': 'close-friends',
  channels: 'inbox',
  'direct-channels': 'inbox',
};

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/// หัวข้อจาก path (`/api/v1/<หมวด>/...`) · null = ไม่ต้องส่ง (เช่นอัปโหลดไฟล์ · ตั๋ว socket)
export function syncTopicOf(method: string, path: string): { topic: SyncTopic; personal: boolean } | null {
  if (!WRITES.has(method)) return null;

  const match = /^\/api\/v1\/([a-z-]+)/.exec(path);
  const segment = match?.[1];

  if (!segment) return null;
  if (PUBLIC[segment]) return { topic: PUBLIC[segment], personal: false };
  if (PERSONAL[segment]) return { topic: PERSONAL[segment], personal: true };

  return null;
}

@Injectable()
export class RealtimeSyncInterceptor implements NestInterceptor {
  constructor(private readonly bus: RealtimeBus) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request & RequestWithCoreUser>();
    const target = syncTopicOf(request.method, request.path);

    if (!target) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const coreUserId = request.coreUser?.coreUserId ?? null;

        if (target.personal && !coreUserId) return;
        this.bus.pushSync({ topic: target.topic, coreUserId: target.personal ? coreUserId : null });
      }),
    );
  }
}
