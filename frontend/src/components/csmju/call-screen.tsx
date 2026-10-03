'use client';

import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  PhoneOff,
  Settings,
  Video,
  VideoOff,
  VolumeX,
} from 'lucide-react';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import {
  CallAvatar,
  CallBackdrop,
  CallTitle,
  DisplayName,
  RoundButton,
  VideoView,
} from '@/components/csmju/call-ui';
import { CallSharePreview } from '@/components/csmju/call-share-preview';
import type { SharePreviewState } from '@/lib/csmju/call-share';
import { cn } from '@/lib/utils';

/// หน้าจอระหว่างโทร — ทั้งตอน "กำลังโทร…" และตอนคุยกันแล้ว แบบ Instagram
///
/// ตัวนี้วาดอย่างเดียว ไม่ถือสาย ไม่ถือสตรีม — ทุกอย่างมาจาก provider
/// จึงเปลี่ยนหน้าตาได้โดยไม่ต้องแตะเครื่องสถานะของ WebRTC

export type PeerConnectionState = 'connecting' | 'connected' | 'failed';

/// ภาพรวมของคนหนึ่งคนในสาย เท่าที่หน้าจอต้องรู้
export interface PeerView {
  coreUserId: string;
  /// ringing = เรียกอยู่แต่ยังไม่รับ · joined = อยู่ในสายแล้ว
  status: 'ringing' | 'joined';
  connection: PeerConnectionState;
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  muted: boolean;
  cameraOn: boolean;
}

export interface CallScreenProps {
  meCoreUserId: string;
  /// คนอื่นในสาย (ไม่รวมเรา) — ใช้ทำชื่อบนหัวจอ
  members: readonly string[];
  group: boolean;
  phase: 'calling' | 'in-call';
  peers: readonly PeerView[];
  muted: boolean;
  deafened: boolean;
  cameraStream: MediaStream | null;
  cameraBusy: boolean;
  presenting: boolean;
  screenStream: MediaStream | null;
  sharePreview: SharePreviewState;
  fullscreen: boolean;
  trapFocus: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onHangUp: () => void;
  onSettings: () => void;
  onFullscreen: () => void;
  onUndeafen: () => void;
  onShareCollapse: () => void;
  onShareExpand: () => void;
  /// แจ้งเตือนอุปกรณ์ · ข้อความผิดพลาด — วางไว้ในหน้าจอนี้ให้เห็นระหว่างคุย
  children?: ReactNode;
}

