import { Injectable } from '@nestjs/common';
import { importJWK, type JWK, type KeyLike } from 'jose';
import { authConfig } from './auth.config.js';
import { logAuthEvent } from './auth-events.js';

/// ดึงและแคชกุญแจสาธารณะของ Core Hub (auth-contract.md ข้อ 4.1)
///
/// **ทำไมไม่ใช้ `createRemoteJWKSet` ของ jose ทั้งดุ้น**
///
/// มันทำเรื่องแคช เลือกกุญแจตาม `kid` และรีเฟรชครั้งเดียวให้อยู่แล้ว แต่มัน
/// **ไม่เปิดให้ตรวจเนื้อใน JWK** ส่วนสัญญาข้อ 4.1 บังคับว่า *ต้อง* ปฏิเสธ
/// JWK ที่มี private material (`d`) หรือไม่ใช่ `kty: RSA`
///
/// ถ้าวันหนึ่ง Core Hub ตั้งค่าผิดแล้วเผลอเผยแพร่กุญแจส่วนตัวออกมา เราต้อง
/// ไม่รับมาใช้ — ไม่ใช่เพราะมันทำให้ตรวจลายเซ็นผิด (มันยังตรวจผ่าน) แต่เพราะ
/// การรับไว้เท่ากับเก็บกุญแจส่วนตัวของ Core Hub ไว้ในหน่วยความจำของเรา
/// ซึ่งข้อห้ามข้อ 3 ห้ามไว้ตรง ๆ
///
/// ที่ยกให้ jose ทำคือ **งานเข้ารหัส** (`importJWK`, `jwtVerify`) ซึ่งเป็น
/// ส่วนที่เขียนเองแล้วพลาดง่ายที่สุด ส่วนที่เราทำเองคือ fetch + แคช + ตรวจรูปร่าง
/// ซึ่งพลาดแล้วเห็นชัดและเขียนเทสต์ครอบได้หมด
@Injectable()
export class JwksService {
  /// กุญแจที่ผ่านการตรวจแล้ว เรียงตาม kid
  private keys = new Map<string, JWK>();

  /// เวลาที่ดึงสำเร็จครั้งล่าสุด — ใช้คิดทั้ง TTL และการจำกัดอัตรา
  private fetchedAt = 0;

  /// เวลาที่ "พยายามดึง" ครั้งล่าสุด ไม่ว่าจะสำเร็จหรือไม่
  ///
  /// ต้องแยกจาก `fetchedAt` เพราะถ้าใช้ตัวเดียวกัน การดึงที่ล้มเหลวจะไม่ถูก
  /// นับเป็นการพยายาม แล้ว token ที่มี kid มั่ว ๆ ยิงรัว ๆ จะทำให้เรายิงหา
  /// Core Hub ทุกครั้งไม่หยุด — กลายเป็นเครื่องมือถล่ม Core Hub ให้ผู้โจมตี
  private lastAttemptAt = 0;

  /// การดึงที่กำลังทำอยู่ — กันยิงซ้ำซ้อนตอนคำขอหลายเส้นเข้ามาพร้อมกัน
  private inFlight: Promise<void> | null = null;

  /// หา public key สำหรับ `kid` นี้
  ///
  /// คืน null เมื่อหาไม่เจอ ผู้เรียกต้องแปลงเป็น 401 เสมอ — ห้ามเดาว่า
  /// "ใช้กุญแจตัวแรกก็ได้" เพราะจะทำให้การหมุนกุญแจกลายเป็นช่องโหว่
  async keyFor(kid: string): Promise<KeyLike | Uint8Array | null> {
    if (this.isStale()) {
      await this.refresh('ttl_expired');
    }

    let jwk = this.keys.get(kid);

    // เจอ kid ที่ไม่รู้จัก → รีเฟรช **ครั้งเดียว** แล้วถ้ายังไม่เจอให้ปฏิเสธ
    // (ข้อ 4.1) กรณีนี้เกิดจริงตอน Core Hub หมุนกุญแจ core-hub-2026 → 2027
    if (!jwk) {
      logAuthEvent('warn', 'jwks.unknown_kid', {
        kid,
        knownKids: [...this.keys.keys()],
      });

      await this.refresh('unknown_kid');
      jwk = this.keys.get(kid);
    }

    if (!jwk) return null;

    return importJWK(jwk, 'RS256');
  }

  private isStale(): boolean {
    return Date.now() - this.fetchedAt >= authConfig().jwksCacheTtlMs;
  }

