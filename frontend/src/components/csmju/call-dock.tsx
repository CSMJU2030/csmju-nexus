'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Mic, MicOff, PhoneOff, PictureInPicture2, Video, VideoOff } from 'lucide-react';
import { CallAvatar, CallTitle, RoundButton, VideoView } from '@/components/csmju/call-ui';
import type { PeerView } from '@/components/csmju/call-screen';

/// กล่องสายแบบลอย — ย่อจากหน้าจอโทรเต็มจอ แล้วใช้เว็บต่อได้ (แชทไปคุยไป · เปลี่ยนหน้าได้ สายไม่หลุด)
///
///   - ลากย้ายไปวางตรงไหนก็ได้ · ลากมุมขวาล่างเพื่อปรับขนาด · ระบบจำตำแหน่งและขนาดไว้
///   - ภาพลอยนอกเบราว์เซอร์ (Picture-in-Picture) — สลับแท็บ/สลับแอปแล้วยังเห็นภาพอีกฝ่าย
///   - ไม่กักโฟกัส ไม่บังหน้าเว็บ (ไม่ใช่ dialog แบบ modal)
///
/// เสียงของสายเล่นที่ CallProvider (RemoteAudio) ไม่ใช่ที่นี่ — ย่อ/ขยายกี่ครั้งเสียงก็ไม่สะดุด

const STORAGE_KEY = 'csmju:call-dock';
const MIN_WIDTH = 180;
const MAX_WIDTH = 640;
const MARGIN = 8;

interface DockBox {
  x: number;
  y: number;
  width: number;
}

/// วางกล่องให้อยู่ในจอเสมอ (หมุนจอ · ย่อหน้าต่าง · ตำแหน่งที่จำไว้จากจอที่ใหญ่กว่า)
export function clampDock(box: DockBox, height: number, viewport: { width: number; height: number }): DockBox {
  const width = Math.min(Math.max(MIN_WIDTH, box.width), Math.min(MAX_WIDTH, viewport.width - MARGIN * 2));

  return {
    width,
    x: Math.min(Math.max(MARGIN, box.x), Math.max(MARGIN, viewport.width - width - MARGIN)),
    y: Math.min(Math.max(MARGIN, box.y), Math.max(MARGIN, viewport.height - height - MARGIN)),
  };
}

function initialBox(): DockBox {
  if (typeof window === 'undefined') return { x: MARGIN, y: MARGIN, width: 280 };

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as DockBox | null;

    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.width)) return saved;
  } catch {
    // โหมดส่วนตัวบล็อก storage — ใช้ตำแหน่งตั้งต้น
  }

  const width = Math.min(280, window.innerWidth - MARGIN * 4);

  // มุมขวาล่าง เหนือแถบเมนูล่างของมือถือ
  return { width, x: window.innerWidth - width - 16, y: window.innerHeight - width * 0.5625 - 150 };
}

