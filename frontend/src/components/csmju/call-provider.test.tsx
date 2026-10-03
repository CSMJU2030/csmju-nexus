import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

/// เทสต์ตัวจัดการสาย
///
/// เป็นเครื่องสถานะที่ซับซ้อนที่สุดในหน้าบ้าน: ไมค์ · WebRTC · เสียงกริ่ง ·
/// การรับ/ปฏิเสธ/ยกเลิก และต้องทำงานได้ทุกหน้าจอเพราะอยู่ใน layout
///
/// สิ่งที่ต้องพิสูจน์คือ **ทางที่ผิดพลาด**: ปฏิเสธไมค์ · อีกฝ่ายไม่รับ ·
/// หลังบ้านปฏิเสธ — ทุกทางต้องคืนสถานะให้สะอาด ไม่ค้างสายไว้

/// ปุ่ม "หยุดแชร์หน้าจอ" มีสองที่: บนแถบควบคุมของสาย และบนกรอบจอที่กำลัง
/// แชร์ (แบบ Discord) ทั้งคู่ทำงานเดียวกัน เทสต์จึงต้องระบุให้ชัดว่าอันไหน
function controlButton(name: string) {
  const stage = screen.queryByRole('region', { name: 'จอที่กำลังแชร์' });
  const matches = screen.getAllByRole('button', { name });
  const onControls = matches.filter((button) => !stage?.contains(button));

  if (onControls.length !== 1) {
    throw new Error(`คาดว่าจะเจอปุ่ม "${name}" บนแถบควบคุมหนึ่งปุ่ม แต่เจอ ${onControls.length}`);
  }

  return onControls[0];
}

const handlers = new Map<string, (payload: unknown) => void>();
const emitted: { event: string; payload: unknown }[] = [];

let ackResult: unknown = { ok: true };

/// คำตอบเฉพาะบาง event — ที่เหลือใช้ ackResult
let ackByEvent: Record<string, unknown> = {};

/// `ReturnType<typeof vi.fn>` กว้างเกินไป — มันคือ
/// `Mock<Procedure | Constructable>` ซึ่ง TypeScript ถือว่าเรียกตรง ๆ ไม่ได้
/// ระบุชนิดของฟังก์ชันให้ชัด แล้วยังเรียก .mockRejectedValue() ได้เหมือนเดิม
type AsyncMock = Mock<(...args: unknown[]) => Promise<unknown>>;

function asyncMock(
  implementation: (...args: unknown[]) => Promise<unknown>,
): AsyncMock {
  return vi.fn(implementation);
}

let apiPost: AsyncMock;
let apiDel: AsyncMock;
let apiPatch: AsyncMock;
let getUserMedia: AsyncMock;

/// RTCPeerConnection ปลอม — ต้องเป็น **class** ไม่ใช่ arrow function
///
/// บทเรียนที่เสียเวลาไปหนึ่งรอบ: `vi.fn(() => ({ ... }))` ใช้กับ `new` ไม่ได้
/// เพราะ vitest เรียกผ่าน `Reflect.construct` และ arrow function ไม่ใช่
/// constructor — มันโยน "is not a constructor" ออกมา แล้ว `startCall` ก็ตกเข้า
/// catch ทั่วไป เทสต์จึงแดงหกตัวโดยที่โค้ดจริงไม่ได้ผิดอะไรเลย
///
/// เขียนเป็น class ยังได้ของแถม: ตรวจได้ว่าส่ง ice server อะไรไป ต่อ track
/// กี่เส้น ปิดหรือยัง และ **สั่งให้สถานะการเชื่อมต่อเปลี่ยนได้** ซึ่งเป็น
/// เส้นทางที่ของปลอมแบบเดิมทดสอบไม่ได้เลย
interface FakeSender {
  track: unknown;
  replaceTrack: Mock<(next: unknown) => Promise<void>>;
}

interface FakeDataChannel {
  label: string;
  readyState: string;
  sent: string[];
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send: (data: string) => void;
  close: () => void;
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  static latest(): FakePeerConnection {
    const last = FakePeerConnection.instances.at(-1);

    if (!last) throw new Error('ยังไม่มีการสร้าง RTCPeerConnection');

    return last;
  }

  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ontrack:
    | ((event: { streams: unknown[]; track: { kind: string; addEventListener: () => void } }) => void)
    | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;

  connectionState = 'new';

  /// สถานะการเจรจา — จำเป็นตั้งแต่ย้ายมาใช้ perfect negotiation
  ///
  /// กฎ "ยื่นชนกันแล้วใครถอย" อ่านค่านี้ตัดสิน ถ้าของปลอมค้างที่ 'stable'
  /// ตลอด เทสต์จะไม่มีทางเดินเข้าเส้นทางที่ชนกันเลยสักครั้ง
  signalingState: RTCSignalingState = 'stable';
  closed = false;
  localDescription: unknown = null;
  remoteDescription: unknown = null;

  readonly config: RTCConfiguration;
  readonly addedTracks: unknown[] = [];
  readonly iceCandidates: unknown[] = [];

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  readonly senders: FakeSender[] = [];
  readonly removedSenders: FakeSender[] = [];
  readonly channels: FakeDataChannel[] = [];

  addTrack(track: unknown) {
    this.addedTracks.push(track);

    const sender: FakeSender = {
      track,
      replaceTrack: vi.fn(async (next: unknown) => {
        sender.track = next;
      }),
    };

    this.senders.push(sender);
  }

  /// ช่องประกาศสถานะ (ปิดไมค์ · กล้อง/จอเส้นไหน) — เทสต์ส่งข้อความเข้ามาเองได้
  createDataChannel(label: string) {
    const channel: FakeDataChannel = {
      label,
      readyState: 'connecting',
      sent: [],
      onopen: null,
      onmessage: null,
      send(data: string) {
        this.sent.push(data);
      },
      close() {
        this.readyState = 'closed';
      },
    };

    this.channels.push(channel);

    return channel;
  }

  getSenders() {
    return this.senders;
  }

  removeTrack(sender: FakeSender) {
    this.removedSenders.push(sender);

    const index = this.senders.indexOf(sender);

    if (index !== -1) this.senders.splice(index, 1);
  }

  close() {
    this.closed = true;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'fake-offer' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'fake-answer' };
  }

  /// เรียกแบบไม่ใส่อาร์กิวเมนต์ได้ = เบราว์เซอร์ตัดสินเองว่าเป็น offer
  /// หรือ answer ตามสถานะปัจจุบัน ซึ่งเป็นท่ามาตรฐานของ perfect negotiation
  async setLocalDescription(description?: unknown) {
    const resolved =
      description ??
      (this.signalingState === 'have-remote-offer'
        ? { type: 'answer', sdp: 'fake-answer' }
        : { type: 'offer', sdp: 'fake-offer' });

    this.localDescription = resolved;
    this.signalingState =
      (resolved as { type: string }).type === 'offer'
        ? 'have-local-offer'
        : 'stable';
  }

  async setRemoteDescription(description: unknown) {
    this.remoteDescription = description;
    this.signalingState =
      (description as { type?: string })?.type === 'offer'
        ? 'have-remote-offer'
        : 'stable';
  }

  async addIceCandidate(candidate: unknown) {
    this.iceCandidates.push(candidate);
  }

  /// จำลองให้เบราว์เซอร์แจ้งว่าสถานะการเชื่อมต่อเปลี่ยน
  moveTo(state: string) {
    this.connectionState = state;

    act(() => {
      this.onconnectionstatechange?.();
    });
  }
}

const fakeSocket = {
  on: (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  },
  off: (event: string) => {
    handlers.delete(event);
  },
  emit: (event: string, payload: unknown) => {
    emitted.push({ event, payload });
  },
};

vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn(async () => fakeSocket),
  emitWithAck: vi.fn(
    async (_socket: unknown, event: string, payload: unknown) => {
      emitted.push({ event, payload });

      return ackByEvent[event] ?? ackResult;
    },
  ),
  bindSocket: (
    _socket: unknown,
    event: string,
    handler: (payload: unknown) => void,
  ) => {
    handlers.set(event, handler);

    return () => handlers.delete(event);
  },
}));

vi.mock('@/lib/csmju/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    ApiError,
    api: {
      // ชื่อที่แสดง (useProfile) = รหัสทดสอบขึ้นต้นตัวใหญ่ ('bbb-peer' → 'Bbb-peer')
      // ให้เทสต์ระบุตัวคนได้ตรง ๆ — ห้ามตอบชื่อเดียวกับรหัส เพราะนั่นคือรูปของ
      // "ยังไม่มีชื่อในแคช" ซึ่งหน้าจอแสดงเป็น "ผู้ใช้" แทน · ข้อมูลห้องตอบว่างไว้
      get: async (path: string) =>
        path.startsWith('/profiles?coreUserIds=')
          ? decodeURIComponent(path.slice('/profiles?coreUserIds='.length))
              .split(',')
              .map((id) => ({
                coreUserId: id,
                displayName: id.charAt(0).toUpperCase() + id.slice(1),
                avatarUrl: null,
                syncedAt: null,
                badge: null,
              }))
          : [],
      post: (...args: unknown[]) => apiPost(...args),
      patch: (...args: unknown[]) => apiPatch(...args),
      del: (...args: unknown[]) => apiDel(...args),
    },
  };
});

// ชื่อที่แสดงตอบทันทีแบบ synchronous — ไฟล์นี้ทดสอบระบบโทร ไม่ใช่การโหลดชื่อแบบรวบชุด
// (ทดสอบไว้ใน user-name.test.tsx แล้ว) · ตัวรวบชุดใช้ setTimeout ซึ่งบน runner Linux
// ของ CI ทำให้ชื่อยังไม่ขึ้นทันเวลาที่เทสต์รอ (ตกเฉพาะบน CI ไม่ตกบน Windows)
vi.mock('@/components/csmju/user-name', async () => {
  const actual = await vi.importActual<typeof import('./user-name')>('./user-name');

  return {
    ...actual,
    useProfile: (coreUserId: string) => ({
      coreUserId,
      displayName: coreUserId
        ? coreUserId.charAt(0).toUpperCase() + coreUserId.slice(1)
        : actual.UNKNOWN_NAME,
      avatarUrl: null,
      syncedAt: null,
      badge: null,
    }),
  };
});

vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({
    id: 'aaa-caller',
    email: 'caller@core.local',
    coreRole: 'student',
    subsystemRole: 'GUEST',
  }),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    channelId: 'dm-1',
    startedAt: '2026-09-11T10:00:00.000Z',
    participants: [],
    maxSeats: 2,
    seatsTaken: 1,
    iceServers: [{ urls: ['stun:stun.example:3478'] }],
    turnAvailable: true,
    maxScreenViewers: 4,
    ...overrides,
  };
}

/// track ปลอมหนึ่งเส้น — ต้องมีของจริง ไม่งั้นเทสต์ "ต่อไมค์เข้าสาย" จะเขียว
/// ทั้งที่ไม่ได้ต่ออะไรเลย
let trackSeq = 0;

function makeMicStream(kind: 'audio' | 'video' = 'audio', label = '') {
  // ต้องมี id ที่ไม่ซ้ำเหมือน MediaStreamTrack จริง — โค้ดจริงใช้ id
  // จับคู่ตอนถอนแทร็กออกจากสาย ถ้าของปลอมไม่มี id จะถอนผิดตัว
  const track = {
    id: `track-${(trackSeq += 1)}`,
    kind,
    label,
    enabled: true,
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };

  // เปลี่ยนไมค์/กล้องกลางสายสลับแทร็กใน MediaStream ตัวเดิม — ต้องทำได้จริง
  const tracks: (typeof track)[] = [track];

  return {
    id: `stream-${trackSeq}`,
    getTracks: () => [...tracks],
    getAudioTracks: () => tracks.filter((item) => item.kind === 'audio'),
    getVideoTracks: () => tracks.filter((item) => item.kind === 'video'),
    addTrack: (item: typeof track) => void tracks.push(item),
    removeTrack: (item: typeof track) => {
      const index = tracks.indexOf(item);

      if (index !== -1) tracks.splice(index, 1);
    },
    track,
  };
}

let micStream: ReturnType<typeof makeMicStream>;
let screenStream: ReturnType<typeof makeMicStream>;

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  ackResult = { ok: true };
  ackByEvent = {};
  FakePeerConnection.instances = [];
  vi.resetModules();

  micStream = makeMicStream();
  apiPost = asyncMock(async () => makeSession());
  apiDel = asyncMock(async () => undefined);
  apiPatch = asyncMock(async () => ({ channelId: 'dm-1', sessionId: 'session-1', occupants: [] }));
  getUserMedia = asyncMock(async () => micStream);

  screenStream = makeMicStream();

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      getDisplayMedia: asyncMock(async () => ({
        ...screenStream,
        getVideoTracks: () => [screenStream.track],
      })),
    },
  });

  globalThis.RTCPeerConnection =
    FakePeerConnection as unknown as typeof RTCPeerConnection;
});

afterEach(() => {
  vi.restoreAllMocks();
});

type CallArgs = [
  channelId: string,
  peer: string | string[],
  options?: { kind?: 'AUDIO' | 'VIDEO' },
];

async function renderProvider(args: CallArgs = ['dm-1', 'bbb-peer']) {
  const { CallProvider, useCall } = await import('./call-provider');

  function Caller() {
    const { startCall, inCall } = useCall();

    return (
      <button type="button" onClick={() => void startCall(...args)}>
        {inCall ? 'อยู่ในสาย' : 'โทร'}
      </button>
    );
  }

  render(
    <CallProvider>
      <Caller />
    </CallProvider>,
  );

  // รอให้ provider ผูก handler กับ socket เสร็จก่อน
  await waitFor(() => expect(handlers.has('call:incoming')).toBe(true));
}

/// สายเข้าหนึ่งสาย — รอให้แผ่นรับสายดึงข้อมูลห้อง (ดูว่าเป็นสายกลุ่มไหม) เสร็จด้วย
async function incoming(from = 'ccc-friend', channelId = 'dm-9') {
  await act(async () => {
    handlers.get('call:incoming')?.({
      sessionId: 'session-9',
      channelId: channelId,
      fromCoreUserId: from,
    });
    await Promise.resolve();
  });
}

/// กดโทร → ห้องรอ → "เริ่มการโทร"
///
/// ตั้งแต่มีห้องรอแบบ Instagram การกดโทรยังไม่ส่งเสียงกริ่ง ต้องกดเริ่ม
/// ในห้องรอก่อน (ดู describe 'ห้องรอ' ข้างล่าง)
async function dial() {
  await userEvent.click(screen.getByRole('button', { name: 'โทร' }));
  await userEvent.click(await screen.findByRole('button', { name: 'เริ่มการโทร' }));
}

async function callOut() {
  await dial();
  await screen.findByText(/กำลังโทรหา Bbb-peer/);
}