  private async refresh(reason: string): Promise<void> {
    const { jwksMinRefreshIntervalMs } = authConfig();

    // จำกัดอัตราการรีเฟรช (ข้อ 4.1) — ถ้ายังไม่ถึงเวลา ให้ใช้ของที่แคชไว้ต่อ
    // ไม่ใช่โยน error เพราะกุญแจเดิมอาจยังใช้ได้อยู่
    if (Date.now() - this.lastAttemptAt < jwksMinRefreshIntervalMs) {
      return;
    }

    // คำขอหลายเส้นที่เข้ามาพร้อมกันต้องรอการดึงรอบเดียวกัน ไม่ใช่ยิงคนละรอบ
    this.inFlight ??= this.doRefresh(reason).finally(() => {
      this.inFlight = null;
    });

    await this.inFlight;
  }

  private async doRefresh(reason: string): Promise<void> {
    const { jwksUrl, jwksRequestTimeoutMs } = authConfig();

    this.lastAttemptAt = Date.now();

    try {
      const response = await fetch(jwksUrl, {
        signal: AbortSignal.timeout(jwksRequestTimeoutMs),
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Core Hub ตอบ ${response.status}`);
      }

      const body: unknown = await response.json();
      const accepted = this.acceptKeys(body);

      // ชุดว่างแปลว่า Core Hub ตอบมาในรูปแบบที่เราไม่รู้จัก หรือกุญแจทุกตัว
      // ถูกปฏิเสธ — **ห้ามทับของเดิมด้วยชุดว่าง** ไม่งั้นระบบจะตอบ 401 ทุกคำขอ
      // ทั้งที่กุญแจที่แคชไว้ยังใช้ได้
      if (accepted.size === 0) {
        throw new Error('ไม่มีกุญแจที่ใช้ได้ในคำตอบของ JWKS');
      }

      this.keys = accepted;
      this.fetchedAt = Date.now();

      logAuthEvent('log', 'jwks.refresh', {
        reason,
        keyCount: accepted.size,
        kids: [...accepted.keys()],
      });
    } catch (error) {
      // Core Hub ล่มชั่วคราวต้องไม่ทำให้ระบบเราล่มตาม — ใช้กุญแจที่แคชไว้ต่อ
      // (ข้อ 4.1 "ควรใช้กุญแจที่แคชไว้ต่อได้") จึงไม่โยน error ออกไป
      logAuthEvent('error', 'jwks.refresh.failure', {
        reason: error instanceof Error ? error.message : 'unknown',
        cachedKeyCount: this.keys.size,
      });
    }
  }

  /// ตรวจรูปร่างของ JWKS แล้วเก็บเฉพาะกุญแจที่รับได้
  ///
  /// Core Hub ตอบเป็น RFC 7517 ดิบ `{"keys":[...]}` ไม่มี envelope ครอบ
  /// (ข้อ 4.2) — ถ้าวันหนึ่งมันเผลอห่อ envelope เหมือน endpoint อื่น
  /// เราจะได้ชุดว่าง แล้ว doRefresh จะไม่ทับของเดิมทิ้ง
  private acceptKeys(body: unknown): Map<string, JWK> {
    const accepted = new Map<string, JWK>();

    if (typeof body !== 'object' || body === null) return accepted;

    const keys = (body as { keys?: unknown }).keys;

    if (!Array.isArray(keys)) return accepted;

    for (const candidate of keys) {
      if (typeof candidate !== 'object' || candidate === null) continue;

      const jwk = candidate as JWK;

      // ต้องเป็น RSA เท่านั้น — สัญญาล็อก RS256 ไว้ กุญแจชนิดอื่นใช้ไม่ได้อยู่แล้ว
      if (jwk.kty !== 'RSA') continue;

      // **มี `d` = เป็นกุญแจส่วนตัว** ปฏิเสธทันทีและบอกให้ดังที่สุดเท่าที่ทำได้
      // นี่ไม่ใช่ข้อผิดพลาดของเรา แต่เป็นอุบัติเหตุร้ายแรงฝั่ง Core Hub
      // ที่ต้องมีคนรู้ภายในไม่กี่นาที ไม่ใช่ไปเจอตอนตรวจ log สามเดือนให้หลัง
      if (typeof jwk.d === 'string') {
        logAuthEvent('error', 'jwks.refresh.failure', {
          reason: 'private_key_material_in_jwks',
          cachedKeyCount: this.keys.size,
        });
        continue;
      }

      if (typeof jwk.kid !== 'string' || jwk.kid === '') continue;

      accepted.set(jwk.kid, jwk);
    }

    return accepted;
  }

  /// ใช้ในเทสต์เท่านั้น — ล้างแคชเพื่อให้แต่ละเคสเริ่มจากศูนย์
  resetForTesting(): void {
    this.keys = new Map();
    this.fetchedAt = 0;
    this.lastAttemptAt = 0;
    this.inFlight = null;
  }
}
