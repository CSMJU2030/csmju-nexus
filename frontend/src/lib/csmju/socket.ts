'use client';

/// การเชื่อมต่อ Socket.io — ตัวเดียวใช้ร่วมทั้งแอป
///
/// ลำดับการยืนยันตัวตนตามที่หลังบ้านกำหนด:
///   1. ขอตั๋วทาง REST (`POST /realtime-tickets`) — คำขอนี้ผ่าน Gateway
///      จึงมี header ตัวตนติดไปด้วย
///   2. เอาตั๋วไปแลกตอนจับมือ socket
///
/// ทำแบบนี้เพราะ **หน้าบ้านห้ามตรวจลายเซ็น JWT เอง** (Blueprint หน้า 9)
/// และ WebSocket อาจไม่ผ่าน Gateway จึงไม่มี header ให้อ่าน — ตั๋วอายุ
/// 60 วินาที ใช้ได้ครั้งเดียว
///
/// หนึ่ง connection ต่อทั้งแอปโดยตั้งใจ: ถ้าแต่ละหน้าจอเปิด socket ของตัวเอง
/// การแจ้งเตือนจะมาซ้ำเท่าจำนวนหน้าที่เปิดอยู่ และ presence จะนับคนเกินจริง

import { io, type Socket } from 'socket.io-client';
import { api } from './api';

/// ต่อที่โดเมนเดียวกับหน้าเว็บ — `next.config.ts` rewrite `/realtime` ไปที่หลังบ้าน
/// (บน server หลังบ้านไม่เปิดออกนอก มีแต่หน้าเว็บ · deployment.md ข้อ 3 · ห้ามฝัง localhost)
const NAMESPACE = '/realtime';
const ENGINE_PATH = '/realtime';

/// หน่วงก่อนต่อใหม่ เพิ่มขึ้นเรื่อย ๆ จนถึงเพดาน
///
/// เริ่มที่ 1 วินาทีเพื่อให้เน็ตกระตุกสั้น ๆ ฟื้นเร็ว และเพิ่มเป็นสองเท่า
/// จนถึง 30 วินาที เพื่อไม่ให้ถล่มเซิร์ฟเวอร์ตอนมันล่มยาว
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

let socket: Socket | null = null;
let pending: Promise<Socket> | null = null;
let retryDelay = RECONNECT_MIN_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let manualClose = false;

/// ห้องที่หน้าจอต่าง ๆ ขอเข้าไว้ — ใช้เข้าใหม่หลังต่อกลับมา
///
/// จำเป็นเพราะการต่อใหม่ได้ socket คนละตัว ซึ่งไม่ได้อยู่ในห้องไหนเลย
/// ถ้าไม่จำไว้ ผู้ใช้จะเห็นว่า "ต่อแล้ว" แต่ไม่มีข้อความใหม่เข้ามาอีก
const joinedRooms = new Set<string>();
const reconnectHandlers = new Set<() => void>();
const statusHandlers = new Set<(status: SocketStatus) => void>();

/// ทะเบียนผู้ฟังทั้งแอป — ต้องย้ายตามไปที่ socket ตัวใหม่ทุกครั้งที่ต่อใหม่
///
/// **บั๊กที่ตัวนี้แก้ (ร้ายแรงที่สุดของชั้นนี้):** การต่อใหม่สร้าง `Socket`
/// ตัวใหม่ ส่วน handler ของทุกหน้าจอผูกอยู่กับตัวเก่าที่ถูกทิ้งไปแล้ว
/// ผลคือเข้าห้องได้ เซิร์ฟเวอร์ส่งข้อความมาจริง แต่ไม่มีใครฟัง —
/// แชท การแจ้งเตือน และสายเรียกเข้าตายพร้อมกันหลังเน็ตกระตุกครั้งเดียว
/// โดย UI ยังขึ้นว่า "เชื่อมต่อแล้ว" จนกว่าผู้ใช้จะรีเฟรชเอง
///
/// เทสต์ชุดเดิมจับไม่ได้ เพราะมันดูแค่ว่า `channel:join` ถูกส่งซ้ำไหม
/// ซึ่งเป็นฝั่งเซิร์ฟเวอร์ ไม่ใช่ฝั่งผู้ฟัง
interface Binding {
  event: string;
  handler: (...args: unknown[]) => void;
}

