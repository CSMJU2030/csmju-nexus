import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์ของชั้น socket
///
/// โค้ดนี้ถือสถานะระดับโมดูล (socket ตัวเดียวทั้งแอป) และมีตรรกะต่อใหม่
/// ที่ทำงานเบื้องหลัง — บั๊กตรงนี้ไม่ทำให้อะไรพังทันที แต่จะทำให้แชท
/// การแจ้งเตือน และสายเรียกเข้าตายเงียบ ๆ พร้อมกันหลังเน็ตกระตุกครั้งเดียว
///
/// ทุกเทสต์ต้อง resetModules เพราะสถานะอยู่ในโมดูล ไม่ใช่ใน instance

interface FakeSocket {
  connected: boolean;
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  emitted: { event: string; payload: unknown }[];
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler?: (...args: unknown[]) => void) => void;
  once: (event: string, handler: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: () => void;
  removeAllListeners: () => void;
  fire: (event: string, ...args: unknown[]) => void;
}

const sockets: FakeSocket[] = [];
let ticketCount = 0;
let failNextConnect = false;

function makeSocket(): FakeSocket {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  const socket: FakeSocket = {
    connected: false,
    handlers,
    emitted: [],
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    off(event, handler) {
      if (!handler) {
        handlers.delete(event);

        return;
      }

      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((row) => row !== handler),
      );
    },
    once(event, handler) {
      socket.on(event, handler);
    },
    emit(event, ...args) {
      socket.emitted.push({ event, payload: args[0] });

      // ack callback ตัวสุดท้าย — จำลองว่าเซิร์ฟเวอร์ตอบทันที
      const ack = args.at(-1);

      if (typeof ack === 'function') {
        (ack as (result: unknown) => void)({ ok: true });
      }
    },
    disconnect() {
      socket.connected = false;
      socket.fire('disconnect', 'io client disconnect');
    },
    removeAllListeners() {
      handlers.clear();
    },
    fire(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
  };

  return socket;
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const socket = makeSocket();

    sockets.push(socket);

    // จำลองการจับมือแบบ async เหมือนของจริง
    queueMicrotask(() => {
      if (failNextConnect) {
        failNextConnect = false;
        socket.fire('connect_error', new Error('ต่อไม่ได้'));

        return;
      }

      socket.connected = true;
      socket.fire('connect');
    });

    return socket;
  }),
}));

vi.mock('./api', () => ({
  api: {
    post: vi.fn(async () => {
      ticketCount += 1;

      return { ticket: `ticket-${ticketCount}`, expiresAt: '' };
    }),
  },
  ApiError: class extends Error {},
}));


beforeEach(() => {
  sockets.length = 0;
  ticketCount = 0;
  failNextConnect = false;
  vi.resetModules();
  vi.useRealTimers();
});

afterEach(async () => {
  const mod = await import('./socket');

  mod.disconnectSocket();
  vi.useRealTimers();
});

