import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

/// ห้องเสียงแบบต่อค้าง (Discord) — สิ่งที่ต้องพิสูจน์:
///   - เข้าห้องแล้วเปิดสายหาทุกคนที่อยู่ก่อน · คนมาทีหลังยื่นมา = รับได้
///   - **เปลี่ยนหน้าแล้วเสียงไม่หลุด** (provider อยู่เหนือหน้า)
///   - ไอคอนปิดไมค์/หูฟังของทุกคนมาจากหลังบ้าน (voice:occupants) และเราบอกหลังบ้านทุกครั้งที่สลับ
///   - ออกจากห้องต้องคืนสิทธิ์แชร์จอก่อนคืนที่นั่ง

const handlers = new Map<string, (payload: unknown) => unknown>();
const emitted: { event: string; payload: unknown }[] = [];

type AsyncMock = Mock<(...args: unknown[]) => Promise<unknown>>;

let apiPost: AsyncMock;
let apiDel: AsyncMock;
let apiPatch: AsyncMock;
let getUserMedia: AsyncMock;

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  onicecandidate: unknown = null;
  ontrack: unknown = null;
  ondatachannel: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  connectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  closed = false;
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  readonly addedTracks: unknown[] = [];
  readonly senders: { track: unknown }[] = [];

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: unknown) {
    this.addedTracks.push(track);
    this.senders.push({ track });
  }

  getSenders() {
    return this.senders;
  }

  removeTrack(sender: { track: unknown }) {
    this.senders.splice(this.senders.indexOf(sender), 1);
  }

  close() {
    this.closed = true;
  }

  async setLocalDescription() {
    const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';

    this.localDescription = { type, sdp: `fake-${type}` };
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: { type: string }) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate() {}
}

const fakeSocket = {
  emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
};

vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn(async () => fakeSocket),
  emitWithAck: vi.fn(async (_socket: unknown, event: string, payload: unknown) => {
    emitted.push({ event, payload });

    return { ok: true };
  }),
  bindSocket: (_socket: unknown, event: string, handler: (payload: unknown) => unknown) => {
    handlers.set(event, handler);

    return () => handlers.delete(event);
  },
}));

vi.mock('@/lib/csmju/api', () => {
  class ApiError extends Error {}

  return {
    ApiError,
    api: {
      get: async (path: string) =>
        path.startsWith('/channels/') ? { id: 'voice-1', name: 'ทั่วไป', kind: 'VOICE' } : [],
      post: (...args: unknown[]) => apiPost(...args),
      del: (...args: unknown[]) => apiDel(...args),
      patch: (...args: unknown[]) => apiPatch(...args),
    },
  };
});

vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'bbb-me', email: 'me@core.local', coreRole: 'student', subsystemRole: 'GUEST' }),
}));

let trackSeq = 0;

function makeStream(kind: 'audio' | 'video' = 'audio') {
  const track = { id: `t-${(trackSeq += 1)}`, kind, label: '', enabled: true, stop: vi.fn(), onended: null };

  return {
    id: `s-${trackSeq}`,
    getTracks: () => [track],
    getAudioTracks: () => (kind === 'audio' ? [track] : []),
    getVideoTracks: () => (kind === 'video' ? [track] : []),
    track,
  };
}

let mic: ReturnType<typeof makeStream>;

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  FakePeerConnection.instances = [];
  vi.resetModules();

  mic = makeStream();
  getUserMedia = vi.fn(async (constraints) =>
    (constraints as MediaStreamConstraints).video ? makeStream('video') : mic,
  ) as AsyncMock;
  apiPost = vi.fn(async () => ({
    id: 'vs-1',
    channelId: 'voice-1',
    startedAt: '2026-10-02T10:00:00.000Z',
    participants: [
      { coreUserId: 'aaa-early', joinedAt: '2026-10-02T10:00:00.000Z' },
      { coreUserId: 'bbb-me', joinedAt: '2026-10-02T10:01:00.000Z' },
    ],
    maxSeats: 8,
    seatsTaken: 2,
    iceServers: [{ urls: ['stun:stun.example:3478'] }],
    turnAvailable: true,
    maxScreenViewers: 4,
  })) as AsyncMock;
  apiDel = vi.fn(async () => undefined) as AsyncMock;
  apiPatch = vi.fn(async () => ({ channelId: 'voice-1', sessionId: 'vs-1', occupants: [] })) as AsyncMock;

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      getDisplayMedia: vi.fn(async () => makeStream('video')),
    },
  });

  globalThis.RTCPeerConnection = FakePeerConnection as unknown as typeof RTCPeerConnection;
});

