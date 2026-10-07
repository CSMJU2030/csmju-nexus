import { Global, Injectable, Module } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { SyncTopic } from './events.js';

/// สะพานทางเดียวระหว่างชั้นข้อมูลกับชั้น WebSocket
///
/// ปัญหาที่แก้: service หลายตัวต้อง "ผลัก" เหตุการณ์ออกไปทาง socket
/// (แจ้งเตือน รีแอ็กชัน แก้ข้อความ ปักหมุด) แต่ถ้าแต่ละตัวเรียก EventsGateway
/// ตรง ๆ จะเกิดวงจร import
///   Reactions → Realtime → Channels → Reactions
/// ซึ่ง ESM พังตอนบูตด้วย "Cannot access before initialization"
/// (เคยเจอมาแล้วกับ VoiceModule ตอนสร้างห้องเสียง)
///
/// ทางออกคือให้ทั้งสองฝ่ายรู้จักแค่ bus นี้: ฝ่ายเขียน publish ฝ่าย socket
/// subscribe — ไม่มีใคร import ใครเลย และเพิ่มเหตุการณ์ใหม่ได้โดยไม่แตะกราฟโมดูล
///
/// ข้อจำกัด: bus อยู่ในหน่วยความจำของโพรเซสนี้เท่านั้น ถ้าวันหนึ่งรันหลาย
/// instance เหตุการณ์จะถึงแค่คนที่ต่อ socket อยู่กับ instance เดียวกัน
/// (ข้อมูลใน DB ยังครบ แค่ต้องรีเฟรชเอง) — แก้ด้วย Redis adapter เมื่อถึงตอนนั้น
@Injectable()
export class RealtimeBus {
  private readonly userStream = new Subject<NotificationPush>();
  private readonly roomStream = new Subject<RoomEvent>();
  private readonly evictStream = new Subject<RoomEviction>();
  private readonly syncStream = new Subject<SyncPush>();

  /// "หัวข้อนี้เปลี่ยน" ให้หน้าเว็บดึงใหม่ — ถึงทุกคน (`coreUserId: null`) หรือเฉพาะเครื่องของคนเดียว
  readonly syncEvents = this.syncStream.asObservable();

  /// เหตุการณ์ที่ส่งถึงผู้ใช้คนหนึ่ง ทุกอุปกรณ์ที่เขาเปิดอยู่
  readonly userEvents = this.userStream.asObservable();

  /// เหตุการณ์ที่ส่งถึงทุกคนที่เปิดห้องนั้นอยู่
  readonly roomEvents = this.roomStream.asObservable();

  /// สั่งให้ชั้น socket เตะผู้ใช้ออกจากห้อง
  ///
  /// จำเป็นเพราะการเป็นสมาชิกถูกตรวจตอน `channel:join` ครั้งเดียว
  /// พอออกจากห้องผ่าน REST แถวสมาชิกหายไปก็จริง แต่ socket ยังอยู่ในห้อง
  /// ของ socket.io — อดีตสมาชิกจึงยังได้ข้อความใหม่แบบสดต่อไปเรื่อย ๆ
  /// ทั้งที่เปิดหน้าห้องนั้นไม่ได้แล้ว
  readonly evictions = this.evictStream.asObservable();

  pushToUser(push: NotificationPush): void {
    this.userStream.next(push);
  }

  pushToRoom(event: RoomEvent): void {
    this.roomStream.next(event);
  }

  evictFromRoom(eviction: RoomEviction): void {
    this.evictStream.next(eviction);
  }

  pushSync(push: SyncPush): void {
    this.syncStream.next(push);
  }
}

export interface SyncPush {
  topic: SyncTopic;
  /// null = ทุกคนที่ต่ออยู่ · มีค่า = เฉพาะทุกเครื่องของคนนี้ (ข้อมูลส่วนตัว เช่นที่บันทึกไว้)
  coreUserId: string | null;
}

export interface RoomEviction {
  /// ห้องที่ต้องถูกเตะออก (= channelId)
  room: string;
  coreUserId: string;
}

export interface NotificationPush {
  /// ผู้รับ — ชั้น socket จะส่งเข้าห้องส่วนตัวของ coreUserId นี้
  coreUserId: string;
  notification: {
    id: string;
    kind: string;
    refId: string;
    actorCoreUserId: string | null;
    payload: unknown;
    createdAt: string;
  };
  unreadCount: number;
}

export interface RoomEvent {
  /// ห้อง Socket.io ที่จะส่งเข้า — ปัจจุบันคือ channelId
  room: string;
  /// ชื่อ event ต้องตรงกับที่ประกาศใน ServerEvents (common/realtime/events.ts)
  event: string;
  payload: unknown;
}

@Global()
@Module({
  providers: [RealtimeBus],
  exports: [RealtimeBus],
})
export class RealtimeBusModule {}
