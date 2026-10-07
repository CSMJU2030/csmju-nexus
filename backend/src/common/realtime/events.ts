/// สัญญาของ Socket.io — ประกาศที่นี่ที่เดียวแล้วใช้ร่วมกับหน้าบ้าน
///
/// หน้าบ้านให้ import type จากไฟล์นี้ (หรือคัดลอกไปไว้ใน frontend/) เพื่อไม่ให้
/// ชื่อ event เพี้ยนกันคนละฝั่ง ซึ่งเป็นบั๊กที่หายากที่สุดของงานเรียลไทม์
///
/// field ทุกตัวเป็น camelCase เหมือน REST เพื่อให้หน้าบ้านไม่ต้องจำสองแบบ

export const SOCKET_NAMESPACE = '/realtime';

/// path ของ engine.io — หน้าเว็บ rewrite `/realtime` ไปที่ api (frontend/next.config.ts)
/// ไม่มี / ปิดท้าย เพราะ Next.js redirect path ที่ลงท้ายด้วย / ก่อนถึง rewrite
export const REALTIME_PATH = '/realtime';

/// ห้องส่วนตัวของผู้ใช้หนึ่งคน — socket ทุกเครื่องของเขาเข้าห้องนี้ตอนต่อ
///
/// ใช้ส่งของที่ "ถึงคน" ไม่ใช่ "ถึงห้อง" เช่นการแจ้งเตือน โดยไม่ต้องวนหา
/// socket id ทีละตัว และทำให้คนที่เปิดทั้งมือถือและคอมได้รับพร้อมกัน
export const userRoom = (coreUserId: string) => `user:${coreUserId}`;

/// client → server
export interface ClientEvents {
  'channel:join': (
    payload: { channelId: string },
    ack: (result: JoinResult) => void,
  ) => void;

  'channel:leave': (payload: { channelId: string }) => void;

  'message:send': (
    payload: SendMessagePayload,
    ack: (result: SendResult) => void,
  ) => void;

  'typing:start': (payload: { channelId: string }) => void;