export function CallScreen(props: CallScreenProps) {
  const {
    meCoreUserId,
    members,
    group,
    phase,
    peers,
    muted,
    deafened,
    cameraStream,
    cameraBusy,
    presenting,
    screenStream,
    sharePreview,
    fullscreen,
    trapFocus,
    children,
  } = props;

  // วางสายต้องทำด้วยปุ่มหรือ alt+e เท่านั้น — Escape ไม่วางสาย
  // (ผู้ใช้กด Esc เพื่อออกจากเต็มจอบ่อยมาก ถ้าวางสายด้วยจะหลุดสายโดยไม่ตั้งใจ)
  const rootRef = useModalFocus<HTMLDivElement>(trapFocus);
  const joined = peers.filter((peer) => peer.status === 'joined');
  const [first] = members;

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={phase === 'calling' ? 'กำลังโทร' : 'อยู่ในสาย'}
      className="fixed inset-0 z-95 overflow-hidden bg-black text-white outline-none animate-in fade-in-0 zoom-in-95"
    >
      {phase === 'calling' ? (
        <Calling members={members} />
      ) : group ? (
        <GroupStage
          meCoreUserId={meCoreUserId}
          peers={peers}
          muted={muted}
          cameraStream={cameraStream}
        />
      ) : (
        <DirectStage peer={joined[0] ?? peers[0]} />
      )}

      {/* หัวจอ */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-4 pb-8 pt-4">
        {phase === 'in-call' && first && (
          <>
            <CallAvatar coreUserId={first} size={40} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold">
                <CallTitle members={members} />
              </span>
              <span className="block text-xs text-white/70">
                {joined.length + 1} คน
              </span>
            </span>
          </>
        )}

        <span className="flex-1" />

        <RoundButton label="การตั้งค่า" size="sm" onClick={props.onSettings}>
          <Settings aria-hidden className="size-5" />
        </RoundButton>
        <RoundButton
          label={fullscreen ? 'ออกจากโหมดเต็มหน้าจอ' : 'เต็มหน้าจอ'}
          size="sm"
          pressed={fullscreen}
          onClick={props.onFullscreen}
        >
          {fullscreen ? (
            <Minimize aria-hidden className="size-5" />
          ) : (
            <Maximize aria-hidden className="size-5" />
          )}
        </RoundButton>
      </header>

      {deafened && (
        <button
          type="button"
          onClick={props.onUndeafen}
          className="absolute left-1/2 top-20 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-neutral-800/95 px-4 py-2 text-sm text-white shadow-lg transition-colors hover:bg-neutral-700"
        >
          <VolumeX aria-hidden className="size-4" />
          ลำโพงปิดอยู่ · แตะเพื่อเปิด
        </button>
      )}

      {children}

      {/* ภาพกล้องของเราเอง (สายหนึ่งต่อหนึ่ง) — สายกลุ่มมีช่องของเราในตารางแล้ว */}
      {cameraStream && (phase === 'calling' || !group) && (
        <div className="absolute right-4 top-20 z-10 aspect-video w-36 overflow-hidden rounded-xl bg-neutral-900 shadow-xl ring-1 ring-white/10 sm:w-52">
          <VideoView stream={cameraStream} mirrored label="ภาพจากกล้องของคุณ" />
        </div>
      )}

      <CallSharePreview
        stream={screenStream}
        state={sharePreview}
        onStop={props.onToggleScreen}
        onCollapse={props.onShareCollapse}
        onExpand={props.onShareExpand}
      />

      {/* ปุ่มควบคุม */}
      <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center gap-3">
        <RoundButton
          label={presenting ? 'หยุดแชร์หน้าจอ' : 'แชร์หน้าจอ'}
          tone={presenting ? 'on' : 'plain'}
          pressed={presenting}
          onClick={props.onToggleScreen}
        >
          <MonitorUp aria-hidden className="size-5" />
        </RoundButton>
        <RoundButton
          label={cameraStream ? 'ปิดกล้อง' : 'เปิดกล้อง'}
          tone={cameraStream ? 'plain' : 'on'}
          disabled={cameraBusy}
          onClick={props.onToggleCamera}
        >
          {cameraStream ? (
            <Video aria-hidden className="size-5" />
          ) : (
            <VideoOff aria-hidden className="size-5" />
          )}
        </RoundButton>
        <RoundButton
          label={muted ? 'เปิดไมค์' : 'ปิดไมค์'}
          tone={muted ? 'on' : 'plain'}
          pressed={muted}
          onClick={props.onToggleMute}
        >
          {muted ? (
            <MicOff aria-hidden className="size-5" />
          ) : (
            <Mic aria-hidden className="size-5" />
          )}
        </RoundButton>
        <RoundButton label="วางสาย" tone="danger" onClick={props.onHangUp}>
          <PhoneOff aria-hidden className="size-5" />
        </RoundButton>
      </div>
    </div>,
    document.body,
  );
}

function Calling({ members }: { members: readonly string[] }) {
  const [first] = members;

  if (!first) return null;

  return (
    <>
      <CallBackdrop coreUserId={first} />
      <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
        <CallAvatar coreUserId={first} size={112} />
        <p className="mt-4 text-xl font-semibold">
          <CallTitle members={members} />
        </p>
        <p aria-hidden className="mt-1 text-sm text-white/70">
          กำลังโทร…
        </p>
        <p className="sr-only" aria-live="polite">
          กำลังโทรหา <CallTitle members={members} />…
        </p>
      </div>
    </>
  );
}

function statusText(peer: PeerView): string | null {
  if (peer.status === 'ringing') return 'กำลังโทร…';
  if (peer.connection === 'connecting') return 'กำลังเชื่อมต่อ…';
  if (peer.connection === 'failed') return 'เชื่อมต่อไม่สำเร็จ';

  return null;
}

