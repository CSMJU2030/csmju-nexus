'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Socket } from 'socket.io-client';
import { RemoteAudio } from '@/components/csmju/call-ui';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { Mesh, type PeerLinkState } from '@/lib/csmju/call-mesh';
import { SpeakingMonitor, type PeerMediaState } from '@/lib/csmju/call-media';
import {
  audioConstraints,
  loadSelection,
  supportsSinkId,
  videoConstraints,
} from '@/lib/csmju/call-devices';
import { bindSocket, connectSocket, emitWithAck } from '@/lib/csmju/socket';
import type {
  Channel,
  JoinVoiceResponse,
  UpdateVoiceStateBody,
  VoiceOccupant,
  VoiceOccupants,
} from '@/lib/csmju/types';

/// ห้องเสียงแบบต่อค้าง — แบบ Discord
///
/// **ทำไมต้องอยู่ที่ layout:** ใน Discord เข้าช่องเสียงแล้วเปลี่ยนไปอ่านช่องอื่น
/// เสียงยังต่ออยู่ ของเดิม (หน้า /voice) ถือสาย WebRTC ไว้ใน state ของหน้า
/// พอกดเมนูไปหน้าอื่น React ถอดหน้าทิ้ง สายทุกเส้นปิดตาม — คนอื่นในห้อง
/// เห็นเราหลุดทันทีที่เราเปิดฟีด ตัวนี้อยู่เหนือทุกหน้าจึงไม่ถูกถอด
///
/// โปรโตคอลเดิมทั้งหมด: ที่นั่งจาก `POST /voice-sessions` · สัญญาณ `rtc:signal`
/// · สิทธิ์แชร์จอ `screen:claim/release` · การเจรจาใช้ `Mesh` ตัวเดียวกับสายโทร
/// สถานะไมค์/หูฟัง/กล้องของทุกคนมาจากหลังบ้าน (`PATCH participants/me` →
/// socket `voice:occupants`) จึงเห็นตรงกันทั้งห้อง

export type VoiceRoomStatus = 'idle' | 'joining' | 'connected';

export interface VoiceRoomParticipant {
  coreUserId: string;
  isMe: boolean;
  /// เสียงกำลังดังอยู่ตอนนี้ (วงเขียวรอบรูป)
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  /// เปิดกล้องอยู่
  video: boolean;
  /// กำลังแชร์จอ (ถ่ายทอดสด)
  sharing: boolean;
  /// ภาพกล้อง — ของเราเองคือกล้องในเครื่อง
  camera: MediaStream | null;
  /// ภาพจอที่แชร์ — ของเราเองคือจอที่เรากำลังส่ง
  screen: MediaStream | null;
  /// สายของเรากับคนนี้ (ของเราเองเป็น connected เสมอ)
  connection: PeerLinkState;
}

export interface VoiceRoomValue {
  status: VoiceRoomStatus;
  /// ห้องที่ต่ออยู่ (หรือกำลังเข้า) — null = ไม่ได้อยู่ห้องไหน
  channelId: string | null;
  /// ข้อมูลห้อง (ชื่อ ฯลฯ) — null ระหว่างโหลด
  channel: Channel | null;
  participants: VoiceRoomParticipant[];
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /// ใครถือสิทธิ์แชร์จอของห้องอยู่ (หนึ่งห้องแชร์ได้ทีละคน)
  presenterCoreUserId: string | null;
  /// ต่อเข้าห้องเมื่อไหร่ (ms) — ใช้นับเวลา
  connectedAt: number | null;
  error: string | null;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => Promise<void>;
  startShare: () => Promise<void>;
  stopShare: () => Promise<void>;
  clearError: () => void;
}

const noop = async () => {};

const VoiceRoomContext = createContext<VoiceRoomValue>({
  status: 'idle',
  channelId: null,
  channel: null,
  participants: [],
  muted: false,
  deafened: false,
  cameraOn: false,
  sharing: false,
  presenterCoreUserId: null,
  connectedAt: null,
  error: null,
  join: noop,
  leave: noop,
  toggleMute: () => {},
  toggleDeafen: () => {},
  toggleCamera: noop,
  startShare: noop,
  stopShare: noop,
  clearError: () => {},
});

