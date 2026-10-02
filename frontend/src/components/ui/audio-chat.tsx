'use client';

import * as React from 'react';
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/// คนหนึ่งคนในสาย
export interface VoiceParticipant {
  coreUserId: string;
  displayName?: string;
  /// เสียงของเขา — ใช้วัดระดับเพื่อรู้ว่ากำลังพูดอยู่ไหม
  stream?: MediaStream | null;
  isMe?: boolean;
  isMuted?: boolean;
  isPresenting?: boolean;
  /// สถานะการต่อสาย P2P
  connection?: 'connecting' | 'connected' | 'failed';
}

interface VoiceChatProps {
  participants?: VoiceParticipant[];
  /// สตรีมไมค์ของเราเอง — วัดระดับเพื่อให้เห็นว่าไมค์ทำงานจริง
  localStream?: MediaStream | null;
  muted?: boolean;
  presenting?: boolean;
  /// เปิดกล้องอยู่ไหม — ไม่ส่ง `onToggleCamera` มาด้วยจะไม่มีปุ่มกล้องเลย
  /// (ห้องเสียงแบบหลายคนยังไม่เปิดกล้อง เพราะ mesh จะกินแบนด์วิดท์เกินไป)
  cameraOn?: boolean;
  deafened?: boolean;
  /// วินาทีที่อยู่ในสาย — ถ้าไม่ส่งมาจะนับเองตั้งแต่ mount
  startedAt?: string;
  turnAvailable?: boolean;
  onToggleMute?: () => void;
  onToggleDeafen?: () => void;
  onToggleScreen?: () => void;
  onToggleCamera?: () => void;
  onLeave?: () => void;
  className?: string;
}