describe('สายเรียกเข้า', () => {
  it('มีสายเข้าแล้วขึ้นแผ่นรับสาย', async () => {
    await renderProvider();

    await incoming();

    expect(screen.getByText('สายเรียกเข้า…')).toBeInTheDocument();
    // ชื่อมาจากแคชโปรไฟล์ (โหลดแบบรวบชุด) ไม่ใช่ coreUserId ที่มากับสัญญาณ
    expect(await screen.findByText('Ccc-friend')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'สายเรียกเข้าจาก Ccc-friend' })).toBeInTheDocument();
  });

  it('กดรับแล้วเข้าห้องเสียงและตอบว่ารับ', async () => {
    await renderProvider();

    await incoming();
    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/voice-sessions', {
        channelId: 'dm-9',
      }),
    );

    const answer = emitted.find((row) => row.event === 'call:answer');

    expect(answer?.payload).toMatchObject({
      sessionId: 'session-9',
      toCoreUserId: 'ccc-friend',
      accepted: true,
    });
  });

  it('กดปฏิเสธแล้วตอบว่าไม่รับ และแผ่นหายไป', async () => {
    await renderProvider();

    await incoming();
    await userEvent.click(screen.getByRole('button', { name: /ปฏิเสธ/ }));

    const answer = emitted.find((row) => row.event === 'call:answer');

    expect(answer?.payload).toMatchObject({ accepted: false });
    expect(screen.queryByText('สายเรียกเข้า…')).not.toBeInTheDocument();

    // ปฏิเสธแล้วต้องไม่เข้าห้องเสียง และต้องไม่แตะไมค์เลย
    expect(apiPost).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ผู้โทรวางก่อนรับ แผ่นหายเอง', async () => {
    await renderProvider();

    await incoming();
    expect(screen.getByText('สายเรียกเข้า…')).toBeInTheDocument();

    act(() => {
      handlers.get('call:cancelled')?.({
        sessionId: 'session-9',
        fromCoreUserId: 'ccc-friend',
      });
    });

    expect(screen.queryByText('สายเรียกเข้า…')).not.toBeInTheDocument();
  });
});

describe('โทรออก', () => {
  it('ขอไมค์ เข้าห้อง แล้วส่งเสียงกริ่ง', async () => {
    await renderProvider();

    await dial();

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    expect(apiPost).toHaveBeenCalledWith('/voice-sessions', {
      channelId: 'dm-1',
    });

    const ring = emitted.find((row) => row.event === 'call:ring');

    expect(ring?.payload).toMatchObject({
      sessionId: 'session-1',
      toCoreUserId: 'bbb-peer',
    });
  });

  it('ระหว่างรอรับ แสดงว่ากำลังโทรหาใคร', async () => {
    await renderProvider();

    await dial();

    expect(await screen.findByText(/กำลังโทรหา Bbb-peer/)).toBeInTheDocument();
  });

  it('อีกฝ่ายปฏิเสธ แล้วสายถูกเก็บให้สะอาด', async () => {
    // ถ้าไม่เก็บ ผู้โทรจะค้างอยู่ในหน้าจอ "กำลังโทร" ตลอดไป
    await renderProvider();

    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: false,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );

    expect(await screen.findByText(/Bbb-peer ปฏิเสธสาย/)).toBeInTheDocument();

    // ไมค์ต้องถูกปล่อย ไม่งั้นไฟไมค์ค้างติดทั้งที่ไม่มีสายแล้ว
    expect(micStream.track.stop).toHaveBeenCalled();
    expect(FakePeerConnection.latest().closed).toBe(true);
  });

  it('อีกฝ่ายรับ แล้วเลิกแสดงว่ากำลังโทร', async () => {
    await renderProvider();

    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );

    // ระบุด้วย role — VoiceChat เองก็มีหัวข้อว่า "อยู่ในสาย" อยู่ในแผง
    expect(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    ).toBeInTheDocument();

    // รับแล้วต้องไม่ปิดสายทิ้ง — พลาดตรงนี้ได้ง่ายเพราะ teardown อยู่ใน
    // เส้นทางเดียวกับการถูกปฏิเสธ
    expect(FakePeerConnection.latest().closed).toBe(false);
  });
});

describe('เก็บสายให้สะอาดทุกทาง', () => {
  /// ทำให้สายอยู่ในสถานะ "รับแล้ว" เพื่อทดสอบการวางสาย
  async function answeredCall() {
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );
  }

  it('ถูกปฏิเสธแล้วต้องออกจากห้องเสียงด้วย ไม่ใช่แค่เก็บฝั่งตัวเอง', async () => {
    // ห้อง DM มี 2 ที่นั่ง ถ้าไม่ออก ที่นั่งจะค้างจนโทรซ้ำไม่ได้อีกเลย
    // ทั้งที่ไม่มีใครอยู่ในสาย
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: false,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith(
        '/voice-sessions/session-1/participants/me',
      ),
    );
  });

  it('กริ่งไม่ผ่านแล้วต้องออกจากห้องเสียง', async () => {
    ackResult = { ok: false, error: 'โทรหาคนนี้ไม่ได้' };

    await renderProvider();
    await dial();

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith(
        '/voice-sessions/session-1/participants/me',
      ),
    );
  });

  it('วางสายที่รับแล้วต้องบอกอีกฝั่งด้วย call:end', async () => {
    // call:cancel ถูกส่งเฉพาะตอนยังไม่มีใครรับ สายที่รับแล้วจึงเคยวางแบบ
    // เงียบสนิท ปล่อยให้อีกฝั่งนั่งมองแผงสายที่ตายไปแล้ว
    await answeredCall();

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    const ended = emitted.find((row) => row.event === 'call:end');

    expect(ended?.payload).toMatchObject({
      sessionId: 'session-1',
      toCoreUserId: 'bbb-peer',
    });

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith(
        '/voice-sessions/session-1/participants/me',
      ),
    );
  });

  it('ยังไม่มีใครรับแล้ววาง = ส่ง call:cancel ไม่ใช่ call:end', async () => {
    await renderProvider();
    await callOut();

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    expect(emitted.some((row) => row.event === 'call:cancel')).toBe(true);
    expect(emitted.some((row) => row.event === 'call:end')).toBe(false);
  });

  it('อีกฝั่งวางสาย แล้วฝั่งเราต้องเก็บตาม', async () => {
    await answeredCall();

    act(() => {
      handlers.get('call:ended')?.({
        sessionId: 'session-1',
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'โทร' })).toBeInTheDocument(),
    );

    expect(micStream.track.stop).toHaveBeenCalled();
    expect(FakePeerConnection.latest().closed).toBe(true);
  });

  it('call:ended จากคนอื่นต้องไม่ทำให้สายเราหลุด', async () => {
    await answeredCall();

    act(() => {
      handlers.get('call:ended')?.({
        sessionId: 'session-1',
        fromCoreUserId: 'zzz-stranger',
      });
    });

    expect(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    ).toBeInTheDocument();
    expect(FakePeerConnection.latest().closed).toBe(false);
  });

  it('call:ended ของสายเก่าที่มาช้าต้องไม่ตัดสายปัจจุบัน', async () => {
    // คนเดิม แต่คนละ session — เกิดได้จริงเมื่อวางสายแรกแล้วโทรใหม่ทันที
    // แล้ว event ของสายแรกเพิ่งเดินทางมาถึง
    //
    // ต้องแยกเทสต์จากกรณี "คนอื่นส่งมา" เพราะด่านชื่อผู้ส่งถูกตรวจก่อน
    // ถ้ารวมเป็นเทสต์เดียว ด่าน session จะถูกลบทิ้งได้โดยไม่มีอะไรแดง
    await answeredCall();

    act(() => {
      handlers.get('call:ended')?.({
        sessionId: 'session-เก่า',
        fromCoreUserId: 'bbb-peer',
      });
    });

    expect(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    ).toBeInTheDocument();
    expect(FakePeerConnection.latest().closed).toBe(false);
  });

  it('วางสายตอนกำลังแชร์หน้าจอ ต้องคืนสิทธิ์แชร์ด้วย', async () => {
    // ไม่คืน = ห้องล็อกไว้ให้คนที่ออกไปแล้ว อีกฝ่ายกดแชร์ไม่ได้จนจบ session
    await answeredCall();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    await waitFor(() =>
      expect(controlButton('หยุดแชร์หน้าจอ')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    expect(emitted.some((row) => row.event === 'screen:release')).toBe(true);
  });

  it('โทรซ้อนสายที่คุยอยู่ไม่ได้', async () => {
    // เดิม setActive ทับของเก่าดื้อ ๆ แล้ว peer ตัวเดิมก็ลอยอยู่โดยไม่ถูกปิด
    await answeredCall();

    const peersBefore = FakePeerConnection.instances.length;

    await userEvent.click(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    );

    expect(await screen.findByText(/วางสายก่อน/)).toBeInTheDocument();
    expect(FakePeerConnection.instances).toHaveLength(peersBefore);
  });
});