export function useVoiceRoom(): VoiceRoomValue {
  return useContext(VoiceRoomContext);
}

/// สายโทร (CallProvider) กำลังใช้ห้องเสียงอยู่ไหม
///
/// หนึ่งคนอยู่ได้ทีละห้องเสียง — ถ้าอยู่ทั้งสายโทรและช่องเสียง สัญญาณ rtc:signal
/// ของสองห้องจะปนกันบน socket เดียว CallProvider ออกจากช่องเสียงให้ก่อนโทร
/// ส่วนทางกลับกันใช้ธงนี้กันไว้ (อยู่ชั้นในของ provider จึงอ่าน context กันไม่ได้)
let callActive = false;

export function markCallActive(active: boolean) {
  callActive = active;
}

function stopAll(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

interface PeerSnapshot {
  coreUserId: string;
  connection: PeerLinkState;
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
}

export function VoiceRoomProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();

  const [status, setStatus] = useState<VoiceRoomStatus>('idle');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [occupants, setOccupants] = useState<VoiceOccupant[]>([]);
  const [peers, setPeers] = useState<PeerSnapshot[]>([]);
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [presenter, setPresenter] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<JoinVoiceResponse | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const presenterRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const monitorRef = useRef<SpeakingMonitor | null>(null);
  const unbindRef = useRef<(() => void)[]>([]);
  const joiningRef = useRef(false);

  const syncPeers = useCallback(() => {
    const mesh = meshRef.current;

    if (!mesh) {
      setPeers([]);

      return;
    }

    const next: PeerSnapshot[] = [];

    for (const peer of mesh.peers.values()) {
      const media = mesh.media(peer, presenterRef.current === peer.coreUserId);

      monitorRef.current?.watch(peer.coreUserId, peer.audio);
      next.push({
        coreUserId: peer.coreUserId,
        connection: peer.connection,
        audio: peer.audio,
        camera: media.camera,
        screen: media.screen,
      });
    }

    setPeers(next);
  }, []);

  /// บอกหลังบ้านว่าเราปิดไมค์/หูฟัง/เปิดกล้อง → ทุกคนในห้องเห็นไอคอนตรงกัน
  const report = useCallback((body: UpdateVoiceStateBody) => {
    const session = sessionRef.current;

    if (!session) return;

    void api
      .patch<VoiceOccupants>(`/voice-sessions/${session.id}/participants/me`, body)
      .then((result) => {
        if (result?.channelId === sessionRef.current?.channelId) {
          setOccupants(result.occupants);
        }
      })
      .catch(() => undefined);
  }, []);

  const teardown = useCallback(() => {
    for (const off of unbindRef.current) off();

    unbindRef.current = [];
    meshRef.current?.close();
    meshRef.current = null;
    monitorRef.current?.close();
    monitorRef.current = null;

    stopAll(micRef.current);
    stopAll(cameraRef.current);
    stopAll(screenRef.current);
    micRef.current = null;
    cameraRef.current = null;
    screenRef.current = null;
    sessionRef.current = null;
    presenterRef.current = null;
    mutedRef.current = false;
    deafenedRef.current = false;

    setStatus('idle');
    setChannelId(null);
    setChannel(null);
    setOccupants([]);
    setPeers([]);
    setSpeaking(new Set());
    setMuted(false);
    setDeafened(false);
    setCamera(null);
    setScreen(null);
    setPresenter(null);
    setConnectedAt(null);
  }, []);

  /// ออกจากห้อง — คืนสิทธิ์แชร์จอก่อนคืนที่นั่ง
  ///
  /// ลำดับสำคัญ: ตัวปลดสิทธิ์ตอน socket หลุดดูจากแถวผู้เข้าร่วมที่ยังเปิดอยู่
  /// ถ้าคืนที่นั่งก่อน สิทธิ์แชร์จะค้างให้คนที่ออกไปแล้วจนหลังบ้านรีสตาร์ต
  const leave = useCallback(async () => {
    const session = sessionRef.current;

    if (session && presenterRef.current === me.id) {
      socketRef.current?.emit('screen:release', { sessionId: session.id });
    }

    teardown();

    if (session) {
      await api.del(`/voice-sessions/${session.id}/participants/me`).catch(() => undefined);
    }
  }, [me.id, teardown]);

  const join = useCallback(
    async (target: string) => {
      if (joiningRef.current) return;

      if (callActive) {
        setError('กำลังอยู่ในสายโทร — วางสายก่อนถึงจะเข้าห้องเสียงได้');

        return;
      }

      if (sessionRef.current?.channelId === target) return;

      joiningRef.current = true;
      setError(null);

      // ย้ายห้อง = ออกจากห้องเดิมให้เรียบร้อยก่อน (แบบ Discord)
      if (sessionRef.current) await leave();

      setStatus('joining');
      setChannelId(target);

      void api
        .get<Channel>(`/channels/${encodeURIComponent(target)}`)
        .then((row) => setChannel((current) => current ?? row))
        .catch(() => undefined);

      try {
        // ขอไมค์ก่อนเข้าห้อง — ถ้าผู้ใช้ปฏิเสธ จะได้ไม่จองที่นั่งทิ้งไว้
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(loadSelection().audioinput),
          video: false,
        });

        micRef.current = mic;

        const session = await api.post<JoinVoiceResponse>('/voice-sessions', {
          channelId: target,
        });

        sessionRef.current = session;

        const socket = await connectSocket();

        socketRef.current = socket;
        monitorRef.current = new SpeakingMonitor(setSpeaking);
        monitorRef.current.watch(me.id, mic);

        const mesh = new Mesh({
          me: me.id,
          iceServers: session.iceServers.map((server) => ({
            urls: server.urls,
            username: server.username,
            credential: server.credential,
          })),
          localStreams: () => [micRef.current, cameraRef.current, screenRef.current],
          localState: (): PeerMediaState => ({
            muted: mutedRef.current,
            camera: cameraRef.current?.id ?? null,
            screen: screenRef.current?.id ?? null,
          }),
          emit: (payload) => socket.emit('rtc:signal', payload),
          emitOffer: (payload) =>
            emitWithAck<{ ok: boolean; error?: string }>(socket, 'rtc:signal', payload),
          onChange: syncPeers,
        });

        meshRef.current = mesh;

        unbindRef.current.push(
          bindSocket<{
            fromCoreUserId: string;
            kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
            data: unknown;
          }>(socket, 'rtc:signal', async (payload) => {
            if (meshRef.current !== mesh) return;

            // คนที่เข้ามาทีหลังยื่นข้อเสนอมาหาเรา — หลังบ้านส่งต่อให้เฉพาะคน
            // ที่อยู่ห้องเสียงเดียวกันจริง จึงเปิดสายรับได้เลย
            if (!mesh.has(payload.fromCoreUserId)) {
              if (payload.kind !== 'offer') return;

              mesh.open(payload.fromCoreUserId, true);
            }

            await mesh.signal(payload);
          }),
          bindSocket<VoiceOccupants>(socket, 'voice:occupants', (payload) => {
            if (payload.channelId !== target || meshRef.current !== mesh) return;

            setOccupants(payload.occupants);

            // คนที่ออกไปแล้ว (หรือ socket หลุด) — ปิดสายของเขา
            const present = new Set(payload.occupants.map((row) => row.coreUserId));

            for (const id of [...mesh.peers.keys()]) {
              if (!present.has(id)) {
                mesh.drop(id);
                monitorRef.current?.unwatch(id);
              }
            }
          }),
          bindSocket<{ sessionId: string; presenterCoreUserId: string | null }>(
            socket,
            'screen:changed',
            (payload) => {
              if (payload.sessionId !== session.id) return;

              presenterRef.current = payload.presenterCoreUserId;
              setPresenter(payload.presenterCoreUserId);
              syncPeers();
            },
          ),
        );

        // **คนที่เพิ่งเข้ามาเป็นฝ่ายยื่นเสมอ** — คนที่อยู่ก่อนไม่มีทางรู้ว่าเรา
        // เข้ามาจนกว่าข้อเสนอของเราจะไปถึง (การเพิ่มแทร็กไมค์จุด
        // negotiationneeded ให้ยื่นเอง)
        for (const row of session.participants) {
          if (row.coreUserId !== me.id) mesh.open(row.coreUserId, true);
        }

        setOccupants(
          session.participants.map((row) => ({
            coreUserId: row.coreUserId,
            muted: false,
            deafened: false,
            video: false,
            sharing: false,
          })),
        );
        setStatus('connected');
        setConnectedAt(Date.now());
        syncPeers();

        // ค่าเริ่มต้นของเรา → หลังบ้านกระจาย voice:occupants ให้ทั้งห้อง
        report({ muted: false, deafened: false, video: false });
      } catch (caught) {
        const session = sessionRef.current;

        teardown();

        if (session) {
          await api.del(`/voice-sessions/${session.id}/participants/me`).catch(() => undefined);
        }

        setError(
          caught instanceof ApiError
            ? caught.message
            : caught instanceof DOMException
              ? 'เข้าถึงไมโครโฟนไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง'
              : 'เข้าห้องเสียงไม่สำเร็จ',
        );
      } finally {
        joiningRef.current = false;
      }
    },
    [leave, me.id, report, syncPeers, teardown],
  );

  const toggleMute = useCallback(() => {
    if (!sessionRef.current) return;

    const next = !mutedRef.current;

    // เปิดไมค์ตอนปิดหูฟังอยู่ = เปิดหูฟังด้วย (แบบ Discord — พูดได้แต่ไม่ได้ยิน ไม่มีความหมาย)
    if (!next && deafenedRef.current) {
      deafenedRef.current = false;
      setDeafened(false);
    }

    for (const track of micRef.current?.getAudioTracks() ?? []) track.enabled = !next;

    mutedRef.current = next;
    setMuted(next);
    report({ muted: next, deafened: deafenedRef.current });
  }, [report]);

  const toggleDeafen = useCallback(() => {
    if (!sessionRef.current) return;

    const next = !deafenedRef.current;

    // ปิดหูฟัง = ปิดไมค์ด้วย · เปิดหูฟัง = คืนไมค์ (แบบ Discord)
    for (const track of micRef.current?.getAudioTracks() ?? []) track.enabled = !next;

    deafenedRef.current = next;
    mutedRef.current = next;
    setDeafened(next);
    setMuted(next);
    report({ muted: next, deafened: next });
  }, [report]);

  const stopCamera = useCallback(async () => {
    const stream = cameraRef.current;

    if (!stream) return;

    meshRef.current?.removeTracks(stream.getTracks());
    stopAll(stream);
    cameraRef.current = null;
    setCamera(null);
    meshRef.current?.broadcastState();
    report({ video: false });
    await meshRef.current?.offerAll();
  }, [report]);

  const toggleCamera = useCallback(async () => {
    if (!sessionRef.current) return;

    if (cameraRef.current) {
      await stopCamera();

      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(loadSelection().videoinput),
        audio: false,
      });

      if (!sessionRef.current) {
        stopAll(stream);

        return;
      }

      cameraRef.current = stream;
      setCamera(stream);

      for (const track of stream.getVideoTracks()) {
        meshRef.current?.addTrack(track, stream);
        track.onended = () => void stopCamera();
      }

      meshRef.current?.broadcastState();
      report({ video: true });
      await meshRef.current?.offerAll();
    } catch {
      setError('เข้าถึงกล้องไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง');
    }
  }, [report, stopCamera]);

  /// หยุดแชร์ — ถอนแทร็กออกจากทุกสายแล้วเจรจาใหม่ ไม่งั้นผู้ชมค้างเฟรมสุดท้าย
  const stopShare = useCallback(async () => {
    const stream = screenRef.current;
    const session = sessionRef.current;

    if (!stream) return;

    meshRef.current?.removeTracks(stream.getTracks());
    stopAll(stream);
    screenRef.current = null;
    setScreen(null);

    if (session) socketRef.current?.emit('screen:release', { sessionId: session.id });

    if (presenterRef.current === me.id) {
      presenterRef.current = null;
      setPresenter(null);
    }

    meshRef.current?.broadcastState();
    await meshRef.current?.offerAll();
  }, [me.id]);

  const startShare = useCallback(async () => {
    const session = sessionRef.current;
    const socket = socketRef.current;

    if (!session || !socket || screenRef.current) return;

    const claim = await emitWithAck<{ ok: boolean; error?: string }>(socket, 'screen:claim', {
      sessionId: session.id,
    }).catch(() => ({ ok: false, error: 'จับจองสิทธิ์แชร์หน้าจอไม่สำเร็จ' }));

    if (!claim.ok) {
      // หลังบ้านบอกว่าใครกำลังแชร์อยู่ จึงบอกผู้ใช้ได้ตรง ๆ
      setError(claim.error ?? 'จับจองสิทธิ์แชร์หน้าจอไม่สำเร็จ');

      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });

      if (sessionRef.current !== session) {
        stopAll(stream);

        return;
      }

      screenRef.current = stream;
      setScreen(stream);
      presenterRef.current = me.id;
      setPresenter(me.id);

      for (const track of stream.getVideoTracks()) {
        meshRef.current?.addTrack(track, stream);

        // กด "หยุดแชร์" ที่แถบของเบราว์เซอร์ = เก็บให้เหมือนกดหยุดในแอปทุกประการ
        track.onended = () => void stopShare();
      }

      meshRef.current?.broadcastState();
      await meshRef.current?.offerAll();
    } catch {
      // ผู้ใช้กดยกเลิกหน้าต่างเลือกจอ — ต้องคืนสิทธิ์ ไม่งั้นห้องจะล็อกไว้
      socket.emit('screen:release', { sessionId: session.id });
    }
  }, [me.id, stopShare]);

  // ปิดแท็บ/ออกจากแอป = ปล่อยไมค์และกล้อง (หลังบ้านคืนที่นั่งเองเมื่อ socket หลุด)
  useEffect(() => teardown, [teardown]);

  const clearError = useCallback(() => setError(null), []);

  const participants = useMemo<VoiceRoomParticipant[]>(() => {
    if (status === 'idle') return [];

    const byId = new Map(occupants.map((row) => [row.coreUserId, row]));
    const ids = [...new Set([me.id, ...occupants.map((row) => row.coreUserId), ...peers.map((p) => p.coreUserId)])];

    return ids.map((coreUserId) => {
      const occupant = byId.get(coreUserId);
      const isMe = coreUserId === me.id;
      const peer = peers.find((row) => row.coreUserId === coreUserId);
      const cameraStream = isMe ? camera : (peer?.camera ?? null);
      const screenStream = isMe ? screen : (peer?.screen ?? null);

      return {
        coreUserId,
        isMe,
        speaking: speaking.has(coreUserId) && !(isMe ? muted : (occupant?.muted ?? false)),
        muted: isMe ? muted : (occupant?.muted ?? false),
        deafened: isMe ? deafened : (occupant?.deafened ?? false),
        video: isMe ? camera !== null : (occupant?.video ?? cameraStream !== null),
        sharing: isMe ? screen !== null : (occupant?.sharing ?? false) || presenter === coreUserId,
        camera: cameraStream,
        screen: screenStream,
        connection: isMe ? 'connected' : (peer?.connection ?? 'connecting'),
      };
    });
  }, [status, occupants, peers, me.id, speaking, muted, deafened, camera, screen, presenter]);

  const value = useMemo<VoiceRoomValue>(
    () => ({
      status,
      channelId,
      channel,
      participants,
      muted,
      deafened,
      cameraOn: camera !== null,
      sharing: screen !== null,
      presenterCoreUserId: presenter,
      connectedAt,
      error,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      startShare,
      stopShare,
      clearError,
    }),
    [
      status,
      channelId,
      channel,
      participants,
      muted,
      deafened,
      camera,
      screen,
      presenter,
      connectedAt,
      error,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      startShare,
      stopShare,
      clearError,
    ],
  );

  const sinkId = supportsSinkId() ? loadSelection().audiooutput : null;

  return (
    <VoiceRoomContext.Provider value={value}>
      {children}

      {/* เสียงของแต่ละคน — อยู่ที่ layout จึงยังดังเมื่อเปลี่ยนหน้า */}
      {peers.map((peer) => (
        <RemoteAudio
          key={peer.coreUserId}
          coreUserId={peer.coreUserId}
          stream={peer.audio}
          sinkId={sinkId}
          muted={deafened}
        />
      ))}
    </VoiceRoomContext.Provider>
  );
}