/// สายหนึ่งต่อหนึ่ง: ภาพของอีกฝ่ายเต็มจอ หรือรูปโปรไฟล์ใหญ่บนพื้นเบลอ
function DirectStage({ peer }: { peer: PeerView | undefined }) {
  if (!peer) return null;

  const status = statusText(peer);

  if (peer.screen) {
    return (
      <div className="absolute inset-0">
        <VideoView
          stream={peer.screen}
          fit="contain"
          label="หน้าจอที่อีกฝ่ายกำลังแชร์"
        />
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">
          <DisplayName coreUserId={peer.coreUserId} /> กำลังแชร์หน้าจอ
        </p>
        {peer.camera && (
          <div className="absolute left-4 top-20 aspect-video w-36 overflow-hidden rounded-xl ring-1 ring-white/10 sm:w-52">
            <VideoView stream={peer.camera} label="ภาพจากกล้องของอีกฝ่าย" />
          </div>
        )}
      </div>
    );
  }

  if (peer.camera) {
    return (
      <div className="absolute inset-0">
        <VideoView stream={peer.camera} label="ภาพจากกล้องของอีกฝ่าย" />
        {peer.muted && (
          <span className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs">
            <MicOff aria-hidden className="size-3.5" />
            ปิดไมค์อยู่
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <CallBackdrop coreUserId={peer.coreUserId} />
      <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
        <CallAvatar coreUserId={peer.coreUserId} size={128} />
        <p className="mt-4 text-xl font-semibold">
          <DisplayName coreUserId={peer.coreUserId} />
        </p>
        {(status || peer.muted) && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
            {!status && <MicOff aria-hidden className="size-3.5" />}
            {status ?? 'ปิดไมค์อยู่'}
          </p>
        )}
      </div>
    </>
  );
}

/// สายกลุ่ม: ตารางช่องของทุกคน · ถ้ามีคนแชร์จอ จอนั้นขึ้นเวทีหลัก
function GroupStage({
  meCoreUserId,
  peers,
  muted,
  cameraStream,
}: {
  meCoreUserId: string;
  peers: readonly PeerView[];
  muted: boolean;
  cameraStream: MediaStream | null;
}) {
  const presenter = peers.find((peer) => peer.screen);
  const count = peers.length + 1;

  const tiles = (
    <>
      <Tile
        coreUserId={meCoreUserId}
        stream={cameraStream}
        mirrored
        muted={muted}
        cameraOn={cameraStream !== null}
        status={null}
        self
      />
      {peers.map((peer) => (
        <Tile
          key={peer.coreUserId}
          coreUserId={peer.coreUserId}
          stream={peer.camera}
          muted={peer.muted}
          cameraOn={peer.cameraOn}
          status={statusText(peer)}
        />
      ))}
    </>
  );

  if (presenter?.screen) {
    return (
      <div className="absolute inset-x-0 bottom-24 top-20 flex flex-col gap-3 px-4">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-neutral-900">
          <VideoView
            stream={presenter.screen}
            fit="contain"
            label="หน้าจอที่กำลังแชร์ในสาย"
          />
          <p className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs">
            <DisplayName coreUserId={presenter.coreUserId} /> กำลังแชร์หน้าจอ
          </p>
        </div>
        <div className="grid h-28 shrink-0 auto-cols-[10rem] grid-flow-col gap-3 overflow-x-auto">
          {tiles}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-24 top-20 grid auto-rows-fr gap-3 px-4',
        count <= 2 && 'grid-cols-1 sm:grid-cols-2',
        count > 2 && count <= 4 && 'grid-cols-2',
        count > 4 && 'grid-cols-2 sm:grid-cols-3',
      )}
    >
      {tiles}
    </div>
  );
}

function Tile({
  coreUserId,
  stream,
  mirrored = false,
  muted,
  cameraOn,
  status,
  self = false,
}: {
  coreUserId: string;
  stream: MediaStream | null;
  mirrored?: boolean;
  muted: boolean;
  cameraOn: boolean;
  status: string | null;
  self?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative min-h-0 overflow-hidden rounded-2xl bg-neutral-800',
        status && 'opacity-70',
      )}
    >
      {stream ? (
        <VideoView
          stream={stream}
          mirrored={mirrored}
          label={self ? 'ภาพจากกล้องของคุณ' : 'ภาพจากกล้อง'}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <CallAvatar coreUserId={coreUserId} size={72} />
        </div>
      )}

      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs">
        <span className="truncate">
          {self ? 'คุณ' : <DisplayName coreUserId={coreUserId} />}
        </span>
        {muted && (
          <>
            <MicOff aria-hidden className="size-3.5 shrink-0 text-destructive" />
            <span className="sr-only">ปิดไมค์อยู่</span>
          </>
        )}
        {!cameraOn && (
          <>
            <VideoOff aria-hidden className="size-3.5 shrink-0 text-white/70" />
            <span className="sr-only">ปิดกล้องอยู่</span>
          </>
        )}
      </span>

      {status && (
        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/90">
          {status}
        </span>
      )}
    </div>
  );
}