describe('WebRTC', () => {
  it('ส่ง ice server ที่หลังบ้านให้มาเข้า peer connection', async () => {
    // ถ้าลืมส่ง สายจะติดเฉพาะคนที่อยู่วงแลนเดียวกัน แล้วจะกลายเป็นอาการ
    // "บางคนโทรได้ บางคนไม่ได้" โดยไม่มี error อะไรเลย
    apiPost = asyncMock(async () =>
      makeSession({
        iceServers: [
          {
            urls: ['turn:turn.example:3478'],
            username: 'u1',
            credential: 'c1',
          },
        ],
      }),
    );

    await renderProvider();
    await callOut();

    // **ชื่อฟิลด์ต้องเป็น `username` ตามมาตรฐาน WebRTC เป๊ะ ๆ**
    //
    // เทสต์นี้เคยยืนยัน `coreUserId` เพราะโดนกวาดเปลี่ยนชื่อไปพร้อมกับโค้ด
    // ตอนย้ายคีย์ตัวตนทั้งระบบ — มันจึง **ล็อกบั๊กเอาไว้** แทนที่จะจับมัน
    //
    // บั๊กนั้นร้ายเพราะไม่มีอะไรดังเลย: เบราว์เซอร์มองข้ามฟิลด์ที่ไม่รู้จัก
    // แล้ว TURN ปฏิเสธการยืนยันตัวตน คนหลัง NAT เข้มงวดจึงเชื่อมเสียงไม่ติด
    // โดยไม่มี error ให้ใครเห็น
    const servers = FakePeerConnection.latest().config.iceServers ?? [];
    const server = servers[0] as unknown as Record<string, unknown>;

    expect(server).toEqual({
      urls: ['turn:turn.example:3478'],
      username: 'u1',
      credential: 'c1',
    });

    // กันชื่ออื่นที่ WebRTC ไม่รู้จักหลุดเข้าไป
    expect(Object.keys(server).sort()).toEqual([
      'credential',
      'urls',
      'username',
    ]);
  });

  it('ต่อเสียงไมค์เข้าสาย', async () => {
    await renderProvider();
    await callOut();

    expect(FakePeerConnection.latest().addedTracks).toEqual([micStream.track]);
  });

  /// อีกฝ่ายตอบ `answer` กลับมา = จบการจับมือหนึ่งรอบ สายกลับสู่ stable
  ///
  /// **ต้องเรียกทุกครั้งหลังยื่น offer** ไม่งั้นสายจะค้างที่ have-local-offer
  /// แล้วรอบเจรจาถัดไปจะถูกข้ามด้วยกฎ "ยื่นได้ทีละรอบ" ซึ่งเป็นพฤติกรรมที่
  /// ถูกต้องของโค้ดจริง — ของปลอมที่ไม่เคยตอบกลับต่างหากที่ไม่เหมือนจริง
  async function peerAnswers(fromCoreUserId = 'bbb-peer') {
    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: fromCoreUserId,
        kind: 'answer',
        data: { type: 'answer', sdp: 'ของอีกฝ่าย' },
      });
    });
  }

  function offersSent() {
    return emitted.filter(
      (row) =>
        row.event === 'rtc:signal' &&
        (row.payload as { kind?: string }).kind === 'offer',
    );
  }

  it('ยังไม่มีใครรับ = ยังไม่ยื่น offer', async () => {
    // **บั๊กที่เคยทำให้สายไม่ติดเลยสักสาย**
    //
    // ยื่นตอนนี้ = อีกฝ่ายยังไม่มีแถวผู้เข้าร่วม หลังบ้าน
    // (voice.service `sharesVoiceSession`) จึงทิ้ง SDP ทิ้งไปเงียบ ๆ
    // แล้วไม่มีใครยื่นซ้ำอีกเลย
    await renderProvider();
    await callOut();

    // รอให้ทุกอย่างที่ค้างอยู่เดินจนจบก่อนค่อยสรุป
    await act(async () => {
      await Promise.resolve();
    });

    expect(offersSent()).toHaveLength(0);
    expect(FakePeerConnection.latest().localDescription).toBeNull();
  });

  it('อีกฝ่ายกดรับแล้วจึงยื่น offer', async () => {
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));

    expect(offersSent()[0].payload).toMatchObject({
      toCoreUserId: 'bbb-peer',
      kind: 'offer',
    });

    expect(FakePeerConnection.latest().localDescription).toMatchObject({
      type: 'offer',
    });
  });

  it('**ผู้รับสายไม่ยื่นชนผู้โทร** — รอข้อเสนอแรกแล้วตอบ (กันบั๊กม้วนข้อเสนอของ Chrome)', async () => {
    // เดิมยื่นพร้อมกันทั้งสองฝั่งแล้วให้กฎ polite ตัดสิน ถูกตามสเปก แต่ใน Chrome
    // จริงฝ่ายที่ม้วนข้อเสนอแรกทิ้งบางครั้งเก็บ ICE ของคำตอบไม่ออกเลย สายค้าง
    // "กำลังเชื่อมต่อ" ราวหนึ่งในสามรอบ (ดู accept ใน call-provider)
    await renderProvider();

    act(() => {
      handlers.get('call:incoming')?.({
        sessionId: 'session-9',
        channelId: 'dm-9',
        fromCoreUserId: 'AAA-earlier',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    await act(async () => {
      await Promise.resolve();
    });

    expect(offersSent()).toHaveLength(0);

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'AAA-earlier',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของผู้โทร' },
      });
    });

    expect(
      emitted.some(
        (row) =>
          row.event === 'rtc:signal' &&
          (row.payload as { kind?: string }).kind === 'answer',
      ),
    ).toBe(true);
  });

  it('ข้อเสนอของผู้โทรไม่มาภายในเวลาที่กำหนด (สัญญาณหาย) = ผู้รับสายยื่นเอง', async () => {
    await renderProvider();
    await incoming();

    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    expect(offersSent()).toHaveLength(0);

    await waitFor(() => expect(offersSent()).toHaveLength(1), { timeout: 6000 });
    expect(offersSent()[0].payload).toMatchObject({ toCoreUserId: 'ccc-friend' });
  }, 10_000);

  it('**ผู้รับสายแชร์หน้าจอแล้วยื่น offer เอง ไม่ใช่ไปขอให้อีกฝ่ายยื่น**', async () => {
    // บั๊กเดิม: ฝั่งที่ไม่ได้ถูกเลือกให้เป็นผู้ยื่น จะส่ง `renegotiate` ไปขอ
    // ให้อีกฝั่งเปิดรอบให้ — แต่ข้อเสนอที่อีกฝั่งสร้างมีเฉพาะช่องสื่อของเขา
    // เอง ส่วนแทร็กหน้าจอของเราไม่มีช่องรองรับ และเราเพิ่มช่องในคำตอบไม่ได้
    // (JSEP บังคับว่าคำตอบต้องมี m-section เท่าข้อเสนอ)
    await renderProvider();

    act(() => {
      handlers.get('call:incoming')?.({
        sessionId: 'session-9',
        channelId: 'dm-9',
        fromCoreUserId: 'AAA-earlier',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    // จับมือรอบแรก: ผู้โทรยื่นมา เราตอบ
    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'AAA-earlier',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของผู้โทร' },
      });
    });

    const before = offersSent().length;

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    // ยื่นเองจริง
    await waitFor(() => expect(offersSent().length).toBe(before + 1));

    // และไม่ไปขอใครให้ยื่นแทน
    expect(
      emitted.some(
        (row) =>
          row.event === 'rtc:signal' &&
          (row.payload as { kind?: string }).kind === 'renegotiate',
      ),
    ).toBe(false);
  });

  it('ผู้แชร์เห็นจอของตัวเองระหว่างอยู่ในสาย', async () => {
    // ของเดิม remoteStream ถูกยัดเข้า <audio> อย่างเดียว ภาพหน้าจอที่เจรจา
    // มาได้จึงไม่ถูกเรนเดอร์ที่ไหนเลย — ไม่มีใครเห็นภาพสักฝ่าย
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    expect(
      await screen.findByRole('region', { name: 'จอที่กำลังแชร์' }),
    ).toBeInTheDocument();
    expect(screen.getByText('คุณกำลังแชร์หน้าจอนี้')).toBeInTheDocument();
  });

  it('หลังบ้านส่งสัญญาณต่อไม่ได้ = บอกผู้ใช้ ไม่ใช่ค้างที่กำลังเชื่อมต่อ', async () => {
    // เดิม emit แบบไม่รอ ack คำปฏิเสธของหลังบ้านจึงถูกทิ้ง
    // ผู้ใช้เห็นแต่ "กำลังเชื่อมต่อ" ค้างไว้โดยไม่มีอะไรอธิบาย
    ackByEvent = {
      'rtc:signal': { ok: false, error: 'ปลายทางไม่ได้อยู่ในห้องเสียงเดียวกับคุณ' },
    };

    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    expect(
      await screen.findByText(/ไม่ได้อยู่ในห้องเสียงเดียวกับคุณ/),
    ).toBeInTheDocument();
  });

  it('ได้คำขอ renegotiate แล้วยื่น offer รอบใหม่', async () => {
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    await peerAnswers();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'bbb-peer',
        kind: 'renegotiate',
        data: null,
      });
    });

    expect(offersSent()).toHaveLength(2);
  });

  it('ได้ offer มาแล้วตอบ answer กลับ', async () => {
    await renderProvider();
    await callOut();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'bbb-peer',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของอีกฝ่าย' },
      });
    });

    const peer = FakePeerConnection.latest();

    expect(peer.remoteDescription).toMatchObject({ sdp: 'ของอีกฝ่าย' });
    expect(peer.localDescription).toMatchObject({ type: 'answer' });

    const answer = emitted.find(
      (row) =>
        row.event === 'rtc:signal' &&
        (row.payload as { kind?: string }).kind === 'answer',
    );

    expect(answer?.payload).toMatchObject({ toCoreUserId: 'bbb-peer' });
  });

  it('ice candidate ที่มาก่อน remote description ไม่ทำให้สายพัง', async () => {
    await renderProvider();
    await callOut();

    const peer = FakePeerConnection.latest();

    peer.addIceCandidate = async () => {
      throw new Error('remote description ยังไม่ถูกตั้ง');
    };

    // ต้องไม่โยนออกมา ไม่งั้นจะกลายเป็น unhandled rejection
    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'bbb-peer',
        kind: 'ice',
        data: { candidate: 'x' },
      });
    });

    expect(screen.getByText(/กำลังโทรหา Bbb-peer/)).toBeInTheDocument();
  });

  it('เริ่มแชร์หน้าจอแล้วต้องเปิดรอบเจรจาใหม่ ไม่ใช่แค่เพิ่มแทร็ก', async () => {
    // **บั๊กที่ตัวนี้กัน:** addTrack เข้าสายที่ต่ออยู่แล้ว ไม่ทำให้ภาพวิ่งไปเอง
    // ต้องมีรอบ offer/answer ใหม่เสมอ ถ้าลืม ผู้แชร์จะเห็นแถบ "กำลังแชร์"
    // ของเบราว์เซอร์และ UI ขึ้นว่าแชร์อยู่ แต่ปลายทางไม่ได้รับอะไรเลย
    // และไม่มี error ให้เห็นสักตัว
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    await peerAnswers();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    // ต้องมี offer รอบที่สองหลังเพิ่มแทร็กหน้าจอ
    await waitFor(() => expect(offersSent()).toHaveLength(2));

    expect(FakePeerConnection.latest().addedTracks).toContain(
      screenStream.track,
    );
  });

  it('หยุดแชร์แล้วต้องถอนแทร็กออกจากสายและเจรจาใหม่', async () => {
    // แค่ track.stop() ไม่พอ — sender ยังอยู่ในสายและ SDP ยังบอกว่ามีช่อง
    // วิดีโออยู่ ฝั่งผู้ชมจะเห็นภาพค้างที่เฟรมสุดท้ายแทนที่จะหายไป
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        fromCoreUserId: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    await peerAnswers();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));
    await waitFor(() => expect(offersSent()).toHaveLength(2));
    await peerAnswers();

    await userEvent.click(controlButton('หยุดแชร์หน้าจอ'));

    const peer = FakePeerConnection.latest();

    // ถอนออกจริง
    expect(peer.removedSenders.map((sender) => sender.track)).toContain(
      screenStream.track,
    );

    // และเจรจาใหม่ให้อีกฝั่งรู้ว่าช่องวิดีโอหายไปแล้ว
    await waitFor(() => expect(offersSent()).toHaveLength(3));

    // ปิดแทร็กด้วย ไม่งั้นไฟแสดงการแชร์ของเบราว์เซอร์ยังติดค้าง
    expect(screenStream.track.stop).toHaveBeenCalled();
  });

  it('ต่อไม่ติดและไม่มี TURN = บอกสาเหตุจริง', async () => {
    // ไม่มี TURN แล้วอยู่หลัง NAT แบบเข้มงวด = ต่อไม่ติดตลอดกาล
    // ถ้าไม่บอก ผู้ใช้จะนั่งรอหน้าจอ "กำลังเชื่อมต่อ" ไปเรื่อย ๆ
    apiPost = asyncMock(async () => makeSession({ turnAvailable: false }));

    await renderProvider();
    await callOut();

    FakePeerConnection.latest().moveTo('failed');

    expect(await screen.findByText(/ต้องมี TURN server/)).toBeInTheDocument();
  });
});

