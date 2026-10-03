import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkConnectivity } from './connectivity';

/// เทสต์ตัวตรวจการเชื่อมต่อ
///
/// ตัวนี้มีหน้าที่เดียว: เปลี่ยน "โทรแล้วเงียบ" ให้เป็นคำตอบที่ผู้ใช้อ่านออก
/// ถ้ามันสรุปผิด จะแย่กว่าไม่มีเลย — ผู้ใช้จะเชื่อว่าเน็ตตัวเองไม่มีปัญหา
/// แล้วไปโทษอย่างอื่นแทน

type CandidateType = 'host' | 'srflx' | 'relay';

/// RTCPeerConnection ปลอมที่ปล่อย candidate ตามที่สั่ง
///
/// ต้องเป็น class ไม่ใช่ arrow function — vitest เรียกผ่าน Reflect.construct
/// ซึ่ง arrow function ใช้กับ `new` ไม่ได้
function installFakePeer(types: CandidateType[]) {
  class FakePeer {
    onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
    closed = false;

    constructor(readonly config: RTCConfiguration) {}

    createDataChannel() {
      return {};
    }

    async createOffer() {
      return { type: 'offer', sdp: '' };
    }

    async setLocalDescription() {
      // เบราว์เซอร์เริ่มหาเส้นทางหลังตั้ง local description
      queueMicrotask(() => {
        for (const type of types) {
          this.onicecandidate?.({ candidate: { type } });
        }

        // candidate เป็น null = หาครบแล้ว
        this.onicecandidate?.({ candidate: null });
      });
    }

    close() {
      this.closed = true;
    }
  }

  globalThis.RTCPeerConnection =
    FakePeer as unknown as typeof RTCPeerConnection;
}

