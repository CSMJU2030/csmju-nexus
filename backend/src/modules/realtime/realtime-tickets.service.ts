import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { CoreHubUser } from '../../common/auth/core-user.js';

/// ตั๋วเข้า WebSocket — วิธียืนยันตัวตนของ socket ที่ไม่ต้องแตะ JWT
///
/// ปัญหา: กฎเหล็กหน้า 8 ห้ามระบบย่อย verify ลายเซ็น JWT เอง แต่การต่อ
/// WebSocket อาจไม่ได้วิ่งผ่าน API Gateway (ขึ้นกับว่า Gateway proxy WS ให้ไหม)
/// ถ้าไม่ผ่าน เราก็ไม่มี header X-User-Id ให้เชื่อ
///
/// วิธีแก้ที่ไม่ผิดกฎ:
///   1. client เรียก POST /api/v1/realtime-tickets ผ่าน REST — ทางนี้วิ่งผ่าน
///      Gateway แน่นอน จึงรู้ตัวตนจาก header ตามปกติ
///   2. เราออกตั๋วสุ่มอายุสั้น ผูกกับ coreUserId นั้น เก็บไว้ในหน่วยความจำ
///   3. client เอาตั๋วไปต่อ socket แล้วเราแลกตั๋วเป็นตัวตน
///
/// ตั๋วใช้ได้ครั้งเดียวและหมดอายุใน 60 วินาที ถ้ารั่วออกไปก็ใช้ไม่ได้แล้ว
///
/// ข้อจำกัดที่ต้องรู้: เก็บในหน่วยความจำของ process จึงใช้ได้กับ instance เดียว
/// ถ้าวันหนึ่งสเกลเป็นหลาย instance ต้องย้ายไปเก็บที่ Redis หรือตาราง
/// TODO(PL): ถาม PM ว่า API Gateway proxy WebSocket พร้อมแนบ header ให้ไหม
///           ถ้าได้ ก็ตัดกลไกตั๋วนี้ออกและอ่าน header ตอน handshake แทน
const TICKET_TTL_MS = 60_000;

interface Ticket {
  user: CoreHubUser;
  expiresAt: number;
}

@Injectable()
export class RealtimeTicketsService {
  private readonly logger = new Logger(RealtimeTicketsService.name);
  private readonly tickets = new Map<string, Ticket>();

  issue(user: CoreHubUser): { ticket: string; expiresAt: string } {
    this.pruneExpired();

    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + TICKET_TTL_MS;

    this.tickets.set(ticket, { user, expiresAt });

    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /// แลกตั๋วเป็นตัวตน — ตั๋วถูกลบทิ้งทันทีเพื่อให้ใช้ได้ครั้งเดียว
  redeem(ticket: string | undefined): CoreHubUser {
    if (!ticket) {
      throw new UnauthorizedException(
        'ต้องแนบ ticket มาด้วย — ขอได้จาก POST /api/v1/realtime-tickets',
      );
    }

    const found = this.tickets.get(ticket);

    this.tickets.delete(ticket);

    if (!found || found.expiresAt < Date.now()) {
      throw new UnauthorizedException('ตั๋วหมดอายุหรือถูกใช้ไปแล้ว — ขอใหม่');
    }

    return found.user;
  }

  private pruneExpired(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, value] of this.tickets) {
      if (value.expiresAt < now) {
        this.tickets.delete(key);
        removed += 1;
      }
    }

    if (removed > 0) {
      this.logger.debug(`ล้างตั๋วหมดอายุ ${removed} ใบ`);
    }
  }
}