describe('ทางที่ผิดพลาด', () => {
  it('ผู้ใช้ไม่อนุญาตไมค์ = บอกให้ไปอนุญาต ไม่ค้างสาย', async () => {
    getUserMedia.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    await renderProvider();

    await dial();

    expect(
      await screen.findByText(/เข้าถึงไมโครโฟนไม่ได้/),
    ).toBeInTheDocument();

    // ต้องไม่ค้างสถานะว่าอยู่ในสาย
    expect(screen.getByRole('button', { name: 'โทร' })).toBeInTheDocument();
  });

  it('หลังบ้านปฏิเสธการส่งกริ่ง = แสดงเหตุผลและเก็บสายให้สะอาด', async () => {
    ackResult = { ok: false, error: 'โทรหาคนนี้ไม่ได้' };

    await renderProvider();

    await dial();

    expect(await screen.findByText(/โทรหาคนนี้ไม่ได้/)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );

    expect(micStream.track.stop).toHaveBeenCalled();
  });

  it('เข้าห้องเสียงไม่ได้ (ห้องเต็ม) = แสดงข้อความจากหลังบ้าน', async () => {
    const { ApiError } = await import('@/lib/csmju/api');

    apiPost.mockRejectedValue(
      new (ApiError as new (
        status: number,
        code: string,
        message: string,
      ) => Error)(409, 'conflict', 'ห้องเต็มแล้ว (2/2 คน)'),
    );

    await renderProvider();

    await dial();

    expect(await screen.findByText(/ห้องเต็มแล้ว/)).toBeInTheDocument();
  });

  it('รับสายตอนห้องเต็ม = ไม่ค้างแผ่นรับสายไว้', async () => {
    const { ApiError } = await import('@/lib/csmju/api');

    apiPost.mockRejectedValue(
      new (ApiError as new (
        status: number,
        code: string,
        message: string,
      ) => Error)(409, 'conflict', 'ห้องเต็มแล้ว (2/2 คน)'),
    );

    await renderProvider();

    await incoming();
    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));

    expect(await screen.findByText(/ห้องเต็มแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText('สายเรียกเข้า…')).not.toBeInTheDocument();
  });
});