  /// ---- WebRTC signaling (mesh P2P) ----
  ///
  /// เซิร์ฟเวอร์เป็นแค่บุรุษไปรษณีย์ ไม่แตะเสียงหรือภาพเลย — เสียงวิ่ง P2P
  /// ระหว่างเบราว์เซอร์โดยตรง นี่คือเหตุผลที่ระบบนี้อยู่บนงบ 0 บาทได้
  'rtc:signal': (
    payload: RtcSignalPayload,
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  'screen:claim': (
    payload: { sessionId: string },
    ack: (result: ScreenClaimResult) => void,
  ) => void;

  'screen:release': (payload: { sessionId: string }) => void;

  /// ---- การโทร (เสียงกริ่ง) ----
  ///
  /// ต่างจาก `rtc:signal` ที่เป็นการต่อสายหลังทั้งสองฝ่ายตกลงแล้ว — สามตัวนี้
  /// คือขั้น "ก่อนรับสาย" ซึ่งเดิมไม่มีเลย ผู้ใช้จึงต้องนัดกันนอกระบบว่า
  /// ใครจะเข้าห้องเสียงตอนไหน
  'call:ring': (
    /// media: ชนิดสายสำหรับบันทึกการโทร (ไม่ส่ง = AUDIO)
    payload: { sessionId: string; toCoreUserId: string; media?: 'AUDIO' | 'VIDEO' },
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  'call:answer': (payload: {
    sessionId: string;
    toCoreUserId: string;
    accepted: boolean;
  }) => void;

  /// ผู้โทรกดยกเลิกก่อนอีกฝ่ายรับ
  'call:cancel': (payload: { sessionId: string; toCoreUserId: string }) => void;
}

export interface RtcSignalPayload {
  /// ปลายทาง — เซิร์ฟเวอร์จะส่งต่อก็ต่อเมื่อสองคนอยู่ห้องเสียงเดียวกันจริง
  toCoreUserId: string;
  /// `renegotiate` = "ผมเพิ่มแทร็กใหม่ แต่ผมไม่ใช่ฝ่ายที่ยื่นข้อเสนอ
  /// ช่วยเปิดรอบเจรจาใหม่ให้ที" — จำเป็นเพราะฝ่ายผู้ยื่นถูกตัดสินด้วยชื่อผู้ใช้
  /// ถ้าฝ่ายที่ไม่ได้ยื่นเริ่มแชร์หน้าจอ จะไม่มีใครสร้าง offer ให้เลย
  kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
  /// SDP หรือ ICE candidate ส่งผ่านไปตามที่เบราว์เซอร์สร้างมา
  data: unknown;
}

export interface ScreenClaimResult {
  ok: boolean;
  /// ใครกำลังแชร์อยู่ ถ้ามีคนอื่นจับจองไปแล้ว
  presenterCoreUserId?: string;
  maxViewers?: number;
  error?: string;
}

/// server → client
export interface ServerEvents {
  'message:new': (payload: MessageEvent) => void;
  'message:deleted': (payload: { channelId: string; messageId: string }) => void;

  /// ห้องถูกแก้ชื่อหรือวัตถุประสงค์ — สมาชิกที่เปิดห้องค้างไว้เห็นทันที
  'channel:updated': (payload: {
    channelId: string;
    name: string | null;
    description: string | null;
    /// มาเฉพาะตอนตั้งชื่อเล่น — { coreUserId: ชื่อเล่น } ของทั้งห้อง
    nicknames?: Record<string, string>;
  }) => void;

  /// ห้องถูกลบทั้งห้อง — ส่งก่อนเตะทุกคนออกจากห้องของ socket
  /// หน้าจอต้องเอาห้องออกจากรายการ และพาคนที่เปิดห้องนั้นอยู่ออกมา
  'channel:deleted': (payload: {
    channelId: string;
    name: string | null;
    deletedByCoreUserId: string;
  }) => void;

  /// รายชื่อสมาชิกของห้องเปลี่ยน — มีคนถูกเชิญเข้า ถูกนำออก หรือออกเอง
  ///
  /// แผงสมาชิกของทุกคนที่เปิดห้องอยู่โหลดรายชื่อใหม่ทันที · คนที่อยู่ใน
  /// `removed` และไม่ใช่ `byCoreUserId` คือถูกนำออก — ส่งก่อนเตะเขาออกจากห้อง
  /// ของ socket เพื่อให้หน้าจอของเขาพาออกจากห้องได้ (แบบเดียวกับ channel:deleted)
  'channel:members': (payload: {
    channelId: string;
    added: string[];
    removed: string[];
    byCoreUserId: string;
  }) => void;
  'presence:sync':(payload: PresencePayload) => void;
  'typing:sync': (payload: { channelId: string; coreUserId: string }) => void;
  'error:notice': (payload: { code: string; message: string }) => void;

  /// ข้อความถูกแก้ — payload เป็น MessageResponse เต็มตัว ให้ client แทนที่ทั้งก้อน
  /// (ส่งแค่ id กับข้อความใหม่จะทำให้ client ต้องรวมสถานะเอง ซึ่งพลาดง่าย)
  'message:edited': (payload: unknown) => void;

  /// ข้อความถูกอัปเดตโดยระบบ (ตอนนี้คือบันทึกการโทรเปลี่ยนสถานะ) — payload = ข้อความทั้งก้อน
  'message:updated': (payload: MessageEvent) => void;

  /// คนในห้องเสียงของห้องหนึ่งเปลี่ยน (เข้า/ออก/ปิดไมค์/ปิดหูฟัง/กล้อง/แชร์จอ)
  ///
  /// ส่งถึงห้องส่วนตัวของสมาชิกทุกคนของห้องนั้น — แถบข้างแบบ Discord จึงอัปเดต
  /// รายชื่อใต้ห้องเสียงได้โดยไม่ต้องเปิดห้องนั้นอยู่ · sessionId = null คือไม่มีใครเหลือ
  'voice:occupants': (payload: VoiceOccupantsPayload) => void;

  /// ปักหมุดหรือถอนหมุด — ดูที่ pinnedAt ใน payload ว่าเป็นทางไหน
  'message:pinned': (payload: unknown) => void;

  /// แถบอิโมจิของข้อความหนึ่งเปลี่ยน — ส่งยอดรวมชุดใหม่ทั้งชุด
  'reaction:changed': (payload: ReactionChangedPayload) => void;

  /// การแจ้งเตือนใหม่ ส่งเข้าห้องส่วนตัวของผู้รับ (ดู userRoom)
  'notification:new': (payload: NotificationPayload) => void;

  /// มีคนตอบในเธรด — ให้ client ขยับตัวเลข "n คำตอบ" ที่ข้อความต้นเธรด
  'thread:updated': (payload: {
    channelId: string;
    parentId: string;
  }) => void;

  /// ---- การโทร ----
  ///
  /// ส่งเข้าห้องส่วนตัวของผู้รับ (ดู userRoom) จึงดังทุกอุปกรณ์ที่เขาเปิดอยู่
  'call:incoming': (payload: {
    sessionId: string;
    channelId: string;
    fromCoreUserId: string;
    media: 'AUDIO' | 'VIDEO';
  }) => void;

  /// ผลของการโทร — ส่งกลับให้ผู้โทร
  'call:answered': (payload: {
    sessionId: string;
    fromCoreUserId: string;
    accepted: boolean;
  }) => void;

  /// ผู้โทรวางก่อนรับ — ให้ฝั่งผู้รับเลิกส่งเสียงกริ่ง
  'call:cancelled': (payload: {
    sessionId: string;
    fromCoreUserId: string;
  }) => void;

  /// ใครออนไลน์/ออฟไลน์ทั้งระบบ — ต่างจาก `presence:sync` ที่บอกเฉพาะในห้อง
  ///
  /// ต้องมีตัวนี้เพราะจุดเขียวบนรูปโปรไฟล์ต้องขึ้นได้ทุกที่ ไม่ใช่แค่ในห้อง
  /// ที่เปิดอยู่ · ยิงเฉพาะตอนนับ socket ของคนนั้นเปลี่ยนจาก 0→1 หรือ 1→0
  /// ไม่ใช่ทุกครั้งที่เปิดแท็บใหม่ ไม่งั้นเปิดสามแท็บจะยิงสามรอบ
  'presence:changed': (payload: {
    coreUserId: string;
    online: boolean;
  }) => void;

  /// ---- WebRTC signaling ----
  'rtc:signal': (
    payload: RtcSignalPayload & { fromCoreUserId: string },
  ) => void;

  'voice:participants': (payload: VoiceParticipantsPayload) => void;

  'screen:changed': (payload: {
    sessionId: string;
    presenterCoreUserId: string | null;
  }) => void;

  /// ---- ซิงก์ทั้งเว็บ ----
  ///
  /// "ข้อมูลหัวข้อนี้เพิ่งเปลี่ยน" — ไม่มีเนื้อหาใด ๆ (ไม่รั่วข้อมูลที่ผู้รับไม่มีสิทธิ์เห็น)
  /// หน้าเว็บดึงใหม่ผ่าน REST ซึ่งตรวจสิทธิ์ตามปกติ · แทนการถามซ้ำทุก 30–60 วินาที
  'sync:changed': (payload: { topic: SyncTopic }) => void;
}

/// หัวข้อของ `sync:changed` — หน้าเว็บแปลงเป็นคีย์แคชที่ต้องดึงใหม่ (frontend/src/lib/csmju/realtime-sync.ts)
export type SyncTopic =
  | 'posts'
  | 'reels'
  | 'stories'
  | 'highlights'
  | 'follows'
  | 'notes'
  | 'profiles'
  | 'reactions'
  | 'meetings'
  | 'inbox'
  | 'bookmarks'
  | 'notifications'
  | 'blocks'
  | 'close-friends';

/// ห้องที่ socket ที่ยืนยันตัวตนแล้วทุกตัวเข้าตอนต่อ — ใช้ส่ง `sync:changed` ของหัวข้อสาธารณะ
export const SYNC_ROOM = 'sync:all';

export interface VoiceOccupantsPayload {
  channelId: string;
  sessionId: string | null;
  occupants: {
    coreUserId: string;
    muted: boolean;
    deafened: boolean;
    video: boolean;
    sharing: boolean;
  }[];
}

export interface VoiceParticipantsPayload {
  sessionId: string;
  channelId: string;
  /// รายชื่อคนที่อยู่ในห้องเสียงตอนนี้ — client ใช้ตัดสินว่าต้องเปิดสายกับใครบ้าง
  coreUserIds: string[];
}

export interface SendMessagePayload {
  channelId: string;
  /// ตัวใดตัวหนึ่งต้องมี: ข้อความ ไฟล์แนบ หรือคลิปที่แชร์
  content?: string;
  assetIds?: string[];
  embed?: { kind: 'REEL' | 'POST'; refId: string };
  /// ตอบกลับในเธรดของข้อความนี้ — ข้อความที่มี parentId ไม่ขึ้นไทม์ไลน์หลัก
  parentId?: string;
  /// "ตอบกลับ" แบบ Instagram (กล่องอ้างอิงเหนือข้อความ) — ต้องอยู่ห้องเดียวกัน
  replyToMessageId?: string;
  /// client สร้างเอง ใช้กันส่งซ้ำตอนเน็ตกระตุกและใช้เป็นคีย์ชั่วคราวใน UI
  clientNonce: string;
}

export interface JoinResult {
  ok: boolean;
  /// seq ล่าสุดของห้อง ให้ client รู้ว่าต้องดึงย้อนหลังถึงไหน
  latestSeq?: number;
  error?: string;
}

export interface SendResult {
  ok: boolean;
  /// ส่ง clientNonce กลับมาด้วย เพื่อให้ UI แทนที่ข้อความชั่วคราวได้ถูกตัว
  clientNonce: string;
  messageId?: string;
  seq?: number;
  error?: string;
}

export interface MessageEvent {
  id: string;
  seq: number;
  channelId: string;
  authorCoreUserId: string;
  content: string | null;
  attachments: {
    id: string;
    fileName: string;
    kind: string;
    mimeType: string;
    sizeBytes: string;
  }[];
  /// การ์ดของสิ่งที่แชร์ — รูปเต็มดู MessageEmbedViewDto (refId คงไว้เพื่อความเข้ากันได้)
  embed: { kind: string; refId: string; targetId: string; available: boolean } | null;
  replyTo: {
    id: string;
    authorCoreUserId: string;
    preview: string | null;
    attachmentKind: string | null;
    deleted: boolean;
  } | null;
  forwarded: boolean;
  storyReply: { kind: string; emoji: string | null } | null;
  /// บันทึกการโทร — รูปเต็มดู CallLogDto
  callLog: {
    media: string;
    status: string;
    durationSec: number | null;
    callerCoreUserId: string;
    startedAt: string;
    endedAt: string | null;
  } | null;
  clientNonce: string;
  createdAt: string;
}

export interface PresencePayload {
  channelId: string;
  onlineCoreUserIds: string[];
}

export interface ReactionChangedPayload {
  channelId: string;
  /// คนที่กดหรือถอน — `reactedByMe` ใน totals เป็นมุมของคนนี้
  actorCoreUserId: string;
  targetKind: string;
  targetId: string;
  totals: { emoji: string; count: number; reactedByMe: boolean }[];
  totalCount: number;
}

export interface NotificationPayload {
  notification: {
    id: string;
    kind: string;
    refId: string;
    actorCoreUserId: string | null;
    payload: unknown;
    createdAt: string;
  };
  /// ส่งมาด้วยเพื่อให้ตัวเลขบนกระดิ่งอัปเดตได้โดยไม่ต้องยิง REST ตาม
  unreadCount: number;
}