/// หน้าจอ "อยู่ในสาย" ของห้องเสียง
///
/// จุดที่ต่างจาก UI โทรทั่วไป: **ตัวชี้ว่าใครกำลังพูดวัดจากระดับเสียงจริง**
/// ด้วย Web Audio API ไม่ใช่ให้เซิร์ฟเวอร์บอก
///
/// ทำแบบนี้เพราะเสียงวิ่ง P2P — เซิร์ฟเวอร์ไม่เคยเห็นเสียงเลย จึงบอกไม่ได้
/// ว่าใครพูด ถ้าจะให้บอกต้องส่งระดับเสียงขึ้นไปทุก 100ms ซึ่งเปลืองทั้ง
/// แบนด์วิดท์และโควตาฟรีเทียร์ การวัดที่เบราว์เซอร์ของแต่ละคนได้ผลเดียวกัน
/// โดยไม่มีค่าใช้จ่าย
export function VoiceChat({
  participants = [],
  localStream = null,
  muted = false,
  presenting = false,
  cameraOn = false,
  deafened = false,
  startedAt,
  turnAvailable = true,
  onToggleMute,
  onToggleDeafen,
  onToggleScreen,
  onToggleCamera,
  onLeave,
  className,
}: VoiceChatProps) {
  const elapsed = useElapsed(startedAt);

  return (
    <div
      className={cn(
        'flex w-full max-w-md flex-col gap-4 csmju-surface p-5 shadow-sm',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" />
            อยู่ในสาย
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(elapsed)} · {participants.length} คน
          </p>
        </div>

        {!turnAvailable && (
          <p className="max-w-[55%] text-right text-[11px] leading-tight text-warning">
            ยังไม่มี TURN — คนที่อยู่หลัง NAT แบบเจาะไม่ได้จะไม่ได้ยินเสียง
          </p>
        )}
      </header>

      <ul className="space-y-1.5">
        {participants.map((participant) => (
          <ParticipantRow
            key={participant.coreUserId}
            participant={participant}
            localStream={participant.isMe ? localStream : null}
            selfMuted={participant.isMe ? muted : false}
          />
        ))}

        {participants.length === 0 && (
          <li className="rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
            ยังไม่มีใครอยู่ในสาย
          </li>
        )}
      </ul>

      <div className="flex items-center justify-center gap-2">
        <ControlButton
          active={muted}
          onClick={onToggleMute}
          label={muted ? 'เปิดไมค์' : 'ปิดไมค์'}
          danger={muted}
        >
          {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </ControlButton>

        <ControlButton
          active={deafened}
          onClick={onToggleDeafen}
          label={deafened ? 'เปิดเสียง' : 'ปิดเสียงทั้งหมด'}
          danger={deafened}
        >
          {deafened ? (
            <VolumeX className="size-5" />
          ) : (
            <Volume2 className="size-5" />
          )}
        </ControlButton>

        {onToggleCamera && (
          <ControlButton
            active={cameraOn}
            onClick={onToggleCamera}
            // ปิดตอนแชร์จออยู่ — สายหนึ่งเส้นส่งภาพได้ทางเดียว ถ้าเปิดทั้งคู่
            // ปลายทางจะแยกไม่ออกว่าภาพไหนคือจอ ภาพไหนคือกล้อง
            disabled={presenting}
            label={
              presenting
                ? 'ปิดแชร์หน้าจอก่อนถึงจะเปิดกล้องได้'
                : cameraOn
                  ? 'ปิดกล้อง'
                  : 'เปิดกล้อง'
            }
          >
            {cameraOn ? (
              <VideoOff className="size-5" />
            ) : (
              <Video className="size-5" />
            )}
          </ControlButton>
        )}

        <ControlButton
          active={presenting}
          onClick={onToggleScreen}
          disabled={cameraOn}
          label={
            cameraOn
              ? 'ปิดกล้องก่อนถึงจะแชร์หน้าจอได้'
              : presenting
                ? 'หยุดแชร์หน้าจอ'
                : 'แชร์หน้าจอ'
          }
        >
          {presenting ? (
            <MonitorX className="size-5" />
          ) : (
            <MonitorUp className="size-5" />
          )}
        </ControlButton>

        <button
          type="button"
          onClick={onLeave}
          className="grid size-11 place-items-center rounded-full bg-destructive text-white transition-transform hover:scale-105"
          aria-label="วางสาย"
        >
          <PhoneOff className="size-5" />
        </button>
      </div>
    </div>
  );
}

function ParticipantRow({
  participant,
  localStream,
  selfMuted,
}: {
  participant: VoiceParticipant;
  localStream: MediaStream | null;
  selfMuted: boolean;
}) {
  const stream = participant.isMe ? localStream : participant.stream ?? null;
  const level = useAudioLevel(stream);
  const speaking = level > 0.06 && !(participant.isMe && selfMuted);
  const name = participant.displayName ?? participant.coreUserId;

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
        speaking ? 'bg-secondary' : 'bg-muted/50',
      )}
    >
      <span className="relative shrink-0">
        <span
          className={cn(
            'grid size-10 place-items-center rounded-full font-semibold transition-shadow',
            speaking
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-muted-foreground',
          )}
          style={
            speaking
              ? // วงแหวนขยายตามระดับเสียงจริง ไม่ใช่กระพริบตามจังหวะคงที่
                { boxShadow: `0 0 0 ${2 + level * 8}px color-mix(in oklab, var(--primary) 25%, transparent)` }
              : undefined
          }
        >
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {name}
          {participant.isMe && (
            <span className="ml-1 text-xs text-muted-foreground">(คุณ)</span>
          )}
        </span>

        <span className="block text-[11px] text-muted-foreground">
          {participant.isMe && selfMuted
            ? 'ปิดไมค์'
            : participant.connection === 'failed'
              ? 'ต่อสายไม่ติด'
              : participant.connection === 'connecting'
                ? 'กำลังต่อสาย…'
                : speaking
                  ? 'กำลังพูด'
                  : stream
                    ? 'เชื่อมต่อแล้ว'
                    : 'รอสัญญาณ'}
        </span>
      </span>

      {participant.isPresenting && (
        <MonitorUp
          className="size-4 shrink-0 text-primary"
          aria-label="กำลังแชร์หน้าจอ"
        />
      )}

      {/* แถบระดับเสียง — บอกได้ทันทีว่าไมค์ทำงานหรือไม่ ก่อนจะโทษเน็ต */}
      <span className="flex h-6 shrink-0 items-end gap-0.5" aria-hidden>
        {[0.2, 0.45, 0.7].map((threshold) => (
          <span
            key={threshold}
            className={cn(
              'w-1 rounded-full transition-all',
              level > threshold ? 'bg-primary' : 'bg-border',
            )}
            style={{ height: level > threshold ? '100%' : '30%' }}
          />
        ))}
      </span>
    </li>
  );
}

