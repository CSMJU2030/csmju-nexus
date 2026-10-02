'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { Phone, PhoneOff, Users } from 'lucide-react';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { ReportProblemDialog } from '@/components/csmju/account-dialogs';
import { CallLobby } from '@/components/csmju/call-lobby';
import { CallScreen, type PeerView } from '@/components/csmju/call-screen';
import { CallSettingsDialog } from '@/components/csmju/call-settings';
import { CallToasts, type CallToast } from '@/components/csmju/call-toasts';
import { CallEnded, type EndedCall } from '@/components/csmju/call-ended';
import {
  CallAvatar,
  DisplayName,
  RemoteAudio,
} from '@/components/csmju/call-ui';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import {
  audioConstraints,
  defaultMoved,
  deviceNotice,
  diffDevices,
  emptyDeviceMap,
  groupDevices,
  labelOf,
  loadSelection,
  permissionGranted,
  pickDevice,
  saveSelection,
  supportsSinkId,
  videoConstraints,
  EMPTY_SELECTION,
  type DeviceKind,
  type DeviceMap,
  type DeviceSelection,
} from '@/lib/csmju/call-devices';
import { matchShortcut, type CallShortcut } from '@/lib/csmju/call-shortcuts';
import { sharePreviewReducer } from '@/lib/csmju/call-share';
import type { PeerMediaState } from '@/lib/csmju/call-media';
import { Mesh } from '@/lib/csmju/call-mesh';
import { markCallActive, useVoiceRoom } from '@/components/csmju/voice-room-provider';
import type { CallKind } from '@/lib/csmju/call-feedback';
import {
  bindSocket,
  connectSocket,
  emitWithAck,
} from '@/lib/csmju/socket';
import type {
  Channel,
  JoinVoiceResponse,
  UpdateVoiceStateBody,
  VoiceOccupant,
  VoiceOccupants,
} from '@/lib/csmju/types';

/// ตัวจัดการสายที่อยู่เหนือทุกหน้าจอ
///
/// อยู่ใน layout ไม่ใช่ในหน้าใดหน้าหนึ่ง เพราะ **เสียงกริ่งต้องดังแม้ผู้ใช้
/// กำลังอ่านฟีดอยู่** ถ้าผูกกับหน้า DM สายจะเข้าเฉพาะตอนเปิดหน้านั้นค้างไว้
/// ซึ่งเท่ากับไม่มีระบบโทรเลย
///
/// สายใช้ห้องเสียงของห้องแชท (DM = 2 ที่นั่ง · แชทกลุ่ม = 8 ที่นั่ง) จึงไม่ต้อง
/// มีโค้ดหลังบ้านแยกสำหรับการโทร — ต่างกันแค่ชั้นเสียงกริ่งที่เพิ่มเข้ามา
///
/// **สายกลุ่มเป็น mesh** แบบเดียวกับหน้าห้องเสียง: เราเปิด RTCPeerConnection
/// หนึ่งเส้นต่อคนหนึ่งคน สายหนึ่งต่อหนึ่งจึงเป็นแค่ mesh ที่มีคนเดียว และใช้
/// โค้ดทางเดียวกันทุกบรรทัด จำกัดไว้ 6 คน เพราะแต่ละคนต้องส่งภาพ/เสียงให้ทุก
/// คนที่เหลือเอง แบนด์วิดท์ขาขึ้นของเน็ตบ้านรับได้ราวนั้น
///
/// ลำดับหน้าจอแบบ Instagram:
///   ห้องรอ (เลือกอุปกรณ์) → กำลังโทร… → ในสาย → สิ้นสุดการโทร → ให้คะแนน

export const MAX_CALL_PARTICIPANTS = 6;

/// ไม่มีใครรับภายในเวลานี้ = เลิกเรียก (แบบ Instagram) ไม่ปล่อยกริ่งดังไปเรื่อย ๆ
const RING_TIMEOUT_MS = 45_000;

/// ผู้รับสายรอข้อเสนอแรกจากผู้โทรนานเท่านี้ ก่อนยื่นเองแทน (ดู accept)
export const FIRST_OFFER_WAIT_MS = 4000;

const TOAST_MS = 4000;
const TOAST_FADE_MS = 300;

export interface StartCallOptions {
  /// VIDEO = เปิดกล้องไว้ให้ตั้งแต่ห้องรอ · AUDIO (ค่าเริ่มต้น) = ปิดกล้องไว้
  kind?: CallKind;
}

interface CallContextValue {
  /// โทรหาคนเดียว (`peer` เป็น string) หรือทั้งแชทกลุ่ม (ส่งรายชื่อสมาชิก
  /// มาได้เลย รวมตัวเองด้วยก็ได้ — ตัดออกให้)
  ///
  /// เปิดห้องรอก่อนเสมอ ยังไม่มีเสียงกริ่งจนกว่าผู้ใช้จะกด "เริ่มการโทร"
  startCall: (
    channelId: string,
    peer: string | readonly string[],
    options?: StartCallOptions,
  ) => Promise<void>;
  inCall: boolean;
  error: string | null;
}

const CallContext = createContext<CallContextValue>({
  startCall: async () => {},
  inCall: false,
  error: null,
});

export function useCall(): CallContextValue {
  return useContext(CallContext);
}

interface IncomingCall {
  sessionId: string;
  channelId: string;
  fromCoreUserId: string;
  /// ห้องของสายนี้ — ดึงมาทีหลัง ใช้บอกว่าเป็นสายกลุ่มไหม
  channel: Channel | null;
  media: CallKind;
}

interface LobbyPlan {
  channelId: string;
  members: string[];
  kind: CallKind;
}

interface CallInfo {
  sessionId: string;
  channelId: string;
  group: boolean;
  /// คนอื่นในห้อง (ไม่รวมเรา) — ใช้ทำชื่อบนหัวจอและหน้าจอจบสาย
  members: string[];
  kind: CallKind;
  iceServers: RTCIceServer[];
  turnAvailable: boolean;
  /// เวลาที่ต่อสายติดครั้งแรก — ใช้คำนวณเวลาคุยจริงตอนให้คะแนน
  connectedAt: number | null;
  /// มีใครเปิดกล้องระหว่างสายไหม (สายเสียงที่เปิดกล้องทีหลัง = สายวิดีโอ)
  usedVideo: boolean;
}

/// กำลังเรียก (ยังไม่รับ) หรืออยู่ในสายแล้ว — ตัวสาย WebRTC อยู่ใน Mesh
type PeerStatus = 'ringing' | 'joined';

type ErrorNotice =
  | { kind: 'text'; text: string }
  | { kind: 'declined'; coreUserId: string };

function uniqueOthers(ids: readonly string[], me: string): string[] {
  return [...new Set(ids.filter((id) => id && id !== me))];
}

function newStream(tracks: MediaStreamTrack[]): MediaStream | null {
  return typeof MediaStream === 'function' ? new MediaStream(tracks) : null;
}