// ────────────────────────────────────────────────────────────
// แบบ Instagram: ห้องรอ · ทางลัด · อุปกรณ์ · แชร์จอ · ให้คะแนน · สายกลุ่ม
// ────────────────────────────────────────────────────────────

async function answeredOut(from = 'bbb-peer') {
  await callOut();

  act(() => {
    handlers.get('call:answered')?.({ accepted: true, fromCoreUserId: from });
  });

  await waitFor(() =>
    expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
  );
}

function sent(event: string) {
  return emitted.filter((row) => row.event === event);
}

function recipients(event: string) {
  return sent(event).map((row) => (row.payload as { toCoreUserId: string }).toCoreUserId);
}

function fakeDevices(list: { deviceId: string; kind: string; label: string; groupId: string }[]) {
  Object.assign(navigator.mediaDevices, {
    enumerateDevices: vi.fn(async () => list),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe('ห้องรอก่อนโทร', () => {
  it('กดโทรแล้วขึ้นห้องรอ — ยังไม่ขอไมค์ ไม่เข้าห้องเสียง ไม่มีเสียงกริ่ง', async () => {
    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(await screen.findByText('พร้อมที่จะโทรแล้วใช่ไหม')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เริ่มการโทร' })).toBeInTheDocument();

    // สายเสียงเริ่มที่กล้องปิด
    expect(screen.getByText('ปิดกล้องอยู่')).toBeInTheDocument();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(sent('call:ring')).toHaveLength(0);
  });

  it('ปิดห้องรอด้วย Esc = ไม่มีอะไรหลุดไปถึงใคร', async () => {
    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));
    await screen.findByText('พร้อมที่จะโทรแล้วใช่ไหม');

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByText('พร้อมที่จะโทรแล้วใช่ไหม')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'โทร' })).toBeInTheDocument();
    expect(sent('call:ring')).toHaveLength(0);
  });

  it('สายวิดีโอเปิดกล้องให้ตั้งแต่ห้องรอ และกล้องนั้นเข้าสายด้วย', async () => {
    const camera = makeMicStream('video', 'fake camera');

    getUserMedia.mockImplementation(async (constraints) =>
      (constraints as MediaStreamConstraints).video ? camera : micStream,
    );

    await renderProvider(['dm-1', 'bbb-peer', { kind: 'VIDEO' }]);

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(await screen.findByRole('button', { name: 'ปิดกล้อง' })).toBeInTheDocument();
    expect(screen.queryByText('ปิดกล้องอยู่')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'เริ่มการโทร' }));
    await screen.findByText(/กำลังโทรหา Bbb-peer/);

    expect(FakePeerConnection.latest().addedTracks).toEqual([
      micStream.track,
      camera.track,
    ]);
  });

  it('ปิดไมค์ในห้องรอแล้วเริ่มโทร = เข้าสายแบบปิดไมค์', async () => {
    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));
    await userEvent.click(await screen.findByRole('button', { name: 'ปิดไมค์' }));
    await userEvent.click(screen.getByRole('button', { name: 'เริ่มการโทร' }));
    await screen.findByText(/กำลังโทรหา Bbb-peer/);

    expect(micStream.track.enabled).toBe(false);
    expect(screen.getByRole('button', { name: 'เปิดไมค์' })).toBeInTheDocument();
  });
});

describe('ทางลัดแป้นพิมพ์ในสาย', () => {
  function press(code: string) {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), altKey: true }),
      );
    });
  }

  it('alt+m ปิด/เปิดไมค์', async () => {
    await renderProvider();
    await answeredOut();

    press('KeyM');
    expect(micStream.track.enabled).toBe(false);
    expect(screen.getByRole('button', { name: 'เปิดไมค์' })).toBeInTheDocument();

    press('KeyM');
    expect(micStream.track.enabled).toBe(true);
  });

  it('alt+p เปิดกล่องการตั้งค่า พร้อมตารางทางลัด', async () => {
    await renderProvider();
    await answeredOut();

    press('KeyP');

    const dialog = await screen.findByRole('dialog', { name: 'การตั้งค่า' });

    expect(dialog).toHaveTextContent('ทางลัดแป้นพิมพ์');
    expect(dialog).toHaveTextContent('alt+e');

    // ยังไม่อนุญาตกล้อง = ชวนให้อนุญาต ไม่ใช่ช่องเลือกว่าง ๆ
    expect(dialog).toHaveTextContent('อนุญาตให้ใช้กล้องเพื่อให้คนอื่นๆ มองเห็นคุณได้');

    await userEvent.click(screen.getByRole('button', { name: 'เรียบร้อย' }));
    expect(screen.queryByRole('dialog', { name: 'การตั้งค่า' })).not.toBeInTheDocument();
  });

  it('alt+e วางสาย', async () => {
    await renderProvider();
    await answeredOut();

    press('KeyE');

    await waitFor(() => expect(sent('call:end')).toHaveLength(1));
  });

  it('alt+s แชร์หน้าจอ', async () => {
    await renderProvider();
    await answeredOut();

    press('KeyS');

    expect(await screen.findByRole('region', { name: 'จอที่กำลังแชร์' })).toBeInTheDocument();
  });

  it('ไม่ได้อยู่ในสาย ทางลัดไม่ทำอะไร', async () => {
    await renderProvider();

    press('KeyE');
    press('KeyP');

    expect(emitted).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'การตั้งค่า' })).not.toBeInTheDocument();
  });
});

describe('เปลี่ยนอุปกรณ์กลางสาย', () => {
  it('เลือกไมค์ใหม่ = replaceTrack บนสายเดิม ไม่ต้องเจรจาใหม่', async () => {
    fakeDevices([
      { deviceId: 'default', kind: 'audioinput', label: 'Default - Mic A', groupId: 'a' },
      { deviceId: 'mic-a', kind: 'audioinput', label: 'Mic A', groupId: 'a' },
      { deviceId: 'mic-b', kind: 'audioinput', label: 'Mic B', groupId: 'b' },
    ]);

    const nextMic = makeMicStream('audio', 'Mic B');

    await renderProvider();
    await answeredOut();

    const peer = FakePeerConnection.latest();
    const micSender = peer.senders.find((sender) => sender.track === micStream.track)!;
    const signalsBefore = sent('rtc:signal').length;

    getUserMedia.mockResolvedValueOnce(nextMic);

    await userEvent.click(screen.getByRole('button', { name: 'การตั้งค่า' }));
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'เลือกไมโครโฟน' }),
      'mic-b',
    );

    await waitFor(() => expect(micSender.replaceTrack).toHaveBeenCalledWith(nextMic.track));

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'mic-b' } }),
      video: false,
    });

    // ไมค์เก่าถูกปิด ไม่ค้างไฟ
    expect(micStream.track.stop).toHaveBeenCalled();

    // ไม่มีรอบ offer ใหม่ — อีกฝ่ายไม่สะดุด
    expect(sent('rtc:signal').length).toBe(signalsBefore);

    expect(await screen.findByText('เชื่อมต่อไมโครโฟนแล้ว: Mic B')).toBeInTheDocument();
  });

  it('เริ่มโทรแล้วบอกว่าใช้ไมค์และลำโพงตัวไหน', async () => {
    fakeDevices([
      { deviceId: 'default', kind: 'audioinput', label: 'Default - Mic A', groupId: 'a' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default - Speakers', groupId: 's' },
    ]);

    await renderProvider();
    await callOut();

    expect(
      await screen.findByText('เชื่อมต่อไมโครโฟนแล้ว: ค่าเริ่มต้น - Mic A'),
    ).toBeInTheDocument();
    expect(screen.getByText('เชื่อมต่อลำโพงแล้ว: ค่าเริ่มต้น - Speakers')).toBeInTheDocument();
  });
});