const STUN_ONLY = [{ urls: ['stun:stun.example:3478'] }];
const WITH_TURN = [
  { urls: ['stun:stun.example:3478'] },
  { urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' },
];

describe('checkConnectivity', () => {
  const original = globalThis.RTCPeerConnection;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.RTCPeerConnection = original;
  });

  it('หาเส้นทางออกอินเทอร์เน็ตเจอ = โทรได้', async () => {
    installFakePeer(['host', 'srflx']);

    const report = await checkConnectivity(STUN_ONLY);

    expect(report.verdict).toBe('ready');
    expect(report.hasServerReflexive).toBe(true);
    expect(report.summary).toContain('โทรได้');
  });

  it('ได้แต่เส้นทางในวงแลน และไม่มี TURN = บอกว่าจะโทรไม่ติด', async () => {
    // นี่คือเคสที่ทำให้ผู้ใช้นั่งงงหน้าจอ "กำลังเชื่อมต่อ" — ต้องบอกล่วงหน้า
    installFakePeer(['host']);

    const report = await checkConnectivity(STUN_ONLY);

    expect(report.verdict).toBe('needs-turn');
    expect(report.summary).toContain('ไม่ได้ตั้ง TURN');
  });

  it('วิ่งผ่าน TURN ได้ = โทรได้ และบอกว่าวิ่งอ้อม', async () => {
    installFakePeer(['host', 'relay']);

    const report = await checkConnectivity(WITH_TURN);

    expect(report.verdict).toBe('turn-working');
    expect(report.hasRelay).toBe(true);
  });

  it('ตั้ง TURN แล้วแต่ยังหาเส้นทางไม่เจอ = ชี้ไปที่ไฟร์วอลล์หรือค่าที่ตั้งผิด', async () => {
    // ต่างจาก needs-turn ตรงที่คราวนี้ผู้ดูแลตั้งค่าไว้แล้ว ปัญหาจึงอยู่ที่อื่น
    installFakePeer(['host']);

    const report = await checkConnectivity(WITH_TURN);

    expect(report.verdict).toBe('blocked');
    expect(report.summary).toContain('ไฟร์วอลล์');
  });

  it('เบราว์เซอร์ไม่รองรับ = บอกตรง ๆ ไม่ใช่ค้าง', async () => {
    // @ts-expect-error จงใจถอดออกเพื่อจำลองเบราว์เซอร์เก่า
    delete globalThis.RTCPeerConnection;

    const report = await checkConnectivity(STUN_ONLY);

    expect(report.verdict).toBe('unsupported');
  });

  it('เบราว์เซอร์เงียบไม่ตอบ = ต้องหมดเวลาเอง ไม่ค้างตลอดไป', async () => {
    // ถ้าไม่มี timeout ปุ่ม "กำลังตรวจ…" จะหมุนไม่หยุด ซึ่งแย่กว่าไม่มีปุ่ม
    class SilentPeer {
      onicecandidate: unknown = null;
      constructor(readonly config: RTCConfiguration) {}
      createDataChannel() {
        return {};
      }
      async createOffer() {
        return { type: 'offer', sdp: '' };
      }
      async setLocalDescription() {
        // ไม่ยิง candidate เลยสักตัว
      }
      close() {}
    }

    globalThis.RTCPeerConnection =
      SilentPeer as unknown as typeof RTCPeerConnection;

    const pending = checkConnectivity(STUN_ONLY);

    await vi.advanceTimersByTimeAsync(8000);

    const report = await pending;

    expect(report.verdict).toBe('needs-turn');
  });

  it('ปิด peer connection ทิ้งเสมอ ไม่ปล่อยค้าง', async () => {
    installFakePeer(['host', 'srflx']);

    const created: { closed: boolean }[] = [];
    const Fake = globalThis.RTCPeerConnection;

    globalThis.RTCPeerConnection = function (this: unknown, ...args: never[]) {
      const instance = new (Fake as unknown as new (
        ...a: never[]
      ) => { closed: boolean })(...args);

      created.push(instance);

      return instance;
    } as unknown as typeof RTCPeerConnection;

    await checkConnectivity(STUN_ONLY);

    expect(created).toHaveLength(1);
    expect(created[0].closed).toBe(true);
  });

  it('**ส่งชื่อฟิลด์ตามมาตรฐาน WebRTC ให้ RTCPeerConnection**', async () => {
    // สเปกบังคับว่า URL ที่ขึ้นต้นด้วย turn:/turns: ต้องมาคู่กับ `username`
    // และ `credential` ถ้าขาดตัวใดตัวหนึ่ง ตัวสร้างจะโยน InvalidAccessError
    //
    // เคยส่งชื่อ `coreUserId` เพราะโดนกวาดเปลี่ยนชื่อไปตอนย้ายคีย์ตัวตน
    // ทั้งระบบ ผลคือปุ่ม "ตรวจว่าเครือข่ายนี้โทรได้ไหม" พังทันทีที่ผู้ดูแล
    // ตั้ง TURN — ซึ่งเป็นช่วงเวลาที่คนต้องการเครื่องมือนี้มากที่สุดพอดี
    const seen: RTCConfiguration[] = [];

    class RecordingPeer {
      onicecandidate: ((event: { candidate: unknown }) => void) | null = null;

      constructor(config: RTCConfiguration) {
        seen.push(config);

        // เลียนแบบสเปก: turn: ที่ไม่มี username ต้องโยนทันที
        for (const server of config.iceServers ?? []) {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          const needsAuth = urls.some((url) => url.startsWith('turn'));

          if (needsAuth && !server.username) {
            throw new Error('InvalidAccessError');
          }
        }
      }

      createDataChannel() {
        return {};
      }

      async createOffer() {
        return { type: 'offer', sdp: '' };
      }

      async setLocalDescription() {
        queueMicrotask(() => this.onicecandidate?.({ candidate: null }));
      }

      close() {}
    }

    globalThis.RTCPeerConnection =
      RecordingPeer as unknown as typeof RTCPeerConnection;

    // ต้องไม่โยน — ถ้าโยนแปลว่าส่งชื่อฟิลด์ผิด
    await checkConnectivity(WITH_TURN);

    const turn = seen[0].iceServers?.find((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];

      return urls.some((url) => url.startsWith('turn'));
    });

    expect(turn?.username).toBe('u');
    expect(turn?.credential).toBe('c');
  });
});