async function renderRoom() {
  const { VoiceRoomProvider, useVoiceRoom } = await import('./voice-room-provider');
  const { markCallActive } = await import('./voice-room-provider');

  markCallActive(false);

  function Status() {
    const voice = useVoiceRoom();

    return (
      <div>
        <p data-testid="status">{voice.status}</p>
        <p data-testid="room">{voice.channel?.name ?? '-'}</p>
        <ul>
          {voice.participants.map((row) => (
            <li key={row.coreUserId}>
              {row.coreUserId}
              {row.muted ? ' ·ปิดไมค์' : ''}
              {row.deafened ? ' ·ปิดหูฟัง' : ''}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => void voice.join('voice-1')}>เข้า</button>
        <button type="button" onClick={() => void voice.leave()}>ออก</button>
        <button type="button" onClick={voice.toggleMute}>ไมค์</button>
        <button type="button" onClick={voice.toggleDeafen}>หูฟัง</button>
        <button type="button" onClick={() => void voice.startShare()}>แชร์</button>
      </div>
    );
  }

  /// สลับ "หน้า" ได้ — พิสูจน์ว่าเปลี่ยนหน้าแล้วสายไม่ถูกปิด
  function App() {
    const [page, setPage] = useState<'chat' | 'feed'>('chat');

    return (
      <VoiceRoomProvider>
        <button type="button" onClick={() => setPage(page === 'chat' ? 'feed' : 'chat')}>
          ไป{page === 'chat' ? 'ฟีด' : 'ห้อง'}
        </button>
        {page === 'chat' ? <Status /> : <p>หน้าฟีด</p>}
      </VoiceRoomProvider>
    );
  }

  render(<App />);

  return { markCallActive };
}

async function joined() {
  await userEvent.click(screen.getByRole('button', { name: 'เข้า' }));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'));
}

describe('เข้าห้องเสียง', () => {
  it('ขอไมค์ จองที่นั่ง แล้วเปิดสายหาทุกคนที่อยู่ก่อน (ไม่รวมตัวเอง)', async () => {
    await renderRoom();
    await joined();

    expect(getUserMedia).toHaveBeenCalled();
    expect(apiPost).toHaveBeenCalledWith('/voice-sessions', { channelId: 'voice-1' });
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0].addedTracks).toEqual([mic.track]);
    expect(await screen.findByTestId('room')).toHaveTextContent('ทั่วไป');
  });

  it('คนที่เข้ามาทีหลังยื่นข้อเสนอมา = เปิดสายรับแล้วตอบ', async () => {
    await renderRoom();
    await joined();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        fromCoreUserId: 'ccc-late',
        kind: 'offer',
        data: { type: 'offer', sdp: 'x' },
      });
    });

    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(
      emitted.some(
        (row) =>
          row.event === 'rtc:signal' &&
          (row.payload as { kind: string; toCoreUserId: string }).kind === 'answer' &&
          (row.payload as { toCoreUserId: string }).toCoreUserId === 'ccc-late',
      ),
    ).toBe(true);
  });

  it('ไมค์ไม่ได้รับอนุญาต = ไม่จองที่นั่งทิ้งไว้', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));

    await renderRoom();
    await userEvent.click(screen.getByRole('button', { name: 'เข้า' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('อยู่ในสายโทรอยู่ = เข้าห้องเสียงไม่ได้ (สัญญาณสองห้องจะปนกัน)', async () => {
    const { markCallActive } = await renderRoom();

    markCallActive(true);
    await userEvent.click(screen.getByRole('button', { name: 'เข้า' }));

    expect(apiPost).not.toHaveBeenCalled();
    markCallActive(false);
  });
});

describe('**เปลี่ยนหน้าแล้วเสียงไม่หลุด**', () => {
  it('ไปหน้าฟีดแล้วกลับมา — สายเดิมยังเปิด ไมค์ยังไม่ถูกปิด ไม่ได้ออกจากห้อง', async () => {
    await renderRoom();
    await joined();

    const [peer] = FakePeerConnection.instances;

    await userEvent.click(screen.getByRole('button', { name: 'ไปฟีด' }));
    expect(screen.getByText('หน้าฟีด')).toBeInTheDocument();

    expect(peer.closed).toBe(false);
    expect(mic.track.stop).not.toHaveBeenCalled();
    expect(apiDel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'ไปห้อง' }));
    expect(screen.getByTestId('status')).toHaveTextContent('connected');
    expect(FakePeerConnection.instances).toHaveLength(1);
  });
});