describe('connectSocket', () => {
  it('ขอตั๋วก่อนต่อ แล้วต่อได้', async () => {
    const { connectSocket, getSocketStatus } = await import('./socket');
    const { api } = await import('./api');

    const socket = await connectSocket();

    expect(api.post).toHaveBeenCalledWith('/realtime-tickets');
    expect(socket.connected).toBe(true);
    expect(getSocketStatus()).toBe('connected');
  });

  it('เรียกซ้ำได้ socket ตัวเดิม ไม่ต่อใหม่', async () => {
    // ถ้าแต่ละหน้าจอเปิด socket ของตัวเอง การแจ้งเตือนจะมาซ้ำเท่าจำนวนหน้า
    // ที่เปิดอยู่ และ presence จะนับคนเกินจริง
    const { connectSocket } = await import('./socket');

    const first = await connectSocket();
    const second = await connectSocket();

    expect(second).toBe(first);
    expect(sockets).toHaveLength(1);
  });

  it('เรียกพร้อมกันหลายที่ ได้ socket ตัวเดียว', async () => {
    const { connectSocket } = await import('./socket');

    const [a, b, c] = await Promise.all([
      connectSocket(),
      connectSocket(),
      connectSocket(),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(sockets).toHaveLength(1);
  });
});

describe('การต่อใหม่หลังหลุด', () => {
  it('เน็ตกระตุกแล้วต่อใหม่เอง พร้อมขอตั๋วใบใหม่', async () => {
    // ตั๋วใช้ได้ครั้งเดียว — reconnect ในตัวของ socket.io จะใช้ตั๋วใบเดิม
    // แล้วถูกปฏิเสธเสมอ จึงต้องต่อใหม่เองพร้อมขอตั๋วใหม่
    vi.useFakeTimers();

    const { connectSocket, getSocketStatus } = await import('./socket');

    const first = await connectSocket();

    expect(ticketCount).toBe(1);

    // หลุดแบบไม่ได้สั่งปิดเอง
    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    expect(getSocketStatus()).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));

    expect(ticketCount).toBe(2);
  });

  it('เข้าห้องเดิมทั้งหมดหลังต่อกลับ', async () => {
    // socket ใหม่ไม่ได้อยู่ในห้องไหนเลย — ถ้าลืมข้อนี้ ผู้ใช้จะเห็นว่า
    // "ต่อแล้ว" แต่ข้อความใหม่ไม่เข้าอีกเลย
    vi.useFakeTimers();

    const { connectSocket, rememberRoom } = await import('./socket');

    const first = await connectSocket();

    rememberRoom('room-a');
    rememberRoom('room-b');

    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));

    const joins = sockets[1].emitted.filter(
      (row) => row.event === 'channel:join',
    );

    expect(joins.map((row) => row.payload)).toEqual([
      { channelId: 'room-a' },
      { channelId: 'room-b' },
    ]);
  });

  it('handler ที่ผูกไว้ยังทำงานหลังต่อกลับ', async () => {
    // **บั๊กที่ร้ายที่สุดของชั้นนี้**
    //
    // การต่อใหม่สร้าง Socket ตัวใหม่ ส่วน handler ของทุกหน้าจอผูกอยู่กับ
    // ตัวเก่าที่ถูกทิ้งไปแล้ว ผลคือเข้าห้องสำเร็จ เซิร์ฟเวอร์ส่งข้อความมา
    // แต่ไม่มีใครฟัง — แอปหูหนวกถาวรทั้งที่ขึ้นว่า "เชื่อมต่อแล้ว"
    // จนกว่าผู้ใช้จะรีเฟรชเอง
    //
    // เทสต์เดิมของไฟล์นี้จับไม่ได้เลย เพราะมันดูแค่ว่า `channel:join`
    // ถูกส่งซ้ำไหม ซึ่งเป็นฝั่งเซิร์ฟเวอร์ ไม่ใช่ฝั่งผู้ฟัง
    vi.useFakeTimers();

    const { connectSocket, bindSocket } = await import('./socket');

    const first = await connectSocket();
    const onMessage = vi.fn();

    bindSocket(first, 'message:new', onMessage);

    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));

    // เซิร์ฟเวอร์ส่งข้อความมาที่ socket ตัวใหม่
    sockets[1].fire('message:new', { id: 'm1' });

    expect(onMessage).toHaveBeenCalledWith({ id: 'm1' });
  });

  it('ถอด handler แล้วต้องไม่กลับมาทำงานอีกหลังต่อกลับ', async () => {
    // ทะเบียน handler ที่ไม่ลบของที่ถอดแล้ว จะทำให้หน้าจอที่ปิดไปแล้ว
    // ฟื้นขึ้นมาทำงานใหม่หลังเน็ตกระตุก — อาการคือ setState ของ component
    // ที่ unmount ไปแล้ว
    vi.useFakeTimers();

    const { connectSocket, bindSocket } = await import('./socket');

    const first = await connectSocket();
    const onMessage = vi.fn();

    const unbind = bindSocket(first, 'message:new', onMessage);

    unbind();

    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));

    sockets[1].fire('message:new', { id: 'm1' });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('เรียก connectSocket ระหว่างรอต่อใหม่ ต้องไม่ได้ socket สองตัว', async () => {
    // นัดต่อใหม่ที่ค้างอยู่จะตื่นมาสร้าง socket ตัวที่สองทีหลัง แล้วเขียนทับ
    // ตัวที่เพิ่งต่อสำเร็จ — ผู้ใช้คนเดียวมีสองการเชื่อมต่อพร้อมกัน
    // ข้อความเข้าซ้ำสองรอบ และ presence ฝั่งเซิร์ฟเวอร์นับเกินจริง
    vi.useFakeTimers();

    const { connectSocket } = await import('./socket');

    const first = await connectSocket();

    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    // ยังไม่ถึงเวลานัด — หน้าจอเรียกต่อเองก่อน (เช่นผู้ใช้เปิดหน้าใหม่)
    await vi.advanceTimersByTimeAsync(200);

    await connectSocket();

    expect(sockets).toHaveLength(2);

    // ปล่อยให้เลยเวลานัดเดิมไป ต้องไม่มีตัวที่สามโผล่มา
    await vi.advanceTimersByTimeAsync(5000);

    expect(sockets).toHaveLength(2);
  });

  it('ห้องที่ออกไปแล้วไม่ถูกเข้าใหม่', async () => {
    vi.useFakeTimers();

    const { connectSocket, rememberRoom, forgetRoom } = await import(
      './socket'
    );

    const first = await connectSocket();

    rememberRoom('room-a');
    rememberRoom('room-b');
    forgetRoom('room-a');

    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));

    const joins = sockets[1].emitted.filter(
      (row) => row.event === 'channel:join',
    );

    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toEqual({ channelId: 'room-b' });
  });

  it('แจ้ง onSocketReconnect เพื่อให้หน้าจอดึงสิ่งที่พลาดไป', async () => {
    vi.useFakeTimers();

    const { connectSocket, onSocketReconnect } = await import('./socket');
    const onReconnect = vi.fn();

    const first = await connectSocket();

    onSocketReconnect(onReconnect);

    first.connected = false;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
  });

  it('ต่อไม่ติดแล้วหน่วงนานขึ้นเรื่อย ๆ ไม่ถล่มเซิร์ฟเวอร์', async () => {
    vi.useFakeTimers();

    const { connectSocket } = await import('./socket');

    const first = await connectSocket();

    first.connected = false;
    failNextConnect = true;
    (first as unknown as FakeSocket).fire('disconnect', 'transport close');

    // รอบแรกหน่วง 1 วินาที
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));

    // รอบถัดไปต้องหน่วงนานขึ้น — 1 วินาทีจึงยังไม่ต่อใหม่
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(sockets).toHaveLength(3));
  });

  it('สั่งปิดเองแล้วไม่ต่อใหม่', async () => {
    vi.useFakeTimers();

    const { connectSocket, disconnectSocket, getSocketStatus } = await import(
      './socket'
    );

    await connectSocket();
    disconnectSocket();

    expect(getSocketStatus()).toBe('offline');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(sockets).toHaveLength(1);
  });
});

