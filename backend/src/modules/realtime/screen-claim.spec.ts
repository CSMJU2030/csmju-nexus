import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsGateway } from './events.gateway.js';
import type { VoiceService } from '../voice/voice.service.js';
import type { Socket } from 'socket.io';

/// เทสต์สิทธิ์แชร์หน้าจอ — หนึ่งห้องแชร์ได้ทีละคน
///
/// **บั๊กที่ต้องกันไว้ตลอดไป: สิทธิ์ค้างของคนที่ออกไปแล้ว**
///
/// สิทธิ์ถูกเก็บในหน่วยความจำของ gateway ส่วนตัวปลดสิทธิ์อัตโนมัติทำงานตอน
/// socket หลุด โดยดูจาก "แถวผู้เข้าร่วมที่ยังเปิดอยู่" ของคนนั้น
///
/// ถ้าคนแชร์กด **ออกจากห้อง** ก่อน (ซึ่งปิดแถวนั้นไปแล้ว) แล้วค่อยปิดแท็บ
/// ตัวปลดจะหาไม่เจอว่าเขาเคยอยู่ห้องไหน สิทธิ์จึงค้างอยู่ **ตลอดไป**
/// ทั้งห้องจะแชร์จอไม่ได้อีกเลยจนกว่าจะรีสตาร์ตหลังบ้าน — โดยขึ้นข้อความว่า
/// "มีคนกำลังแชร์หน้าจออยู่" ทั้งที่ในห้องไม่มีใครแชร์
///
/// หน้าบ้านถูกแก้ให้คืนสิทธิ์ก่อนออกแล้ว แต่ยังมีทางที่คืนไม่ทันอยู่ดี
/// (เน็ตหลุด ไฟดับ เบราว์เซอร์ถูกปิดทั้งตัว) จึงต้องมีตัวกันที่หลังบ้านด้วย

const SESSION = 'session-1';

interface Internals {
  sockets: Map<string, { user: { coreUserId: string } }>;
  presenters: Map<string, string>;
  server: { emit: ReturnType<typeof vi.fn> };
}

/// `activeSessionOf` คืนห้องที่คนนั้นยังอยู่ — เป็นตัวเดียวที่โค้ดนี้เรียกใช้
/// จึงประกอบ gateway ด้วย service ปลอมใบเดียว ไม่ต้องยกทั้ง Nest ขึ้นมา
function makeGateway(inRoom: string[]) {
  const voice = {
    activeSessionOf: vi.fn((coreUserId: string) =>
      Promise.resolve(inRoom.includes(coreUserId) ? SESSION : null),
    ),
    // แชร์จอบันทึกสถานะ sharing ลงห้องเสียงด้วย — ไม่ใช่สิ่งที่ชุดนี้ทดสอบ
    setSharing: vi.fn(() => Promise.resolve()),
  } as unknown as VoiceService;

  const gateway = new EventsGateway(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    voice,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const internals = gateway as unknown as Internals;

  internals.server = { emit: vi.fn() };

  return { gateway, internals, voice };
}

/// socket ปลอมที่ใช้แค่ `id` เป็นกุญแจเข้าตาราง state
function socketOf(id: string): Socket {
  return { id } as Socket;
}

function seat(internals: Internals, socketId: string, coreUserId: string) {
  internals.sockets.set(socketId, { user: { coreUserId } });
}

describe('สิทธิ์แชร์หน้าจอ', () => {
  let ctx: ReturnType<typeof makeGateway>;

  beforeEach(() => {
    ctx = makeGateway(['user-002', 'user-003']);
    seat(ctx.internals, 'socket-a', 'user-002');
    seat(ctx.internals, 'socket-b', 'user-003');
  });

  it('คนที่อยู่ในห้องขอแชร์ได้ และห้องรู้ทันทีว่าใครแชร์', async () => {
    const result = await ctx.gateway.onScreenClaim(socketOf('socket-a'), {
      sessionId: SESSION,
    });

    expect(result.ok).toBe(true);
    expect(ctx.internals.presenters.get(SESSION)).toBe('user-002');
    expect(ctx.internals.server.emit).toHaveBeenCalledWith('screen:changed', {
      sessionId: SESSION,
      presenterCoreUserId: 'user-002',
    });
  });

  it('คนที่ไม่ได้อยู่ในห้องนี้ขอแชร์ไม่ได้', async () => {
    seat(ctx.internals, 'socket-c', 'user-009');

    const result = await ctx.gateway.onScreenClaim(socketOf('socket-c'), {
      sessionId: SESSION,
    });

    expect(result.ok).toBe(false);
    expect(ctx.internals.presenters.has(SESSION)).toBe(false);
  });

  it('มีคนแชร์อยู่จริง ๆ คนที่สองต้องรอ', async () => {
    ctx.internals.presenters.set(SESSION, 'user-002');

    const result = await ctx.gateway.onScreenClaim(socketOf('socket-b'), {
      sessionId: SESSION,
    });

    expect(result.ok).toBe(false);
    expect(result.presenterCoreUserId).toBe('user-002');
    // ต้องไม่แย่งไปเฉย ๆ
    expect(ctx.internals.presenters.get(SESSION)).toBe('user-002');
  });

  it('**สิทธิ์ที่ค้างของคนที่ออกจากห้องไปแล้ว ต้องยึดคืนได้**', async () => {
    // user-002 ถือสิทธิ์อยู่ แต่ไม่ได้อยู่ในห้องแล้ว (ไม่อยู่ในรายชื่อ inRoom)
    ctx = makeGateway(['user-003']);
    seat(ctx.internals, 'socket-b', 'user-003');
    ctx.internals.presenters.set(SESSION, 'user-002');

    const result = await ctx.gateway.onScreenClaim(socketOf('socket-b'), {
      sessionId: SESSION,
    });

    expect(result.ok).toBe(true);
    expect(ctx.internals.presenters.get(SESSION)).toBe('user-003');
  });

  it('กดแชร์ซ้ำโดยคนเดิมไม่ถูกปฏิเสธ', async () => {
    ctx.internals.presenters.set(SESSION, 'user-002');

    const result = await ctx.gateway.onScreenClaim(socketOf('socket-a'), {
      sessionId: SESSION,
    });

    expect(result.ok).toBe(true);
  });

  it('คืนสิทธิ์ได้เฉพาะเจ้าของ — คนอื่นสั่งปล่อยแทนไม่ได้', () => {
    ctx.internals.presenters.set(SESSION, 'user-002');

    ctx.gateway.onScreenRelease(socketOf('socket-b'), { sessionId: SESSION });

    expect(ctx.internals.presenters.get(SESSION)).toBe('user-002');

    ctx.gateway.onScreenRelease(socketOf('socket-a'), { sessionId: SESSION });

    expect(ctx.internals.presenters.has(SESSION)).toBe(false);
    expect(ctx.internals.server.emit).toHaveBeenCalledWith('screen:changed', {
      sessionId: SESSION,
      presenterCoreUserId: null,
    });
  });
});
