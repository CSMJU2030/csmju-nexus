'use client';

import {
  Headphones,
  HeadphoneOff,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { CallAvatar, DisplayName, VideoView } from '@/components/csmju/call-ui';
import {
  useVoiceRoom,
  type VoiceRoomParticipant,
} from '@/components/csmju/voice-room-provider';
import { cn } from '@/lib/utils';

/// เวทีของห้องเสียง — แบบ Discord
///
///   ไม่มีใครแชร์จอ   ตารางช่องของทุกคน (กล้อง หรือรูปโปรไฟล์ · วงเขียวตอนพูด)
///   มีคนแชร์จอ      จอนั้นขึ้นกลางพร้อมป้าย "ถ่ายทอดสด" · ช่องของทุกคนเรียงข้างล่าง
///   แถบล่าง          ไมค์ · หูฟัง · กล้อง · แชร์จอ · ตัดการเชื่อมต่อ
///
/// อ่านทุกอย่างจาก useVoiceRoom() — เวทีถูกถอดได้ (เปลี่ยนหน้า) โดยเสียงไม่หลุด
export function VoiceRoomStage() {
  const voice = useVoiceRoom();

  if (voice.status === 'joining') {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <span className="flex items-center gap-2 text-sm">
          <Loader2 aria-hidden className="size-5 animate-spin" />
          กำลังเชื่อมต่อห้องเสียง…
        </span>
      </div>
    );
  }

  if (voice.status !== 'connected') return null;

  const live = voice.participants.find((row) => row.screen);
  const count = voice.participants.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950 text-white">
      {voice.error && (
        <button
          type="button"
          role="alert"
          onClick={voice.clearError}
          className="mx-auto mt-3 rounded-lg bg-destructive/90 px-3 py-1.5 text-sm text-white"
        >
          {voice.error}
        </button>
      )}

      {live?.screen ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <section
            aria-label="จอที่กำลังถ่ายทอดสด"
            className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black"
          >
            <VideoView
              stream={live.screen}
              fit="contain"
              label={live.isMe ? 'จอที่คุณกำลังถ่ายทอดสด' : 'จอที่กำลังถ่ายทอดสด'}
            />
            <span className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/70 px-2 py-1 text-xs">
              <LiveBadge />
              {live.isMe ? 'คุณกำลังถ่ายทอดสด' : <DisplayName coreUserId={live.coreUserId} />}
            </span>
          </section>
          <ul className="grid h-28 shrink-0 auto-cols-[11rem] grid-flow-col gap-3 overflow-x-auto">
            {voice.participants.map((row) => (
              <li key={row.coreUserId} className="h-full">
                <Tile participant={row} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul
          className={cn(
            'grid min-h-0 flex-1 auto-rows-fr content-center gap-3 overflow-y-auto p-3',
            count <= 1 && 'grid-cols-1 sm:px-[15%]',
            count === 2 && 'grid-cols-1 sm:grid-cols-2',
            count > 2 && count <= 4 && 'grid-cols-2',
            count > 4 && 'grid-cols-2 lg:grid-cols-3',
          )}
        >
          {voice.participants.map((row) => (
            <li key={row.coreUserId} className="min-h-0">
              <Tile participant={row} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex shrink-0 items-center justify-center gap-3 pb-5 pt-2">
        <StageButton
          label={voice.muted ? 'เปิดไมค์' : 'ปิดไมค์'}
          on={voice.muted}
          onClick={voice.toggleMute}
        >
          {voice.muted ? <MicOff aria-hidden className="size-5" /> : <Mic aria-hidden className="size-5" />}
        </StageButton>
        <StageButton
          label={voice.deafened ? 'เปิดหูฟัง' : 'ปิดหูฟัง'}
          on={voice.deafened}
          onClick={voice.toggleDeafen}
        >
          {voice.deafened ? (
            <HeadphoneOff aria-hidden className="size-5" />
          ) : (
            <Headphones aria-hidden className="size-5" />
          )}
        </StageButton>
        <StageButton
          label={voice.cameraOn ? 'ปิดกล้อง' : 'เปิดกล้อง'}
          on={!voice.cameraOn}
          onClick={() => void voice.toggleCamera()}
        >
          {voice.cameraOn ? <Video aria-hidden className="size-5" /> : <VideoOff aria-hidden className="size-5" />}
        </StageButton>
        <StageButton
          label={voice.sharing ? 'หยุดแชร์หน้าจอ' : 'แชร์หน้าจอ'}
          on={voice.sharing}
          pressed={voice.sharing}
          disabled={
            !voice.sharing &&
            voice.presenterCoreUserId !== null &&
            !voice.participants.some((row) => row.isMe && row.coreUserId === voice.presenterCoreUserId)
          }
          onClick={() => void (voice.sharing ? voice.stopShare() : voice.startShare())}
        >
          <MonitorUp aria-hidden className="size-5" />
        </StageButton>
        <button
          type="button"
          aria-label="ตัดการเชื่อมต่อ"
          title="ตัดการเชื่อมต่อ"
          onClick={() => void voice.leave()}
          className="grid size-12 place-items-center rounded-full bg-destructive text-white transition-colors hover:bg-destructive/90"
        >
          <PhoneOff aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}

function LiveBadge() {
  return (
    <span className="rounded bg-destructive px-1.5 text-[11px] font-bold leading-5 text-white">
      ถ่ายทอดสด
    </span>
  );
}

function StageButton({
  label,
  on,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /// พื้นขาว = ปิดอยู่/กำลังทำงาน (แบบเดียวกับหน้าจอโทร)
  on: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-12 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'bg-white text-black hover:bg-white/90' : 'bg-white/15 text-white hover:bg-white/25',
      )}
    >
      {children}
    </button>
  );
}

function Tile({ participant }: { participant: VoiceRoomParticipant }) {
  const { coreUserId, isMe } = participant;

  return (
    <div
      className={cn(
        'relative h-full min-h-28 overflow-hidden rounded-xl bg-neutral-800 ring-2 transition-shadow',
        participant.speaking ? 'ring-success' : 'ring-transparent',
        participant.connection === 'connecting' && !isMe && 'opacity-70',
      )}
    >
      {participant.camera ? (
        <VideoView
          stream={participant.camera}
          mirrored={isMe}
          label={isMe ? 'ภาพจากกล้องของคุณ' : 'ภาพจากกล้อง'}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <span
            className={cn(
              'rounded-full ring-4 transition-shadow',
              participant.speaking ? 'ring-success' : 'ring-transparent',
            )}
          >
            <CallAvatar coreUserId={coreUserId} size={72} />
          </span>
        </div>
      )}

      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs">
        <span className="truncate">{isMe ? 'คุณ' : <DisplayName coreUserId={coreUserId} />}</span>
        {participant.muted && (
          <>
            <MicOff aria-hidden className="size-3.5 shrink-0 text-destructive" />
            <span className="sr-only">ปิดไมค์อยู่</span>
          </>
        )}
        {participant.deafened && (
          <>
            <HeadphoneOff aria-hidden className="size-3.5 shrink-0 text-destructive" />
            <span className="sr-only">ปิดหูฟังอยู่</span>
          </>
        )}
      </span>

      {participant.sharing && (
        <span className="absolute right-2 top-2">
          <LiveBadge />
        </span>
      )}

      {!isMe && participant.connection !== 'connected' && (
        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white/80">
          {participant.connection === 'failed' ? 'ต่อไม่ติด' : 'กำลังเชื่อมต่อ…'}
        </span>
      )}
    </div>
  );
}