function stopAll(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const voiceRoom = useVoiceRoom();

  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [lobby, setLobby] = useState<LobbyPlan | null>(null);
  const [call, setCall] = useState<CallInfo | null>(null);
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [ended, setEnded] = useState<EndedCall | null>(null);

  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);

  /// สตรีมของเราเอง เก็บเป็น state ด้วย (นอกจาก ref) เพื่อให้หน้าจอวาดใหม่
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenPreview, setScreenPreview] = useState<MediaStream | null>(null);
  const [sharePreview, dispatchShare] = useReducer(sharePreviewReducer, 'hidden');

  const [notice, setNotice] = useState<ErrorNotice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [devices, setDevices] = useState<DeviceMap>(emptyDeviceMap);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [selection, setSelection] = useState<DeviceSelection>(EMPTY_SELECTION);
  const [toasts, setToasts] = useState<CallToast[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const callRef = useRef<CallInfo | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const statusRef = useRef(new Map<string, PeerStatus>());
  /// สถานะไมค์/หูฟัง/กล้องของแต่ละคนจากหลังบ้าน (voice:occupants)
  const occupantsRef = useRef(new Map<string, VoiceOccupant>());
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false);
  const presenterRef = useRef<string | null>(null);
  const selectionRef = useRef<DeviceSelection>(EMPTY_SELECTION);
  const devicesRef = useRef<DeviceMap | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstOfferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const toastSeq = useRef(0);
  const unbindRef = useRef<(() => void)[]>([]);

  const error = notice?.kind === 'text' ? notice.text : null;
  const setError = useCallback((text: string | null) => {
    setNotice(text ? { kind: 'text', text } : null);
  }, []);

  // ── อุปกรณ์ที่เลือกไว้ครั้งก่อน (อ่านหลัง mount — localStorage ไม่มีตอน SSR)
  useEffect(() => {
    const saved = loadSelection();

    selectionRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ค่าจาก localStorage อ่านได้หลัง hydrate เท่านั้น
    setSelection(saved);
  }, []);

  // ────────────────────────────────────────────────────────────
  // แจ้งเตือนอุปกรณ์
  // ────────────────────────────────────────────────────────────

  const pushToast = useCallback((kind: DeviceKind, text: string) => {
    toastSeq.current += 1;

    const id = toastSeq.current;

    setToasts((current) => [...current.slice(-3), { id, kind, text, leaving: false }]);

    const fade = setTimeout(() => {
      toastTimers.current.delete(fade);
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );

      const drop = setTimeout(() => {
        toastTimers.current.delete(drop);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, TOAST_FADE_MS);

      toastTimers.current.add(drop);
    }, TOAST_MS);

    toastTimers.current.add(fade);
  }, []);

  useEffect(() => {
    const timers = toastTimers.current;

    return () => {
      for (const timer of timers) clearTimeout(timer);

      timers.clear();
    };
  }, []);

  // ────────────────────────────────────────────────────────────
  // สถานะของแต่ละสาย → หน้าจอ
  // ────────────────────────────────────────────────────────────

  const syncPeers = useCallback(() => {
    const mesh = meshRef.current;
    const presenter = presenterRef.current;
    const views: PeerView[] = [];

    for (const [coreUserId, status] of statusRef.current) {
      const peer = mesh?.get(coreUserId);
      const occupant = occupantsRef.current.get(coreUserId);
      const media = peer && mesh ? mesh.media(peer, presenter === coreUserId) : null;

      if (media?.camera && callRef.current) callRef.current.usedVideo = true;

      views.push({
        coreUserId,
        status,
        connection: peer?.connection ?? 'connecting',
        audio: peer?.audio ?? null,
        camera: media?.camera ?? null,
        screen: media?.screen ?? null,
        // ไอคอนปิดไมค์มาจากหลังบ้าน (voice:occupants) ซึ่งทุกคนในห้องเห็นตรงกัน
        muted: occupant?.muted ?? peer?.remote?.muted ?? false,
        cameraOn: (media?.camera ?? null) !== null || occupant?.video === true,
      });
    }

    setPeers(views);
  }, []);

  /// สิ่งที่เราประกาศให้ทุกคนในสาย — id ของสตรีมกล้อง/จอ (ใช้แยกภาพสองเส้น)
  const mediaState = useCallback(
    (): PeerMediaState => ({
      muted: mutedRef.current,
      camera: cameraRef.current?.id ?? null,
      screen: screenStream.current?.id ?? null,
    }),
    [],
  );

  const broadcastState = useCallback(() => meshRef.current?.broadcastState(), []);

  /// บอกหลังบ้านว่าเราปิดไมค์/ปิดหูฟัง/เปิดกล้องอยู่ — ทุกคนในห้องเห็นไอคอนเดียวกัน
  const reportVoiceState = useCallback((body: UpdateVoiceStateBody) => {
    const current = callRef.current;

    if (!current) return;

    void api
      .patch(`/voice-sessions/${current.sessionId}/participants/me`, body)
      .catch(() => undefined);
  }, []);

  // ────────────────────────────────────────────────────────────
  // เก็บกวาด
  // ────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    if (ringTimer.current) {
      clearTimeout(ringTimer.current);
      ringTimer.current = null;
    }

    if (firstOfferTimer.current) {
      clearTimeout(firstOfferTimer.current);
      firstOfferTimer.current = null;
    }

    meshRef.current?.close();
    meshRef.current = null;
    statusRef.current.clear();
    occupantsRef.current.clear();

    stopAll(localStream.current);
    stopAll(screenStream.current);
    stopAll(cameraRef.current);

    localStream.current = null;
    screenStream.current = null;
    cameraRef.current = null;
    presenterRef.current = null;
    mutedRef.current = false;

    setPeers([]);
    setMicStream(null);
    setCameraStream(null);
    setScreenPreview(null);
    dispatchShare('stopped');
    setPresenting(false);
    setMuted(false);

    // เดิมลืมคืนค่านี้ — ผู้ใช้ที่เคยกด "ปิดลำโพง" ในสายก่อนหน้า
    // จะไม่ได้ยินใครเลยในสายถัดไป โดยไม่มีอะไรบอกว่าเพราะอะไร
    setDeafened(false);
    setSettingsOpen(false);
    setCameraBusy(false);

    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  const clearCall = useCallback(() => {
    callRef.current = null;
    setCall(null);
    markCallActive(false);
  }, []);

  /// ออกจากห้องเสียงที่เข้าไปแล้ว
  ///
  /// **ต้องเรียกทุกเส้นทางที่ทิ้งสายหลังจากเข้าห้องสำเร็จไปแล้ว** ไม่งั้นแถว
  /// ผู้เข้าร่วมค้าง ที่นั่งไม่ถูกคืน และห้อง DM ที่มีแค่ 2 ที่นั่งจะเต็มถาวร
  /// จนกว่า socket จะหลุด — โทรซ้ำไม่ได้อีกเลยทั้งที่ไม่มีใครอยู่ในสาย
  const leaveSession = useCallback(async (sessionId: string) => {
    try {
      await api.del(`/voice-sessions/${sessionId}/participants/me`);
    } catch {
      // ออกไม่สำเร็จก็ไม่เป็นไร — หลังบ้านคืนที่นั่งเองเมื่อ socket หลุด
    }
  }, []);

  /// จบสายฝั่งเรา — `showEnded` = แสดงหน้าจอ "สิ้นสุดการโทรแล้ว" (และถามคะแนน)
  const finishCall = useCallback(
    (showEnded: boolean) => {
      const current = callRef.current;

      if (current && showEnded) {
        setEnded({
          channelId: current.channelId,
          members: current.members,
          connectedAt: current.connectedAt,
          endedAt: Date.now(),
          kind: current.kind === 'VIDEO' || current.usedVideo ? 'VIDEO' : 'AUDIO',
        });
      }

      teardown();
      clearCall();
    },
    [teardown, clearCall],
  );

  // ────────────────────────────────────────────────────────────
  // สาย WebRTC (ตรรกะเจรจาอยู่ใน lib/csmju/call-mesh.ts ใช้ร่วมกับห้องเสียง)
  // ────────────────────────────────────────────────────────────

  const createMesh = useCallback(
    (socket: Socket, session: JoinVoiceResponse) => {
      meshRef.current?.close();

      const mesh = new Mesh({
        me: me.id,
        // `username` เป็นชื่อฟิลด์ของมาตรฐาน WebRTC ไม่ใช่ตัวตนผู้ใช้
        iceServers: session.iceServers.map((server) => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        })),
        localStreams: () => [localStream.current, cameraRef.current, screenStream.current],
        localState: mediaState,
        emit: (payload) => socket.emit('rtc:signal', payload),
        // ต้องรอ ack — หลังบ้านปฏิเสธการส่งต่อได้ (เช่นอีกฝ่ายออกไปแล้ว)
        emitOffer: (payload) =>
          emitWithAck<{ ok: boolean; error?: string }>(socket, 'rtc:signal', payload),
        onChange: syncPeers,
        onConnected: () => {
          if (callRef.current && callRef.current.connectedAt === null) {
            callRef.current.connectedAt = Date.now();
          }
        },
        onFailed: () => {
          if (!callRef.current?.turnAvailable) {
            setError('ต่อสายไม่ติด — เครือข่ายนี้ต้องมี TURN server ซึ่งยังไม่ได้ตั้ง');
          }
        },
        // สายกลุ่ม: คนหนึ่งหลุดไม่ใช่ข่าวของทั้งห้อง ช่องของเขาบอกเองอยู่แล้ว
        onOfferRejected: (_coreUserId, message) => {
          if (!callRef.current?.group) setError(message ?? 'ส่งสัญญาณเสียงไม่ถึงอีกฝ่าย');
        },
        onOfferFailed: () => setError('เปิดการเชื่อมต่อเสียงไม่สำเร็จ — ลองวางแล้วโทรใหม่'),
      });

      meshRef.current = mesh;

      return mesh;
    },
    [me.id, mediaState, syncPeers, setError],
  );

  /// เปิดสายไปหาคนหนึ่งคนพร้อมสถานะ (กำลังเรียก / อยู่ในสายแล้ว)
  const openPeer = useCallback(
    (coreUserId: string, status: PeerStatus) => {
      const mesh = meshRef.current;

      if (!mesh) return;

      statusRef.current.set(coreUserId, status);
      mesh.open(coreUserId, status === 'joined');
      syncPeers();
    },
    [syncPeers],
  );

  const dropPeer = useCallback(
    (coreUserId: string) => {
      statusRef.current.delete(coreUserId);
      meshRef.current?.drop(coreUserId);
      syncPeers();
    },
    [syncPeers],
  );

  const makeOffer = useCallback(async (coreUserId: string) => {
    await meshRef.current?.offer(coreUserId);
  }, []);

  const offerAll = useCallback(async () => {
    await meshRef.current?.offerAll();
  }, []);

  // ────────────────────────────────────────────────────────────
  // อุปกรณ์
  // ────────────────────────────────────────────────────────────

  const refreshDevices = useCallback(async (): Promise<DeviceMap | null> => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;

    if (typeof media?.enumerateDevices !== 'function') return null;

    try {
      const raw = await media.enumerateDevices();
      const next = groupDevices(raw);

      devicesRef.current = next;
      setDevices(next);
      setCameraAllowed(permissionGranted(raw, 'videoinput'));

      return next;
    } catch {
      return null;
    }
  }, []);

  /// เปลี่ยนไมค์กลางสาย — `replaceTrack` ไม่ต้องเจรจาใหม่ อีกฝ่ายไม่สะดุด
  const switchMic = useCallback(
    async (deviceId: string | null) => {
      const current = localStream.current;

      if (!current) return;

      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(deviceId),
          video: false,
        });
        const [track] = fresh.getAudioTracks();

        if (!track) return;

        // สายจบไประหว่างรอสิทธิ์ — อย่าทิ้งไฟไมค์ค้างไว้
        if (localStream.current !== current) {
          track.stop();

          return;
        }

        track.enabled = !mutedRef.current;

        const old = current.getAudioTracks();
        await meshRef.current?.replaceTrack(old, track);

        for (const item of old) {
          current.removeTrack(item);
          item.stop();
        }

        current.addTrack(track);
        setMicStream(newStream([track]) ?? current);
        pushToast(
          'audioinput',
          deviceNotice(
            'connected',
            'audioinput',
            track.label || labelOf(devicesRef.current?.audioinput ?? [], deviceId) || 'ไมโครโฟน',
          ),
        );
      } catch {
        setError('เปลี่ยนไมโครโฟนไม่สำเร็จ — อุปกรณ์อาจถูกโปรแกรมอื่นใช้อยู่');
      }
    },
    [pushToast, setError],
  );

  /// ปิดกล้อง: ถอนออกจากทุกสายก่อนแล้วค่อยหยุด ไม่งั้นอีกฝ่ายค้างเฟรมสุดท้าย
  const stopCamera = useCallback(async () => {
    const stream = cameraRef.current;

    if (!stream) return;

    meshRef.current?.removeTracks(stream.getTracks());

    stopAll(stream);
    cameraRef.current = null;
    setCameraStream(null);
    broadcastState();

    await offerAll();
  }, [broadcastState, offerAll]);

  const openCamera = useCallback(async () => {
    if (cameraRef.current) return;

    setCameraBusy(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(selectionRef.current.videoinput),
        audio: false,
      });

      cameraRef.current = stream;
      setCameraStream(stream);

      if (callRef.current) callRef.current.usedVideo = true;

      for (const track of stream.getVideoTracks()) {
        meshRef.current?.addTrack(track, stream);

        // ผู้ใช้ปิดกล้องจากระบบปฏิบัติการได้ ต้องเก็บให้เหมือนกดปิดในแอป
        track.onended = () => void stopCamera();
      }

      broadcastState();
      void refreshDevices();
      await offerAll();
    } catch (caught) {
      setError(
        caught instanceof DOMException
          ? 'เข้าถึงกล้องไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง'
          : caught instanceof Error
            ? caught.message
            : 'เปิดกล้องไม่สำเร็จ',
      );
    } finally {
      setCameraBusy(false);
    }
  }, [broadcastState, offerAll, refreshDevices, setError, stopCamera]);

  /// เปลี่ยนกล้องกลางสาย — `replaceTrack` และคง MediaStream ตัวเดิมไว้
  ///
  /// ต้องคงตัวเดิม เพราะ id ของมันคือสิ่งที่อีกฝ่ายใช้แยกว่าภาพเส้นนี้คือ
  /// "กล้อง" (ดู `PeerMediaState`) ถ้าเปลี่ยนตัว ภาพกล้องใหม่จะถูกเดาว่าเป็นจอ
  const switchCamera = useCallback(
    async (deviceId: string | null) => {
      const current = cameraRef.current;

      if (!current) return;

      setCameraBusy(true);

      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(deviceId),
          audio: false,
        });
        const [track] = fresh.getVideoTracks();

        if (!track) return;

        if (cameraRef.current !== current) {
          track.stop();

          return;
        }

        const old = current.getVideoTracks();
        await meshRef.current?.replaceTrack(old, track);

        for (const item of old) {
          item.onended = null;
          current.removeTrack(item);
          item.stop();
        }

        current.addTrack(track);
        track.onended = () => void stopCamera();
        setCameraStream(newStream([track]) ?? current);
      } catch {
        setError('เปลี่ยนกล้องไม่สำเร็จ — กล้องอาจถูกโปรแกรมอื่นใช้อยู่');
      } finally {
        setCameraBusy(false);
      }
    },
    [setError, stopCamera],
  );

  const selectDevice = useCallback(
    (kind: DeviceKind, deviceId: string) => {
      const next = { ...selectionRef.current, [kind]: deviceId };

      selectionRef.current = next;
      setSelection(next);
      saveSelection(next);

      if (kind === 'audioinput') void switchMic(deviceId);
      if (kind === 'videoinput') void switchCamera(deviceId);
      // ลำโพง: RemoteAudio ทุกตัวอ่าน selection แล้ว setSinkId เอง
    },
    [switchMic, switchCamera],
  );

  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      stopAll(stream);
    } catch {
      setError('เข้าถึงกล้องไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง');
    }

    await refreshDevices();
  }, [refreshDevices, setError]);

  /// แจ้งตอนเริ่มสายว่ากำลังใช้ไมค์และลำโพงตัวไหน — แบบ Instagram
  const announceDevices = useCallback(async () => {
    const map = (await refreshDevices()) ?? devicesRef.current;
    const [micTrack] = localStream.current?.getAudioTracks() ?? [];
    const micLabel =
      micTrack?.label ||
      labelOf(map?.audioinput ?? [], pickDevice(map?.audioinput ?? [], selectionRef.current.audioinput));

    if (micLabel) pushToast('audioinput', deviceNotice('connected', 'audioinput', micLabel));

    const outputs = map?.audiooutput ?? [];
    const speaker = labelOf(outputs, pickDevice(outputs, selectionRef.current.audiooutput));

    if (speaker) pushToast('audiooutput', deviceNotice('connected', 'audiooutput', speaker));
  }, [pushToast, refreshDevices]);

  const busy = lobby !== null || call !== null;

  // เสียบ/ถอดอุปกรณ์ระหว่างอยู่ห้องรอหรือในสาย
  useEffect(() => {
    if (!busy) return;

    const media = navigator.mediaDevices;

    if (typeof media?.addEventListener !== 'function') return;

    const onChange = async () => {
      const previous = devicesRef.current;
      const next = await refreshDevices();

      if (!previous || !next) return;

      const diff = diffDevices(previous, next);

      for (const device of diff.added) {
        pushToast(device.kind, deviceNotice('connected', device.kind, device.label));
      }

      for (const device of diff.removed) {
        pushToast(device.kind, deviceNotice('removed', device.kind, device.label));
      }

      // อุปกรณ์ที่เลือกไว้ถูกถอด → ถอยไปค่าเริ่มต้น · ค่าเริ่มต้นย้าย → ตามไป
      const chosen = selectionRef.current;
      const mic = pickDevice(next.audioinput, chosen.audioinput);
      const cam = pickDevice(next.videoinput, chosen.videoinput);
      const out = pickDevice(next.audiooutput, chosen.audiooutput);
      const micGone = chosen.audioinput !== null && mic !== chosen.audioinput;
      const camGone = chosen.videoinput !== null && cam !== chosen.videoinput;

      if (micGone || camGone || (chosen.audiooutput !== null && out !== chosen.audiooutput)) {
        const fallback = { audioinput: mic, videoinput: cam, audiooutput: out };

        selectionRef.current = fallback;
        setSelection(fallback);
      }

      if (micGone || (mic === 'default' && defaultMoved(previous, next, 'audioinput'))) {
        void switchMic(mic);
      }

      if (camGone && cameraRef.current) {
        if (cam) void switchCamera(cam);
        else void stopCamera();
      }
    };

    const listener = () => void onChange();

    media.addEventListener('devicechange', listener);

    return () => media.removeEventListener('devicechange', listener);
  }, [busy, refreshDevices, pushToast, switchMic, switchCamera, stopCamera]);

  // ────────────────────────────────────────────────────────────
  // ห้องรอ → โทรออก
  // ────────────────────────────────────────────────────────────

  const startCall = useCallback(
    async (
      channelId: string,
      peer: string | readonly string[],
      options?: StartCallOptions,
    ) => {
      // กันโทรซ้อนสายที่คุยอยู่ — ไม่งั้นสายเก่าถูกทับทิ้งโดยไม่ถูกปิด
      if (callRef.current) {
        setError('กำลังอยู่ในสายอยู่แล้ว — วางสายก่อนถึงจะโทรใหม่ได้');

        return;
      }

      const members = uniqueOthers(typeof peer === 'string' ? [peer] : peer, me.id);

      if (members.length === 0) {
        setError('ไม่มีใครให้โทรหาในห้องนี้');

        return;
      }

      if (members.length + 1 > MAX_CALL_PARTICIPANTS) {
        setError(
          `โทรกลุ่มได้สูงสุด ${MAX_CALL_PARTICIPANTS} คน — ห้องนี้มี ${members.length + 1} คน`,
        );

        return;
      }

      const kind = options?.kind ?? 'AUDIO';

      setError(null);
      setEnded(null);
      setLobby({ channelId, members, kind });
      void refreshDevices();

      if (kind === 'VIDEO') await openCamera();
    },
    [me.id, openCamera, refreshDevices, setError],
  );

  const closeLobby = useCallback(() => {
    stopAll(cameraRef.current);
    cameraRef.current = null;
    setCameraStream(null);
    setLobby(null);
    setSettingsOpen(false);
    mutedRef.current = false;
    setMuted(false);
    setDeafened(false);
  }, []);

  /// เปิดไมค์ตามอุปกรณ์ที่เลือกไว้ (ถ้ายังไม่มี) — ใช้ทั้งโทรออกและรับสาย
  const ensureMic = useCallback(async () => {
    if (localStream.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints(selectionRef.current.audioinput),
      video: false,
    });

    for (const track of stream.getAudioTracks()) track.enabled = !mutedRef.current;

    localStream.current = stream;
    setMicStream(stream);
  }, []);

  const mapIce = (session: JoinVoiceResponse): RTCIceServer[] =>
    session.iceServers.map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    }));

  /// ไม่มีใครรับภายในเวลาที่กำหนด — เลิกเรียกคนที่ยังไม่รับ
  const armRingTimeout = useCallback(() => {
    if (ringTimer.current) clearTimeout(ringTimer.current);

    ringTimer.current = setTimeout(() => {
      ringTimer.current = null;

      const current = callRef.current;
      const socket = socketRef.current;

      if (!current) return;

      const entries = [...statusRef.current];
      const anyoneJoined = entries.some(([, status]) => status === 'joined');

      for (const [coreUserId, status] of entries) {
        if (status !== 'ringing') continue;

        socket?.emit('call:cancel', {
          sessionId: current.sessionId,
          toCoreUserId: coreUserId,
        });
        dropPeer(coreUserId);
      }

      if (!anyoneJoined) {
        void leaveSession(current.sessionId);
        finishCall(false);
        setError('ไม่มีผู้รับสาย');
      }
    }, RING_TIMEOUT_MS);
  }, [dropPeer, finishCall, leaveSession, setError]);

  const beginCall = useCallback(async () => {
    const plan = lobby;

    if (!plan || callRef.current) return;

    setStarting(true);
    setError(null);

    // อยู่ในห้องเสียงแบบต่อค้างอยู่ = ออกก่อน (แบบ Discord: โทรแล้วหลุดจากช่องเสียง)
    // หนึ่งคนอยู่ได้ทีละห้องเสียง ไม่งั้นสัญญาณของสองห้องจะปนกัน
    if (voiceRoom.channelId) await voiceRoom.leave();

    // จำไว้ว่าเข้าห้องไปแล้วหรือยัง เพื่อออกให้ถูกต้องถ้าพลาดทีหลัง
    let joinedSessionId: string | null = null;

    try {
      await ensureMic();

      const session = await api.post<JoinVoiceResponse>('/voice-sessions', {
        channelId: plan.channelId,
      });

      joinedSessionId = session.id;

      const socket = await connectSocket();

      socketRef.current = socket;

      const info: CallInfo = {
        sessionId: session.id,
        channelId: plan.channelId,
        group: plan.members.length > 1,
        members: plan.members,
        kind: plan.kind,
        iceServers: mapIce(session),
        turnAvailable: session.turnAvailable,
        connectedAt: null,
        usedVideo: plan.kind === 'VIDEO' || cameraRef.current !== null,
      };

      callRef.current = info;
      setCall(info);
      setLobby(null);
      markCallActive(true);
      createMesh(socket, session);

      for (const coreUserId of plan.members) openPeer(coreUserId, 'ringing');

      const results = await Promise.all(
        plan.members.map(async (coreUserId) => ({
          coreUserId,
          ack: await emitWithAck<{ ok: boolean; error?: string }>(socket, 'call:ring', {
            sessionId: session.id,
            toCoreUserId: coreUserId,
            // ชนิดสายสำหรับบันทึกการโทรในแชท และให้ปลายทางเปิดกล้องตอนรับ
            media: plan.kind,
          }),
        })),
      );

      const failed = results.filter((result) => !result.ack.ok);

      for (const result of failed) dropPeer(result.coreUserId);

      if (failed.length === results.length) {
        setError(failed[0]?.ack.error ?? 'ส่งเสียงกริ่งไม่สำเร็จ');
        teardown();
        clearCall();
        await leaveSession(session.id);

        return;
      }

      if (failed.length > 0) {
        setError(`โทรหาบางคนไม่ได้ — ${failed[0].ack.error ?? 'ส่งเสียงกริ่งไม่สำเร็จ'}`);
      }

      armRingTimeout();
      void announceDevices();
    } catch (caught) {
      teardown();
      clearCall();
      setLobby(null);

      if (joinedSessionId) await leaveSession(joinedSessionId);

      if (caught instanceof DOMException) {
        setError('เข้าถึงไมโครโฟนไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง');
      } else {
        setError(caught instanceof ApiError ? caught.message : 'โทรไม่สำเร็จ');
      }
    } finally {
      setStarting(false);
    }
  }, [
    lobby,
    voiceRoom,
    ensureMic,
    createMesh,
    openPeer,
    dropPeer,
    teardown,
    clearCall,
    leaveSession,
    armRingTimeout,
    announceDevices,
    setError,
  ]);

  const hangUp = useCallback(async () => {
    const current = callRef.current;

    if (!current) return;

    const socket = socketRef.current;

    if (socket) {
      // ยังไม่รับ = ยกเลิก · รับแล้ว = วางสาย — คนละ event กัน
      for (const [coreUserId, status] of statusRef.current) {
        socket.emit(status === 'ringing' ? 'call:cancel' : 'call:end', {
          sessionId: current.sessionId,
          toCoreUserId: coreUserId,
        });
      }

      // แชร์หน้าจออยู่ต้องคืนสิทธิ์ด้วย ไม่งั้นห้องจะล็อกไว้ให้คนที่ออกไปแล้ว
      if (screenStream.current) {
        socket.emit('screen:release', { sessionId: current.sessionId });
      }
    }

    finishCall(true);
    await leaveSession(current.sessionId);
  }, [finishCall, leaveSession]);

  // ────────────────────────────────────────────────────────────
  // สายเข้า
  // ────────────────────────────────────────────────────────────

  const accept = useCallback(async () => {
    const ring = incoming;

    if (!ring) return;

    setIncoming(null);
    setError(null);
    setEnded(null);

    // อยู่ในสายอื่นอยู่ = ต้องเก็บสายเดิมให้เรียบร้อยก่อน ไม่งั้นสายแรกยังเปิด
    // อยู่ในเบราว์เซอร์ กินไมค์และที่นั่งต่อไปโดยไม่มี UI ให้วางอีกแล้ว
    const previous = callRef.current;

    if (previous) {
      for (const [coreUserId, status] of statusRef.current) {
        socketRef.current?.emit(status === 'ringing' ? 'call:cancel' : 'call:end', {
          sessionId: previous.sessionId,
          toCoreUserId: coreUserId,
        });
      }

      teardown();
      clearCall();
      await leaveSession(previous.sessionId);
    }

    if (lobby) closeLobby();
    if (voiceRoom.channelId) await voiceRoom.leave();

    let joinedSessionId: string | null = null;

    try {
      await ensureMic();

      const session = await api.post<JoinVoiceResponse>('/voice-sessions', {
        channelId: ring.channelId,
      });

      joinedSessionId = session.id;

      const socket = await connectSocket();

      socketRef.current = socket;

      // กดรับเร็วกว่าที่ข้อมูลห้องจะมาถึง — ต้องรู้ให้ได้ว่าเป็นสายกลุ่มไหม
      // ไม่งั้นคนที่เข้าสายทีหลังจะยื่นข้อเสนอมาแล้วถูกเมินเพราะนึกว่าเป็นสายคู่
      const channel =
        ring.channel ??
        (await api
          .get<Channel>(`/channels/${encodeURIComponent(ring.channelId)}`)
          .catch(() => null));

      // ทุกคนที่อยู่ในห้องแล้ว (ผู้โทร + คนที่รับก่อนเรา)
      const present = uniqueOthers(
        [ring.fromCoreUserId, ...session.participants.map((row) => row.coreUserId)],
        me.id,
      );
      const roster = channel?.kind === 'GROUP_DM' ? channel.memberCoreUserIds : null;
      const members = roster
        ? uniqueOthers([ring.fromCoreUserId, ...roster], me.id)
        : present;

      const info: CallInfo = {
        sessionId: session.id,
        channelId: ring.channelId,
        group: members.length > 1,
        members,
        kind: ring.media,
        iceServers: mapIce(session),
        turnAvailable: session.turnAvailable,
        connectedAt: null,
        usedVideo: false,
      };

      callRef.current = info;
      setCall(info);

      // เราเพิ่งเข้ามา จึงยื่นข้อเสนอให้ทุกคนที่อยู่ก่อนเอง ถ้าใครยื่นมาชน
      // พอดี กฎ polite ตัดสินให้
      markCallActive(true);
      createMesh(socket, session);

      for (const coreUserId of present) openPeer(coreUserId, 'joined');

      // **รอข้อเสนอแรกจากผู้โทร ไม่ยื่นชน** (ผู้โทรยื่นทันทีที่ได้ call:answered)
      //
      // เดิมยื่นพร้อมกันทั้งสองฝั่งแล้วให้กฎ polite ตัดสิน — ถูกตามสเปก แต่พบใน
      // Chrome จริงว่าฝ่ายที่ม้วนข้อเสนอแรกทิ้งบางครั้งเก็บ ICE ของคำตอบไม่ออก
      // สักตัว สายค้าง "กำลังเชื่อมต่อ" ราวหนึ่งในสามรอบ · คนอื่นในสายกลุ่ม
      // (ไม่ใช่ผู้โทร) ไม่รู้ว่าเราเข้ามา จึงยังเป็นเรายื่นให้เหมือนเดิม
      //
      // เมื่อข้อเสนอของผู้โทรมาถึง Mesh ตั้ง ready ให้เอง (เจรจารอบหลังยื่นได้
      // ทั้งคู่) ถ้าไม่มาภายในเวลาที่กำหนด (สัญญาณหาย) เรายื่นเองแทน
      const ringer = ring.fromCoreUserId;

      const ringerPeer = meshRef.current?.get(ringer);

      if (ringerPeer) ringerPeer.ready = false;

      for (const coreUserId of present) {
        if (coreUserId !== ringer) void makeOffer(coreUserId);
      }

      const mesh = meshRef.current;

      firstOfferTimer.current = setTimeout(() => {
        firstOfferTimer.current = null;

        const peer = mesh?.get(ringer);

        if (!mesh || meshRef.current !== mesh || !peer || peer.pc.remoteDescription) return;

        mesh.setReady(ringer);
        void mesh.offer(ringer);
      }, FIRST_OFFER_WAIT_MS);

      socket.emit('call:answer', {
        sessionId: ring.sessionId,
        toCoreUserId: ring.fromCoreUserId,
        accepted: true,
      });

      // สายวิดีโอ = เปิดกล้องให้ตอนรับ แบบ Instagram (ปิดเองได้จากแถบควบคุม)
      if (ring.media === 'VIDEO') void openCamera();

      void announceDevices();
    } catch (caught) {
      teardown();
      clearCall();

      if (joinedSessionId) await leaveSession(joinedSessionId);

      setError(
        caught instanceof DOMException
          ? 'เข้าถึงไมโครโฟนไม่ได้'
          : caught instanceof ApiError
            ? caught.message
            : 'รับสายไม่สำเร็จ',
      );
    }
  }, [
    incoming,
    lobby,
    me.id,
    voiceRoom,
    closeLobby,
    ensureMic,
    createMesh,
    openPeer,
    openCamera,
    makeOffer,
    teardown,
    clearCall,
    leaveSession,
    announceDevices,
    setError,
  ]);

  const decline = useCallback(() => {
    const ring = incoming;

    if (!ring) return;

    socketRef.current?.emit('call:answer', {
      sessionId: ring.sessionId,
      toCoreUserId: ring.fromCoreUserId,
      accepted: false,
    });

    setIncoming(null);
  }, [incoming]);

  // ────────────────────────────────────────────────────────────
  // socket
  // ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        socketRef.current = socket;

        unbindRef.current.push(
          bindSocket<{
            sessionId: string;
            channelId: string;
            fromCoreUserId: string;
            media?: CallKind;
          }>(socket, 'call:incoming', (payload) => {
            // กริ่งของสายที่เราอยู่แล้ว (เช่นอีกคนในกลุ่มกดโทรซ้ำ) ไม่ต้องดัง
            if (callRef.current?.sessionId === payload.sessionId) return;

            setIncoming({
              sessionId: payload.sessionId,
              channelId: payload.channelId,
              fromCoreUserId: payload.fromCoreUserId,
              channel: null,
              media: payload.media === 'VIDEO' ? 'VIDEO' : 'AUDIO',
            });

            // รู้ว่าเป็นสายกลุ่มไหมจากห้อง — ดึงไม่ได้ก็ยังรับสายได้ตามปกติ
            void api
              .get<Channel>(`/channels/${encodeURIComponent(payload.channelId)}`)
              .then((channel) =>
                setIncoming((current) =>
                  current && current.sessionId === payload.sessionId
                    ? { ...current, channel: channel ?? null }
                    : current,
                ),
              )
              .catch(() => undefined);
          }),
        );

        unbindRef.current.push(
          bindSocket<{
            accepted: boolean;
            fromCoreUserId: string;
            sessionId?: string;
          }>(socket, 'call:answered', (payload) => {
            // ต้องเป็นคำตอบของสายที่เรากำลังโทรอยู่จริง — คำตอบของสายเก่า
            // ที่มาช้า หรือของคนที่เราไม่ได้โทรหา ต้องไม่ทำให้สายปัจจุบันถูกวาง
            const current = callRef.current;

            if (!current) return;
            if (payload.sessionId && payload.sessionId !== current.sessionId) return;

            if (!statusRef.current.has(payload.fromCoreUserId)) return;

            if (!payload.accepted) {
              dropPeer(payload.fromCoreUserId);

              // สายกลุ่มที่ยังมีคนอื่น: คนหนึ่งปฏิเสธไม่ได้แปลว่าสายจบ
              if (statusRef.current.size > 0) return;

              setNotice({ kind: 'declined', coreUserId: payload.fromCoreUserId });
              teardown();
              clearCall();

              // ถูกปฏิเสธก็ต้องออกจากห้องเสียงที่เข้าไปรอไว้แล้ว
              void leaveSession(current.sessionId);

              return;
            }

            statusRef.current.set(payload.fromCoreUserId, 'joined');

            // ตอนนี้เขามีแถวผู้เข้าร่วมแล้ว หลังบ้านจึงยอมส่งต่อ SDP
            meshRef.current?.setReady(payload.fromCoreUserId);
            syncPeers();
            void makeOffer(payload.fromCoreUserId);
          }),
        );

        unbindRef.current.push(
          bindSocket<{ sessionId?: string; fromCoreUserId?: string }>(
            socket,
            'call:cancelled',
            (payload) =>
              // เฉพาะสายที่กำลังดังอยู่จริงเท่านั้น ไม่ใช่ทุกอย่างที่ลอยเข้ามา
              setIncoming((current) => {
                if (!current) return current;

                if (
                  payload.fromCoreUserId &&
                  payload.fromCoreUserId !== current.fromCoreUserId
                ) {
                  return current;
                }

                if (payload.sessionId && payload.sessionId !== current.sessionId) {
                  return current;
                }

                return null;
              }),
          ),
        );

        unbindRef.current.push(
          bindSocket<{ sessionId?: string; fromCoreUserId?: string }>(
            socket,
            'call:ended',
            (payload) => {
              const current = callRef.current;

              if (!current) return;
              if (payload.sessionId && payload.sessionId !== current.sessionId) return;

              const from = payload.fromCoreUserId;

              // ไม่ระบุผู้ส่ง = ถือว่าเป็นคู่สายของสายหนึ่งต่อหนึ่ง (รูปเดิม)
              if (from ? !statusRef.current.has(from) : current.group) return;

              if (from) dropPeer(from);
              else statusRef.current.clear();

              // สายกลุ่ม: ยังมีคนอื่นอยู่ก็คุยกันต่อ
              if (statusRef.current.size > 0) return;

              void leaveSession(current.sessionId);
              finishCall(true);
            },
          ),
        );

        unbindRef.current.push(
          bindSocket<{
            sessionId: string;
            presenterCoreUserId: string | null;
          }>(socket, 'screen:changed', (payload) => {
            if (payload.sessionId !== callRef.current?.sessionId) return;

            presenterRef.current = payload.presenterCoreUserId;
            syncPeers();
          }),
        );

        unbindRef.current.push(
          bindSocket<{
            fromCoreUserId: string;
            kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
            data: unknown;
          }>(socket, 'rtc:signal', async (payload) => {
            const current = callRef.current;
            const mesh = meshRef.current;

            if (!current || !mesh) return;

            const from = payload.fromCoreUserId;

            // สายกลุ่ม: คนที่รับทีหลังเรายื่นข้อเสนอมาหาเราเอง — หลังบ้าน
            // ส่งต่อให้เฉพาะคนที่อยู่ห้องเสียงเดียวกันจริง จึงเปิดสายรับได้เลย
            if (!mesh.has(from) && current.group && payload.kind === 'offer') {
              openPeer(from, 'joined');
            }

            if (!mesh.has(from)) return;

            if (current.group && payload.kind === 'offer' && statusRef.current.get(from) === 'ringing') {
              statusRef.current.set(from, 'joined');
              mesh.setReady(from);
              syncPeers();
            }

            await mesh.signal(payload);
          }),
        );

        // ไอคอนปิดไมค์/ปิดหูฟัง/กล้องของทุกคนในสาย — หลังบ้านเป็นคนบอก
        unbindRef.current.push(
          bindSocket<VoiceOccupants>(socket, 'voice:occupants', (payload) => {
            const current = callRef.current;

            if (!current || payload.channelId !== current.channelId) return;

            occupantsRef.current = new Map(
              payload.occupants.map((row) => [row.coreUserId, row]),
            );
            syncPeers();
          }),
        );
      } catch {
        // ต่อ socket ไม่ได้ = ยังใช้แอปได้ แค่ไม่มีสายเข้า
      }
    })();

    return () => {
      cancelled = true;

      // ถอดเฉพาะ handler ของตัวเอง — หน้าจออื่นฟัง event เดียวกันบน
      // socket ตัวเดียวกันอยู่ ถ้า off ทั้ง event จะลบของเขาไปด้วย
      for (const off of unbindRef.current) off();

      unbindRef.current = [];
    };
  }, [teardown, clearCall, leaveSession, makeOffer, openPeer, dropPeer, finishCall, syncPeers]);

  // ปิดแท็บ = ปล่อยไมค์ ไม่งั้นไฟไมค์ยังติดค้าง
  useEffect(() => teardown, [teardown]);

  // ทุกครั้งที่ไมค์/หูฟัง/กล้องเปลี่ยน (รวมค่าที่ตั้งไว้จากห้องรอตอนเข้าสาย)
  // บอกหลังบ้าน แล้วหลังบ้านกระจาย voice:occupants ให้ทุกคนเห็นไอคอนตรงกัน
  const sessionId = call?.sessionId ?? null;
  const videoOn = cameraStream !== null;

  useEffect(() => {
    if (sessionId) reportVoiceState({ muted, deafened, video: videoOn });
  }, [sessionId, muted, deafened, videoOn, reportVoiceState]);

  // ────────────────────────────────────────────────────────────
  // ปุ่มในสาย
  // ────────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;

    for (const track of localStream.current?.getAudioTracks() ?? []) {
      track.enabled = !next;
    }

    mutedRef.current = next;
    setMuted(next);
    broadcastState();
  }, [broadcastState]);

  /// เลิกแชร์ให้เรียบร้อยทุกทาง — ถอนแทร็กออกจากทุกสายแล้วเจรจาใหม่
  ///
  /// แค่ `track.stop()` ไม่พอ: sender ยังอยู่และ SDP ยังบอกว่ามีช่องวิดีโอ
  /// ผู้ชมจะค้างที่เฟรมสุดท้าย ผู้แชร์เชื่อว่าหยุดแล้วแต่ปลายทางยังเห็นจอค้าง
  const stopPresenting = useCallback(
    async (reason: 'stopped' | 'ended') => {
      const stream = screenStream.current;

      if (!stream) return;

      meshRef.current?.removeTracks(stream.getTracks());

      stopAll(stream);
      screenStream.current = null;

      const current = callRef.current;

      if (current) {
        socketRef.current?.emit('screen:release', { sessionId: current.sessionId });
      }

      setScreenPreview(null);
      setPresenting(false);
      dispatchShare(reason);
      broadcastState();

      await offerAll();
    },
    [broadcastState, offerAll],
  );

  const toggleScreen = useCallback(async () => {
    const socket = socketRef.current;
    const current = callRef.current;

    if (!current || !socket) return;

    if (screenStream.current) {
      await stopPresenting('stopped');

      return;
    }

    try {
      const claim = await emitWithAck<{ ok: boolean; error?: string }>(
        socket,
        'screen:claim',
        { sessionId: current.sessionId },
      );

      if (!claim.ok) {
        setError(claim.error ?? 'แชร์หน้าจอไม่สำเร็จ');

        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      screenStream.current = stream;

      for (const track of stream.getVideoTracks()) {
        meshRef.current?.addTrack(track, stream);

        // กด "หยุดแชร์" จากแถบของเบราว์เซอร์เอง — ต้องเก็บให้เหมือนกดหยุด
        // ในแอปทุกประการ รวมถึงภาพตัวอย่างมุมขวาล่างต้องหายไปด้วย
        track.onended = () => void stopPresenting('ended');
      }

      setScreenPreview(stream);
      setPresenting(true);
      dispatchShare('started');
      broadcastState();

      // เพิ่มแทร็กแล้วต้องเจรจาใหม่ ไม่งั้นอีกฝ่ายไม่ได้รับภาพ (เรียกตรง ๆ
      // ไม่พึ่ง onnegotiationneeded อย่างเดียว เพราะลำดับการยิงต่างกัน)
      await offerAll();
    } catch {
      // ผู้ใช้กดยกเลิกหน้าต่างเลือกจอ — ต้องคืนสิทธิ์ ไม่งั้นห้องจะล็อกไว้
      socket.emit('screen:release', { sessionId: current.sessionId });
      screenStream.current = null;
      setPresenting(false);
      dispatchShare('stopped');
    }
  }, [stopPresenting, broadcastState, offerAll, setError]);

  const toggleCamera = useCallback(() => {
    if (cameraRef.current) void stopCamera();
    else void openCamera();
  }, [openCamera, stopCamera]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);

    document.addEventListener('fullscreenchange', sync);

    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // ทางลัดแป้นพิมพ์ — ผูกครั้งเดียวต่อสาย อ่านคำสั่งล่าสุดผ่าน ref
  const actions = useRef<Record<CallShortcut, () => void>>({
    settings: () => undefined,
    mute: () => undefined,
    hangup: () => undefined,
    share: () => undefined,
    fullscreen: () => undefined,
  });

  useEffect(() => {
    actions.current = {
      settings: () => setSettingsOpen((open) => !open),
      mute: toggleMute,
      hangup: () => void hangUp(),
      share: () => void toggleScreen(),
      fullscreen: toggleFullscreen,
    };
  });

  const inSession = call !== null;

  useEffect(() => {
    if (!inSession) return;

    const onKey = (event: KeyboardEvent) => {
      const action = matchShortcut(event);

      if (!action) return;

      // กัน alt+f / alt+e เปิดเมนูของเบราว์เซอร์บน Windows
      event.preventDefault();
      actions.current[action]();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [inSession]);

  const finishEnded = useCallback(() => setEnded(null), []);

  const openHelp = useCallback(() => {
    setSettingsOpen(false);
    setReportOpen(true);
  }, []);

  const value = useMemo(
    () => ({ startCall, inCall: call !== null || lobby !== null, error }),
    [startCall, call, lobby, error],
  );

  const phase = peers.some((peer) => peer.status === 'joined') ? 'in-call' : 'calling';
  const trapFocus = !settingsOpen && !reportOpen && !incoming;
  const outputSupported = supportsSinkId();
  const sinkId = outputSupported ? pickDevice(devices.audiooutput, selection.audiooutput) : null;

  const overlayNotice = notice && (
    <div className="absolute inset-x-0 top-20 z-30 mx-auto w-[min(26rem,calc(100vw-2rem))]">
      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );

  return (
    <CallContext.Provider value={value}>
      {children}

      {/* เสียงของแต่ละคน — ซ่อนไว้ ผู้ใช้ไม่ต้องเห็นตัวเล่น */}
      {peers.map((peer) => (
        <RemoteAudio
          key={peer.coreUserId}
          coreUserId={peer.coreUserId}
          stream={peer.audio}
          sinkId={sinkId}
          muted={deafened}
        />
      ))}

      {lobby && !call && (
        <CallLobby
          members={lobby.members}
          cameraStream={cameraStream}
          cameraBusy={cameraBusy}
          muted={muted}
          deafened={deafened}
          starting={starting}
          trapFocus={trapFocus}
          onToggleCamera={toggleCamera}
          onToggleMic={toggleMute}
          onToggleSpeaker={() => setDeafened((value) => !value)}
          onSettings={() => setSettingsOpen(true)}
          onStart={() => void beginCall()}
          onClose={closeLobby}
        >
          <CallToasts toasts={toasts} />
          {overlayNotice}
        </CallLobby>
      )}

      {call && (
        <CallScreen
          meCoreUserId={me.id}
          members={call.members}
          group={call.group}
          phase={phase}
          peers={peers}
          muted={muted}
          deafened={deafened}
          cameraStream={cameraStream}
          cameraBusy={cameraBusy}
          presenting={presenting}
          screenStream={screenPreview}
          sharePreview={sharePreview}
          fullscreen={fullscreen}
          trapFocus={trapFocus}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onToggleScreen={() => void toggleScreen()}
          onHangUp={() => void hangUp()}
          onSettings={() => setSettingsOpen(true)}
          onFullscreen={toggleFullscreen}
          onUndeafen={() => setDeafened(false)}
          onShareCollapse={() => dispatchShare('collapse')}
          onShareExpand={() => dispatchShare('expand')}
        >
          <CallToasts toasts={toasts} />
          {overlayNotice}
        </CallScreen>
      )}

      {settingsOpen && (lobby || call) && (
        <CallSettingsDialog
          devices={devices}
          cameraAllowed={cameraAllowed}
          outputSupported={outputSupported}
          selection={selection}
          onSelect={selectDevice}
          liveCamera={cameraStream}
          liveMic={call ? micStream : null}
          onRequestCamera={requestCamera}
          onHelp={openHelp}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {(lobby || call || reportOpen) && (
        <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} />
      )}

      {ended && !call && !lobby && <CallEnded call={ended} onDone={finishEnded} />}

      {incoming && (
        <IncomingCallSheet
          ring={incoming}
          onAccept={() => void accept()}
          onDecline={decline}
        />
      )}

      {/* ปัญหานอกสาย (โทรไม่ติด · ถูกปฏิเสธ) — ในสายแสดงบนหน้าจอโทรแทน */}
      {notice && !call && !lobby && (
        <div className="fixed bottom-4 right-4 z-120 w-[min(24rem,calc(100vw-2rem))]">
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}
    </CallContext.Provider>
  );
}

/// ข้อความผิดพลาดของสาย
///
/// ต้องเห็นได้ **ระหว่างอยู่ในสาย** ด้วย — ช่วงนั้นคือช่วงที่ต้องบอกมากที่สุด:
/// ต่อสายไม่ติดเพราะไม่มี TURN หรือแชร์หน้าจอไม่ได้เพราะมีคนแชร์อยู่แล้ว
function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: ErrorNotice;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      // role=alert ทำให้โปรแกรมอ่านหน้าจออ่านขึ้นทันที — คนในสายอาจไม่ได้มองจอ
      role="alert"
      className="block w-full rounded-xl border border-destructive/40 bg-card px-3 py-2 text-left text-sm text-destructive shadow-lg animate-in fade-in-0 zoom-in-95"
    >
      {notice.kind === 'declined' ? (
        <span>
          <DisplayName coreUserId={notice.coreUserId} /> ปฏิเสธสาย
        </span>
      ) : (
        notice.text
      )}
      <span className="ml-2 text-xs text-muted-foreground">(แตะเพื่อปิด)</span>
    </button>
  );
}

function IncomingCallSheet({
  ring,
  onAccept,
  onDecline,
}: {
  ring: IncomingCall;
  onAccept: () => void;
  onDecline: () => void;
}) {
  // สายเข้าเด้งขึ้นมาเองโดยที่ผู้ใช้ไม่ได้สั่ง และแผ่นนี้ถูกวาดไว้ท้าย DOM
  // คนที่ใช้คีย์บอร์ดจึงต้อง Tab ผ่านทั้งหน้ากว่าจะถึงปุ่มรับสาย —
  // กว่าจะถึงสายก็วางไปแล้ว ต้องย้ายโฟกัสมาให้ และ Escape = ปฏิเสธ
  const sheetRef = useModalFocus<HTMLDivElement>(true, onDecline);
  const from = ring.fromCoreUserId;
  const group =
    ring.channel?.kind === 'GROUP_DM' ? (ring.channel.memberCoreUserIds?.length ?? 0) : 0;

  return createPortal(
    <div
      ref={sheetRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`สายเรียกเข้าจาก ${from}`}
      className="fixed inset-x-0 bottom-4 z-120 mx-auto w-[min(24rem,calc(100vw-2rem))] csmju-surface p-4 shadow-xl outline-none animate-in fade-in-0 zoom-in-95"
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 animate-pulse">
          <CallAvatar coreUserId={from} size={48} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            <DisplayName coreUserId={from} />
          </span>
          <span className="block text-sm text-muted-foreground">สายเรียกเข้า…</span>
          {group > 0 && (
            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Users aria-hidden className="size-3.5" />
              {ring.channel?.name ?? 'แชทกลุ่ม'} · {group} คน
            </span>
          )}
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onDecline}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <PhoneOff className="size-4" />
          ปฏิเสธ
        </button>

        <button
          type="button"
          onClick={onAccept}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Phone className="size-4" />
          รับสาย
        </button>
      </div>
    </div>,
    document.body,
  );
}