describe('สถานะไมค์/หูฟังของทุกคน', () => {
  it('ปิดไมค์ = ปิดแทร็กจริง และบอกหลังบ้าน', async () => {
    await renderRoom();
    await joined();

    await userEvent.click(screen.getByRole('button', { name: 'ไมค์' }));

    expect(mic.track.enabled).toBe(false);
    expect(apiPatch).toHaveBeenLastCalledWith('/voice-sessions/vs-1/participants/me', {
      muted: true,
      deafened: false,
    });
  });

  it('ปิดหูฟัง = ปิดไมค์ด้วย (แบบ Discord) · เปิดไมค์คืน = เปิดหูฟังด้วย', async () => {
    await renderRoom();
    await joined();

    await userEvent.click(screen.getByRole('button', { name: 'หูฟัง' }));

    expect(mic.track.enabled).toBe(false);
    expect(apiPatch).toHaveBeenLastCalledWith('/voice-sessions/vs-1/participants/me', {
      muted: true,
      deafened: true,
    });
    expect(screen.getByText(/bbb-me ·ปิดไมค์ ·ปิดหูฟัง/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ไมค์' }));

    expect(mic.track.enabled).toBe(true);
    expect(apiPatch).toHaveBeenLastCalledWith('/voice-sessions/vs-1/participants/me', {
      muted: false,
      deafened: false,
    });
  });

  it('voice:occupants จากหลังบ้านขึ้นไอคอนของคนอื่น · คนที่ออกไปแล้วถูกปิดสาย', async () => {
    await renderRoom();
    await joined();

    act(() => {
      handlers.get('voice:occupants')?.({
        channelId: 'voice-1',
        sessionId: 'vs-1',
        occupants: [
          { coreUserId: 'aaa-early', muted: true, deafened: true, video: false, sharing: false },
          { coreUserId: 'bbb-me', muted: false, deafened: false, video: false, sharing: false },
        ],
      });
    });

    expect(screen.getByText(/aaa-early ·ปิดไมค์ ·ปิดหูฟัง/)).toBeInTheDocument();

    act(() => {
      handlers.get('voice:occupants')?.({
        channelId: 'voice-1',
        sessionId: 'vs-1',
        occupants: [{ coreUserId: 'bbb-me', muted: false, deafened: false, video: false, sharing: false }],
      });
    });

    expect(FakePeerConnection.instances[0].closed).toBe(true);
    expect(screen.queryByText(/aaa-early/)).not.toBeInTheDocument();
  });

  it('voice:occupants ของห้องอื่นไม่ปนเข้ามา', async () => {
    await renderRoom();
    await joined();

    act(() => {
      handlers.get('voice:occupants')?.({
        channelId: 'ห้องอื่น',
        sessionId: 'x',
        occupants: [],
      });
    });

    expect(FakePeerConnection.instances[0].closed).toBe(false);
  });
});

describe('ออกจากห้อง', () => {
  it('คืนสิทธิ์แชร์จอก่อน แล้วคืนที่นั่ง ปิดสายและไมค์', async () => {
    await renderRoom();
    await joined();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์' }));
    await waitFor(() => expect(emitted.some((row) => row.event === 'screen:claim')).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'ออก' }));

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith('/voice-sessions/vs-1/participants/me'),
    );

    const order = emitted.map((row) => row.event);

    expect(order).toContain('screen:release');
    expect(FakePeerConnection.instances[0].closed).toBe(true);
    expect(mic.track.stop).toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });
});