describe('bindSocket', () => {
  it('ถอด handler เฉพาะตัวของตัวเอง ไม่แตะของคนอื่น', async () => {
    // บั๊กที่ตัวนี้แก้: หน้าจอที่เรียก socket.off('rtc:signal') เพื่อเก็บกวาด
    // ตัวเอง จะลบ handler ของ CallProvider ที่ฟัง event เดียวกันไปด้วย
    // ผลคือออกจากหน้าห้องเสียงแล้วสายเรียกเข้าพังทั้งแอป
    const { connectSocket, bindSocket } = await import('./socket');

    const socket = await connectSocket();
    const mine = vi.fn();
    const theirs = vi.fn();

    const unbindMine = bindSocket(socket, 'rtc:signal', mine);

    bindSocket(socket, 'rtc:signal', theirs);

    unbindMine();

    (socket as unknown as FakeSocket).fire('rtc:signal', { kind: 'offer' });

    expect(mine).not.toHaveBeenCalled();
    expect(theirs).toHaveBeenCalledTimes(1);
  });
});

describe('emitWithAck', () => {
  it('คืนผลจาก ack', async () => {
    const { connectSocket, emitWithAck } = await import('./socket');

    const socket = await connectSocket();

    await expect(
      emitWithAck(socket, 'channel:join', { channelId: 'x' }),
    ).resolves.toEqual({ ok: true });
  });

  it('เซิร์ฟเวอร์ไม่ตอบแล้วไม่ค้างตลอดไป', async () => {
    // emit ที่รอ ack แต่ไม่มี timeout จะค้างเงียบ แล้ว UI ติดสถานะ
    // "กำลังส่ง" โดยไม่มีอะไรบอกผู้ใช้
    vi.useFakeTimers();

    const { connectSocket, emitWithAck } = await import('./socket');

    const socket = await connectSocket();

    // socket ที่ไม่เรียก ack กลับ
    socket.emit = (() => undefined) as unknown as typeof socket.emit;

    const pending = emitWithAck(socket, 'message:send', {}, 8000);
    const assertion = expect(pending).rejects.toThrow(/ไม่ได้รับการตอบกลับ/);

    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });
});

describe('onSocketStatus', () => {
  it('บอกสถานะปัจจุบันทันทีที่สมัคร แล้วตามต่อเมื่อเปลี่ยน', async () => {
    const { connectSocket, onSocketStatus } = await import('./socket');
    const seen: string[] = [];

    onSocketStatus((status) => seen.push(status));

    expect(seen).toEqual(['offline']);

    await connectSocket();

    expect(seen).toContain('connected');
  });

  it('เลิกติดตามแล้วไม่ได้รับอีก', async () => {
    const { connectSocket, onSocketStatus } = await import('./socket');
    const handler = vi.fn();

    const stop = onSocketStatus(handler);

    handler.mockClear();
    stop();

    await connectSocket();

    expect(handler).not.toHaveBeenCalled();
  });
});