describe('ภาพตัวอย่างจอที่แชร์', () => {
  it('ย่อไปชิดขอบได้ และดึงกลับได้', async () => {
    await renderProvider();
    await answeredOut();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));
    await screen.findByRole('region', { name: 'จอที่กำลังแชร์' });

    // ปุ่มแชร์บนแถบควบคุมแสดงว่ากำลังแชร์อยู่
    expect(controlButton('หยุดแชร์หน้าจอ')).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'ย่อภาพตัวอย่างจอที่แชร์' }));

    const handle = screen.getByRole('button', { name: 'ขยายภาพตัวอย่างจอที่แชร์' });

    expect(handle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(handle);
    expect(
      screen.getByRole('button', { name: 'ย่อภาพตัวอย่างจอที่แชร์' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('**หยุดจากแถบของเบราว์เซอร์** — ภาพตัวอย่างหาย คืนสิทธิ์ และปุ่มกลับเป็นปกติ', async () => {
    await renderProvider();
    await answeredOut();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));
    await screen.findByRole('region', { name: 'จอที่กำลังแชร์' });

    await act(async () => {
      screenStream.track.onended?.();
    });

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'จอที่กำลังแชร์' })).not.toBeInTheDocument(),
    );
    expect(sent('screen:release')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'แชร์หน้าจอ' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('ปุ่ม "หยุด" บนภาพตัวอย่างหยุดแชร์จริง', async () => {
    await renderProvider();
    await answeredOut();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    const stage = await screen.findByRole('region', { name: 'จอที่กำลังแชร์' });
    const stop = [...stage.querySelectorAll('button')].find((b) => b.textContent === 'หยุด')!;

    await userEvent.click(stop);

    await waitFor(() => expect(screenStream.track.stop).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'จอที่กำลังแชร์' })).not.toBeInTheDocument();
  });
});

describe('จบสายและให้คะแนน', () => {
  let now = 1_000_000;

  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  it('คุยกันนานพอ → สิ้นสุดการโทร → ให้ดาวแล้วส่งเวลาคุยจริง', async () => {
    await renderProvider();
    await answeredOut();

    FakePeerConnection.latest().moveTo('connected');
    now += 42_000;

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    expect(await screen.findByText('สิ้นสุดการโทรแล้ว')).toBeInTheDocument();

    const star = await screen.findByRole('button', { name: '4 ดาว' }, { timeout: 3000 });

    expect(screen.getByText('คุณภาพการโทรของคุณเป็นอย่างไรบ้าง')).toBeInTheDocument();

    await userEvent.click(star);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/calls/feedback', {
        channelId: 'dm-1',
        rating: 4,
        durationSec: 42,
        kind: 'AUDIO',
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText('สิ้นสุดการโทรแล้ว')).not.toBeInTheDocument(),
    );
  });

  it('"ไม่ใช่ตอนนี้" ปิดโดยไม่ส่งอะไร', async () => {
    await renderProvider();
    await answeredOut();

    FakePeerConnection.latest().moveTo('connected');
    now += 30_000;

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'ไม่ใช่ตอนนี้' }, { timeout: 3000 }),
    );

    expect(screen.queryByText('สิ้นสุดการโทรแล้ว')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalledWith('/calls/feedback', expect.anything());
  });

  it('ส่งไม่สำเร็จ = บอกเหตุผล และยังกดใหม่ได้ (ไม่ปิดทิ้งเงียบ ๆ)', async () => {
    await renderProvider();
    await answeredOut();

    FakePeerConnection.latest().moveTo('connected');
    now += 30_000;

    const { ApiError } = await import('@/lib/csmju/api');

    apiPost.mockImplementation(async (path) => {
      if (path === '/calls/feedback') {
        throw new (ApiError as new (s: number, c: string, m: string) => Error)(
          404,
          'not_found',
          'ไม่พบ endpoint นี้',
        );
      }

      return makeSession();
    });

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));
    await userEvent.click(
      await screen.findByRole('button', { name: '5 ดาว' }, { timeout: 3000 }),
    );

    expect(await screen.findByText('ไม่พบ endpoint นี้')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 ดาว' })).toBeEnabled();
  });

  it('คุยไม่ถึง 5 วินาที = ไม่ถามคะแนน', async () => {
    await renderProvider();
    await answeredOut();

    FakePeerConnection.latest().moveTo('connected');
    now += 3_000;

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    expect(await screen.findByText('สิ้นสุดการโทรแล้ว')).toBeInTheDocument();

    // หน้าจอจบสายปิดเองโดยไม่เคยถาม
    await waitFor(
      () => expect(screen.queryByText('สิ้นสุดการโทรแล้ว')).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.queryByText('คุณภาพการโทรของคุณเป็นอย่างไรบ้าง')).not.toBeInTheDocument();
  });

  it('ไม่เคยต่อติด = ไม่ถามคะแนน', async () => {
    await renderProvider();
    await answeredOut();

    now += 60_000;

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));
    await screen.findByText('สิ้นสุดการโทรแล้ว');

    await waitFor(
      () => expect(screen.queryByText('สิ้นสุดการโทรแล้ว')).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(apiPost).not.toHaveBeenCalledWith('/calls/feedback', expect.anything());
  });
});