function ControlButton({
  children,
  active,
  danger,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'grid size-11 place-items-center rounded-full border transition-colors disabled:opacity-40',
        danger
          ? 'border-destructive bg-destructive/10 text-destructive'
          : active
            ? 'border-primary bg-secondary text-secondary-foreground'
            : 'border-border hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/// วัดระดับเสียงของสตรีมด้วย Web Audio API
///
/// คืนค่า 0–1 ที่ปรับให้ลื่นแล้ว ใช้ rAF ไม่ใช่ setInterval เพื่อให้หยุดเอง
/// เมื่อแท็บอยู่พื้นหลัง (ไม่งั้นเสียแบตเปล่า ๆ กับ UI ที่ไม่มีใครเห็น)
///
/// ปิด AudioContext ตอน unmount — เบราว์เซอร์จำกัดจำนวน context ต่อหน้า
/// ถ้าไม่ปิด การเข้าออกห้องหลายรอบจะทำให้สร้างใหม่ไม่ได้และแถบเสียงตายเงียบ
function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = React.useState(0);

  React.useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      return;
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    // 512 ให้ความละเอียดพอสำหรับวัดความดัง โดยไม่กินซีพียูเท่าค่าที่ใหญ่กว่า
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let smoothed = 0;

    const tick = () => {
      analyser.getByteFrequencyData(buffer);

      // ค่าเฉลี่ยของสเปกตรัม แล้วปรับให้ลื่นด้วย exponential smoothing
      // ไม่งั้นแถบจะกระตุกทุกเฟรมและอ่านไม่ได้ว่าใครพูด
      let sum = 0;

      for (const value of buffer) {
        sum += value;
      }

      const raw = sum / buffer.length / 255;

      smoothed = smoothed * 0.75 + raw * 0.25;
      setLevel(smoothed);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [stream]);

  // ไม่มีสตรีม = ระดับเสียงเป็นศูนย์เสมอ คำนวณตรงนี้แทนการ setLevel(0)
  // ในเอฟเฟกต์ — ค่าที่หาได้จากค่าอื่นไม่ควรเก็บเป็น state ซ้อนอีกชั้น
  // และการ setState ในเอฟเฟกต์ทำให้วาดสองรอบโดยไม่จำเป็น
  if (!stream || stream.getAudioTracks().length === 0) {
    return 0;
  }

  return level;
}

/// นับเวลาในสาย — ใช้เวลาเซิร์ฟเวอร์ถ้ามี ไม่งั้นนับตั้งแต่ mount
function useElapsed(startedAt?: string): number {
  /// เวลาเริ่มสำรองต้องจับครั้งเดียวตอน mount
  ///
  /// เดิมเรียก Date.now() ใน useMemo ซึ่งทำงานระหว่าง render — ค่าจึงขยับ
  /// ทุกครั้งที่ React วาดใหม่ด้วยเหตุอื่น แล้วตัวนับเวลาในสายจะกระโดดถอยหลัง
  /// ตัวเริ่มต้นแบบ lazy ของ useState เป็นที่ที่ถูกต้องสำหรับค่าแบบนี้
  const [fallbackStart] = React.useState(() => Date.now());

  const start = React.useMemo(
    () => (startedAt ? new Date(startedAt).getTime() : fallbackStart),
    [startedAt, fallbackStart],
  );
  const [seconds, setSeconds] = React.useState(() =>
    Math.max(0, Math.floor((Date.now() - start) / 1000)),
  );

  React.useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 1000);

    return () => clearInterval(timer);
  }, [start]);

  return seconds;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}