const bindings = new Set<Binding>();

/// ย้ายผู้ฟังทั้งหมดไปไว้กับ socket ตัวที่ใช้อยู่ตอนนี้
function applyBindings(target: Socket) {
  for (const binding of bindings) {
    target.on(binding.event, binding.handler);
  }
}

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

let status: SocketStatus = 'offline';

function setStatus(next: SocketStatus) {
  if (status === next) return;

  status = next;

  for (const handler of statusHandlers) {
    handler(next);
  }
}

export function getSocketStatus(): SocketStatus {
  return status;
}

/// ติดตามสถานะการเชื่อมต่อ — ให้ UI บอกผู้ใช้ได้ว่ากำลังต่อใหม่อยู่
export function onSocketStatus(handler: (status: SocketStatus) => void) {
  statusHandlers.add(handler);
  handler(status);

  return () => statusHandlers.delete(handler);
}

/// เรียกเมื่อต่อกลับมาได้ — หน้าจอใช้โหลดสิ่งที่พลาดไประหว่างหลุด
export function onSocketReconnect(handler: () => void) {
  reconnectHandlers.add(handler);

  return () => reconnectHandlers.delete(handler);
}

/// จำไว้ว่าอยู่ห้องไหน เพื่อเข้าใหม่อัตโนมัติหลังต่อกลับ
export function rememberRoom(channelId: string) {
  joinedRooms.add(channelId);
}

export function forgetRoom(channelId: string) {
  joinedRooms.delete(channelId);
}

async function createSocket(): Promise<Socket> {
  const { ticket } = await api.post<{ ticket: string; expiresAt: string }>(
    '/realtime-tickets',
  );

  const next = io(`${window.location.origin}${NAMESPACE}`, {
    auth: { ticket },
    path: ENGINE_PATH,
    addTrailingSlash: false,
    // long-polling ผ่าน HTTP ใช้ได้ทุกที่ แล้วอัปเกรดเป็น WebSocket เองถ้าเส้นทางรองรับ
    transports: ['polling', 'websocket'],
    // ปิด reconnect ในตัวของ socket.io เพราะมันจะต่อใหม่ด้วย "ตั๋วใบเดิม"
    // ซึ่งใช้ได้ครั้งเดียวและถูกปฏิเสธเสมอ — เราต่อใหม่เองพร้อมขอตั๋วใบใหม่
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ต่อ socket ไม่ทันใน 8 วินาที')),
      8000,
    );

    next.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });

    next.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return next;
}

/// ต่อใหม่หลังหลุด พร้อมขอตั๋วใบใหม่และเข้าห้องเดิมทั้งหมด
///
/// บั๊กที่ตัวนี้แก้: เดิมตั้ง `reconnection: false` แล้วไม่มีอะไรมาแทน
/// พอเน็ตกระตุกครั้งเดียว แชท การแจ้งเตือน และสถานะออนไลน์ก็ตายเงียบ ๆ
/// จนกว่าผู้ใช้จะรีเฟรชหน้าเอง — และไม่มีอะไรบอกเขาว่าต้องรีเฟรช
function scheduleReconnect() {
  if (manualClose || retryTimer) {
    return;
  }

  setStatus('reconnecting');

  retryTimer = setTimeout(() => {
    retryTimer = null;

    void (async () => {
      try {
        const next = await createSocket();

        attach(next);

        // ย้ายผู้ฟังก่อนเข้าห้อง ไม่งั้นข้อความที่เซิร์ฟเวอร์ส่งมาทันที
        // หลัง join จะตกหายไปในช่องว่างระหว่างสองขั้นตอนนี้
        applyBindings(next);

        socket = next;
        retryDelay = RECONNECT_MIN_MS;
        setStatus('connected');

        // เข้าห้องเดิมทั้งหมด — socket ใหม่ไม่ได้อยู่ในห้องไหนเลย
        for (const room of joinedRooms) {
          next.emit('channel:join', { channelId: room }, () => undefined);
        }

        for (const handler of reconnectHandlers) {
          handler();
        }
      } catch {
        retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
        scheduleReconnect();
      }
    })();
  }, retryDelay);
}

function attach(target: Socket) {
  target.on('disconnect', (reason) => {
    // `io client disconnect` = เราสั่งปิดเอง ไม่ต้องต่อใหม่
    if (reason === 'io client disconnect') {
      return;
    }

    setStatus('reconnecting');
    scheduleReconnect();
  });
}