export function CallDock({
  members,
  group,
  phase,
  peers,
  muted,
  cameraStream,
  cameraBusy,
  onToggleMute,
  onToggleCamera,
  onHangUp,
  onRestore,
}: {
  meCoreUserId: string;
  members: readonly string[];
  group: boolean;
  phase: 'calling' | 'in-call';
  peers: readonly PeerView[];
  muted: boolean;
  cameraStream: MediaStream | null;
  cameraBusy: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onHangUp: () => void;
  onRestore: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<DockBox>(initialBox);
  const gesture = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: DockBox } | null>(null);
  const [pip, setPip] = useState(false);

  const joined = peers.filter((peer) => peer.status === 'joined');
  // ภาพหลักของกล่อง: จอที่แชร์ > กล้องของคนในสาย (สายกลุ่มเอาคนแรกที่เปิดกล้อง)
  const showing = joined.find((peer) => peer.screen) ?? joined.find((peer) => peer.camera) ?? joined[0] ?? peers[0];
  const stream = showing?.screen ?? showing?.camera ?? null;
  const [first] = members;
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled === true;

  // จับกล่องให้อยู่ในจอเมื่อหมุนจอ/ย่อหน้าต่าง
  useEffect(() => {
    const fit = () =>
      setBox((current) =>
        clampDock(current, ref.current?.offsetHeight ?? 0, { width: window.innerWidth, height: window.innerHeight }),
      );

    fit();
    window.addEventListener('resize', fit);

    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(box));
    } catch {
      // จำไม่ได้ก็ไม่เป็นไร
    }
  }, [box]);

  // ออกจากภาพลอยแล้ว (ผู้ใช้กดปิดที่หน้าต่างลอยเอง) ปุ่มต้องกลับสถานะเดิม
  useEffect(() => {
    const video = ref.current?.querySelector('video');

    if (!video) return;

    const enter = () => setPip(true);
    const leave = () => setPip(false);

    video.addEventListener('enterpictureinpicture', enter);
    video.addEventListener('leavepictureinpicture', leave);

    return () => {
      video.removeEventListener('enterpictureinpicture', enter);
      video.removeEventListener('leavepictureinpicture', leave);
    };
  }, [stream]);

  // วางสาย/ขยายกลับ = ปิดภาพลอยที่เปิดค้างไว้
  useEffect(
    () => () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    },
    [],
  );

  const begin = (mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => {
    // กดปุ่มในกล่อง = กดปุ่ม ไม่ใช่เริ่มลาก
    if (mode === 'move' && (event.target as HTMLElement).closest('button')) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, start: box };
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;

    if (!current) return;

    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const next =
      current.mode === 'move'
        ? { ...current.start, x: current.start.x + dx, y: current.start.y + dy }
        : { ...current.start, width: current.start.width + dx };

    setBox(clampDock(next, ref.current?.offsetHeight ?? 0, { width: window.innerWidth, height: window.innerHeight }));
  };

  const end = () => {
    gesture.current = null;
  };

  const togglePip = async () => {
    const video = ref.current?.querySelector('video');

    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video) await video.requestPictureInPicture();
    } catch {
      // เบราว์เซอร์ปฏิเสธ (เช่นวิดีโอยังไม่มีภาพ) — กล่องยังใช้ได้ตามเดิม
    }
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label="สายที่กำลังคุย (ลากย้ายได้)"
      onPointerDown={(event) => begin('move', event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ left: box.x, top: box.y, width: box.width }}
      className="fixed z-95 cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-csmju-lg ring-1 ring-white/10 animate-in fade-in-0 zoom-in-95 active:cursor-grabbing"
    >
      <div className="relative aspect-video">
        {stream ? (
          <VideoView stream={stream} fit={showing?.screen ? 'contain' : 'cover'} label="ภาพในสาย" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-3 text-center">
            {first && <CallAvatar coreUserId={showing?.coreUserId ?? first} size={Math.round(box.width / 5)} />}
            <span className="max-w-full truncate text-sm font-semibold">
              <CallTitle members={members} />
            </span>
          </div>
        )}

        {cameraStream && (
          <div className="absolute bottom-2 right-2 aspect-video w-1/4 overflow-hidden rounded-lg ring-1 ring-white/20">
            <VideoView stream={cameraStream} mirrored label="ภาพจากกล้องของคุณ" />
          </div>
        )}

        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs">
          {phase === 'calling' ? 'กำลังโทร…' : group ? `${joined.length + 1} คนในสาย` : 'อยู่ในสาย'}
        </span>
      </div>

      <div className="flex items-center justify-center gap-2 px-2 py-2">
        <RoundButton label={muted ? 'เปิดไมค์' : 'ปิดไมค์'} size="sm" tone={muted ? 'on' : 'plain'} pressed={muted} onClick={onToggleMute}>
          {muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
        </RoundButton>
        <RoundButton
          label={cameraStream ? 'ปิดกล้อง' : 'เปิดกล้อง'}
          size="sm"
          tone={cameraStream ? 'plain' : 'on'}
          disabled={cameraBusy}
          onClick={onToggleCamera}
        >
          {cameraStream ? <Video aria-hidden className="size-4" /> : <VideoOff aria-hidden className="size-4" />}
        </RoundButton>
        {pipSupported && stream && (
          <RoundButton
            label={pip ? 'ปิดภาพลอยนอกเบราว์เซอร์' : 'ภาพลอยนอกเบราว์เซอร์ (สลับแท็บ/แอปแล้วยังเห็นสาย)'}
            size="sm"
            pressed={pip}
            onClick={() => void togglePip()}
          >
            <PictureInPicture2 aria-hidden className="size-4" />
          </RoundButton>
        )}
        <RoundButton label="ขยายเต็มจอ" size="sm" onClick={onRestore}>
          <Maximize2 aria-hidden className="size-4" />
        </RoundButton>
        <RoundButton label="วางสาย" size="sm" tone="danger" onClick={onHangUp}>
          <PhoneOff aria-hidden className="size-4" />
        </RoundButton>
      </div>

      {/* ลากมุมนี้เพื่อปรับขนาด */}
      <span
        aria-hidden
        onPointerDown={(event) => {
          event.stopPropagation();
          begin('resize', event);
        }}
        onPointerMove={move}
        onPointerUp={end}
        className="absolute bottom-0 right-0 size-5 cursor-nwse-resize"
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgb(255 255 255 / 0.35) 50%)' }}
      />
    </div>
  );
}