describe('สายกลุ่ม (mesh)', () => {
  const group: CallArgs = ['grp-1', ['aaa-caller', 'bbb-peer', 'ccc-friend']];

  async function groupCallOut() {
    await renderProvider(group);
    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    // ห้องรอบอกชื่อสมาชิกทุกคน (ตัดตัวเองออก)
    const lobby = await screen.findByRole('dialog', { name: 'เตรียมโทร' });

    await waitFor(() => expect(lobby).toHaveTextContent('Bbb-peer, Ccc-friend'));
    expect(lobby).not.toHaveTextContent('Aaa-caller');

    await userEvent.click(screen.getByRole('button', { name: 'เริ่มการโทร' }));
    await screen.findByText(/กำลังโทรหา Bbb-peer/);
  }

  function answer(from: string, accepted = true) {
    act(() => {
      handlers.get('call:answered')?.({ accepted, fromCoreUserId: from });
    });
  }

  it('ส่งเสียงกริ่งถึงทุกคน และเปิดสายหนึ่งเส้นต่อคน', async () => {
    await groupCallOut();

    expect(recipients('call:ring')).toEqual(['bbb-peer', 'ccc-friend']);
    expect(FakePeerConnection.instances).toHaveLength(2);
  });

  it('คนแรกรับ = เข้าสาย · หัวจอบอกชื่อและจำนวนคน', async () => {
    await groupCallOut();

    answer('bbb-peer');

    expect(await screen.findByText('2 คน')).toBeInTheDocument();
    expect(screen.getByText(/Bbb-peer, \+ คนอื่นๆ อีก 1 คน/)).toBeInTheDocument();

    // คนที่ยังไม่รับยังเห็นเป็น "กำลังโทร…" ในช่องของเขา
    expect(screen.getByText('กำลังโทร…')).toBeInTheDocument();
  });

  it('คนหนึ่งปฏิเสธ สายของคนที่เหลือยังอยู่', async () => {
    await groupCallOut();

    answer('bbb-peer');
    answer('ccc-friend', false);

    const [bbb, ccc] = FakePeerConnection.instances;

    expect(ccc.closed).toBe(true);
    expect(bbb.closed).toBe(false);
    expect(screen.queryByText(/ปฏิเสธสาย/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'วางสาย' })).toBeInTheDocument();
  });

  it('คนหนึ่งวางสาย ที่เหลือคุยกันต่อ · คนสุดท้ายวาง = จบสาย', async () => {
    await groupCallOut();

    answer('bbb-peer');
    answer('ccc-friend');

    act(() => {
      handlers.get('call:ended')?.({ sessionId: 'session-1', fromCoreUserId: 'ccc-friend' });
    });

    expect(screen.getByRole('button', { name: 'วางสาย' })).toBeInTheDocument();

    act(() => {
      handlers.get('call:ended')?.({ sessionId: 'session-1', fromCoreUserId: 'bbb-peer' });
    });

    expect(await screen.findByText('สิ้นสุดการโทรแล้ว')).toBeInTheDocument();
    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith('/voice-sessions/session-1/participants/me'),
    );
  });

  it('วางสายกลุ่ม = บอกทุกคน (รับแล้ว call:end · ยังไม่รับ call:cancel)', async () => {
    await groupCallOut();

    answer('bbb-peer');

    await userEvent.click(await screen.findByRole('button', { name: 'วางสาย' }));

    expect(recipients('call:end')).toEqual(['bbb-peer']);
    expect(recipients('call:cancel')).toEqual(['ccc-friend']);
  });

  it('คนที่เข้าสายทีหลังยื่นข้อเสนอมา = เปิดสายรับให้ แล้วตอบกลับ', async () => {
    await groupCallOut();

    answer('bbb-peer');

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'ddd-late',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของคนที่มาทีหลัง' },
      });
    });

    expect(FakePeerConnection.instances).toHaveLength(3);
    expect(
      sent('rtc:signal').some(
        (row) =>
          (row.payload as { kind?: string }).kind === 'answer' &&
          (row.payload as { toCoreUserId?: string }).toCoreUserId === 'ddd-late',
      ),
    ).toBe(true);
  });

  it('สายหนึ่งต่อหนึ่งไม่รับข้อเสนอจากคนแปลกหน้า', async () => {
    await renderProvider();
    await answeredOut();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'zzz-stranger',
        kind: 'offer',
        data: { type: 'offer', sdp: 'x' },
      });
    });

    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it('ช่องของแต่ละคนบอกว่าปิดไมค์/ปิดกล้องอยู่ — จากสถานะที่หลังบ้านกระจายมา (voice:occupants)', async () => {
    await groupCallOut();

    answer('bbb-peer');
    await screen.findByText('2 คน');

    expect(screen.queryAllByText('ปิดไมค์อยู่')).toHaveLength(0);

    act(() => {
      handlers.get('voice:occupants')?.({
        channelId: 'grp-1',
        sessionId: 'session-1',
        occupants: [
          { coreUserId: 'aaa-caller', muted: false, deafened: false, video: false, sharing: false },
          { coreUserId: 'bbb-peer', muted: true, deafened: false, video: false, sharing: false },
        ],
      });
    });

    // ช่องของ bbb ปิดไมค์ · ทุกช่องปิดกล้อง (เรา + bbb + ccc)
    expect(screen.getAllByText('ปิดไมค์อยู่')).toHaveLength(1);
    expect(screen.getAllByText('ปิดกล้องอยู่')).toHaveLength(3);
  });

  it('voice:occupants ของห้องอื่นไม่ปนเข้ามา', async () => {
    await groupCallOut();

    answer('bbb-peer');
    await screen.findByText('2 คน');

    act(() => {
      handlers.get('voice:occupants')?.({
        channelId: 'ห้องอื่น',
        sessionId: 'x',
        occupants: [{ coreUserId: 'bbb-peer', muted: true, deafened: false, video: false, sharing: false }],
      });
    });

    expect(screen.queryAllByText('ปิดไมค์อยู่')).toHaveLength(0);
  });

  it('ปิดไมค์ = บอกหลังบ้าน (PATCH participants/me) ให้ทุกคนเห็นไอคอน', async () => {
    await groupCallOut();

    await userEvent.click(screen.getByRole('button', { name: 'ปิดไมค์' }));

    await waitFor(() =>
      expect(apiPatch).toHaveBeenLastCalledWith('/voice-sessions/session-1/participants/me', {
        muted: true,
        deafened: false,
        video: false,
      }),
    );
  });

  it('เสียงกริ่งบอกชนิดสาย (media) ให้หลังบ้านลงบันทึกการโทร', async () => {
    await groupCallOut();

    expect(sent('call:ring').map((row) => (row.payload as { media?: string }).media)).toEqual([
      'AUDIO',
      'AUDIO',
    ]);
  });

  it('ช่องประกาศสตรีมเปิดโดยฝ่ายไม่ยอมถอยหลังต่อติดเท่านั้น (กันวนเจรจาไม่หยุด)', async () => {
    await groupCallOut();

    answer('bbb-peer');

    const [bbb] = FakePeerConnection.instances;

    // ยังไม่ต่อติด = ยังไม่มีช่อง — ช่องที่เปิดก่อนจะถูกม้วนทิ้งตอนยื่นชนกัน
    expect(bbb.channels).toHaveLength(0);

    bbb.moveTo('connected');

    // เรา (aaa) < bbb = ฝ่ายไม่ยอมถอย จึงเป็นคนเปิด
    expect(bbb.channels).toHaveLength(1);
  });

  it('เกิน 6 คน = ไม่เปิดห้องรอ และบอกเหตุผล', async () => {
    await renderProvider([
      'grp-big',
      ['bbb-1', 'bbb-2', 'bbb-3', 'bbb-4', 'bbb-5', 'bbb-6'],
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(await screen.findByText(/โทรกลุ่มได้สูงสุด 6 คน/)).toBeInTheDocument();
    expect(screen.queryByText('พร้อมที่จะโทรแล้วใช่ไหม')).not.toBeInTheDocument();
  });

  it('รับสายกลุ่ม = ยื่นข้อเสนอให้คนที่อยู่ในห้องแล้ว ยกเว้นผู้โทรที่ยื่นมาเอง', async () => {
    apiPost = asyncMock(async () =>
      makeSession({
        id: 'session-9',
        participants: [
          { coreUserId: 'ccc-friend', joinedAt: '2026-09-11T10:00:00.000Z' },
          { coreUserId: 'ddd-other', joinedAt: '2026-09-11T10:00:05.000Z' },
        ],
      }),
    );

    await renderProvider();
    await incoming('ccc-friend', 'grp-9');

    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));

    // คนที่รับก่อนเรา (ddd) ไม่รู้ว่าเราเข้ามา → เรายื่นให้ · ผู้โทร (ccc) ยื่นมาหาเราเอง
    await waitFor(() => expect(recipients('rtc:signal')).toEqual(['ddd-other']));
    expect(recipients('call:answer')).toEqual(['ccc-friend']);
  });
});

describe('ลำดับสัญญาณสลับกัน (หลังบ้านส่งต่อแต่ละชิ้นแยกกัน)', () => {
  it('**ICE ที่วิ่งแซงข้อเสนอมาถึงก่อน ต้องไม่ถูกทิ้ง** — ใส่ให้หลังได้ข้อเสนอ', async () => {
    await renderProvider();
    await callOut();

    const peer = FakePeerConnection.latest();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'bbb-peer',
        kind: 'ice',
        data: { candidate: 'แซงมาก่อน' },
      });
    });

    // ยังไม่มี description = ยังใส่ไม่ได้ แต่ต้องไม่หายไป
    expect(peer.iceCandidates).toEqual([]);

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'bbb-peer',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของอีกฝ่าย' },
      });
    });

    expect(peer.iceCandidates).toEqual([{ candidate: 'แซงมาก่อน' }]);
  });
});