/// ต่อ socket (หรือคืนตัวที่ต่ออยู่แล้ว)
///
/// ตัวตนของ socket มาจาก **ตั๋วอายุสั้น** ที่ขอผ่าน REST ซึ่งหลังบ้านออกให้
/// เฉพาะคำขอที่ผ่านการตรวจลายเซ็น token แล้วเท่านั้น หน้าบ้านจึงไม่ต้องรู้
/// (และไม่มีทางรู้) ว่าตัวเองเป็นใคร — token อยู่ในคุกกี้ httpOnly
///
/// เดิมมีการเทียบชื่อผู้ใช้เพื่อบังคับต่อใหม่ตอนสลับตัวตนในโหมด dev
/// ซึ่งไม่มีแล้วเพราะไม่มีตัวสลับตัวตนอีกต่อไป
export async function connectSocket(): Promise<Socket> {
  if (socket?.connected) {
    return socket;
  }

  if (pending) {
    return pending;
  }

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  // ยกเลิกนัดต่อใหม่ที่ค้างอยู่ก่อน
  //
  // ไม่งั้นตัวจับเวลานั้นจะตื่นมาสร้าง socket **ตัวที่สอง** ทีหลัง แล้วเขียนทับ
  // ตัวที่เรากำลังจะสร้างตรงนี้ ผลคือผู้ใช้คนเดียวมีสองการเชื่อมต่อพร้อมกัน:
  // ข้อความเข้าซ้ำสองรอบ และ presence ฝั่งเซิร์ฟเวอร์นับเกินจริง
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  manualClose = false;
  setStatus('connecting');

  pending = (async () => {
    const next = await createSocket();

    attach(next);
    applyBindings(next);

    socket = next;
    pending = null;
    retryDelay = RECONNECT_MIN_MS;
    setStatus('connected');

    return next;
  })();

  try {
    return await pending;
  } catch (error) {
    pending = null;
    setStatus('offline');
    scheduleReconnect();

    throw error;
  }
}

export function currentSocket(): Socket | null {
  return socket?.connected ? socket : null;
}

export function disconnectSocket(): void {
  manualClose = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  joinedRooms.clear();
  bindings.clear();
  pending = null;
  setStatus('offline');
}

/// ผูก handler แล้วคืนฟังก์ชันถอดที่ถอด **เฉพาะตัวนี้**
///
/// บั๊กที่ตัวนี้แก้: หน้าจอที่เรียก `socket.off('rtc:signal')` เพื่อเก็บกวาด
/// ตัวเอง จะลบ handler ของ **ทุกคน** ที่ฟัง event เดียวกันบน socket ที่แชร์กัน
/// — ผลคือออกจากหน้าห้องเสียงแล้วสายเรียกเข้าพังทั้งแอป โดยไม่มี error ใด ๆ
export function bindSocket<T = unknown>(
  target: Socket,
  event: string,
  handler: (payload: T) => void,
): () => void {
  const binding: Binding = {
    event,
    handler: handler as (...args: unknown[]) => void,
  };

  bindings.add(binding);

  // ผูกกับตัวที่ใช้อยู่จริง ไม่ใช่ตัวที่ผู้เรียกถือมา — ผู้เรียกอาจถือ
  // ตัวเก่าไว้ตั้งแต่ก่อนเน็ตกระตุก
  const current = socket ?? target;

  current.on(event, binding.handler);

  return () => {
    bindings.delete(binding);

    // ถอดออกจากทั้งตัวปัจจุบันและตัวที่ผู้เรียกถือมา เพราะอาจคนละตัวกัน
    socket?.off(event, binding.handler);
    target.off(event, binding.handler);
  };
}

/// ส่ง event ที่รอ ack แบบมี timeout
///
/// `socket.emit` ที่รอ ack แต่ไม่มี timeout จะค้างเงียบตลอดไปถ้าเซิร์ฟเวอร์
/// ไม่ตอบ แล้ว UI จะติดสถานะ "กำลังส่ง" โดยไม่มีอะไรบอกผู้ใช้
export function emitWithAck<T>(
  target: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ไม่ได้รับการตอบกลับจาก ${event}`)),
      timeoutMs,
    );

    target.emit(event, payload, (result: T) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}
