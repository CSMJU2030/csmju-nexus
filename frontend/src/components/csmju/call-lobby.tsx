'use client';

import { createPortal } from 'react-dom';
import {
  Loader2,
  Mic,
  MicOff,
  Settings,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import {
  CallAvatar,
  MemberNames,
  RoundButton,
  VideoView,
} from '@/components/csmju/call-ui';

/// ห้องรอก่อนโทรออก — แบบ Instagram
///
/// ให้ผู้ใช้เห็นหน้าตัวเองและเลือกอุปกรณ์ก่อนที่อีกฝ่ายจะได้ยินเสียงกริ่ง
/// สายวิดีโอเปิดกล้องไว้ให้ก่อน สายเสียงปิดไว้ — กดสลับได้ก่อนเริ่ม
///
/// **ยังไม่เข้าห้องเสียงจนกว่าจะกด "เริ่มการโทร"** ปิดห้องรอไปเฉย ๆ จึงไม่มี
/// เสียงกริ่งหลุดไปถึงใคร และไม่มีที่นั่งค้าง

export function CallLobby({
  members,
  cameraStream,
  cameraBusy,
  muted,
  deafened,
  starting,
  trapFocus,
  onToggleCamera,
  onToggleMic,
  onToggleSpeaker,
  onSettings,
  onStart,
  onClose,
  children,
}: {
  members: readonly string[];
  cameraStream: MediaStream | null;
  cameraBusy: boolean;
  muted: boolean;
  deafened: boolean;
  starting: boolean;
  trapFocus: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onSettings: () => void;
  onStart: () => void;
  onClose: () => void;
  /// แจ้งเตือนอุปกรณ์ · ข้อความผิดพลาด
  children?: ReactNode;
}) {
  const rootRef = useModalFocus<HTMLDivElement>(trapFocus, onClose);
  const [first] = members;
  const group = members.length > 1;

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="เตรียมโทร"
      className="fixed inset-0 z-95 overflow-y-auto bg-neutral-950 text-white outline-none animate-in fade-in-0 zoom-in-95"
    >
      <button
        type="button"
        aria-label="ปิด"
        onClick={onClose}
        className="absolute left-4 top-4 z-10 grid size-10 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X aria-hidden className="size-6" />
      </button>

      {children}

      <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-16 lg:flex-row lg:gap-10">
        {/* ภาพของเรา */}
        <div className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-2xl bg-neutral-800">
          {cameraStream ? (
            <VideoView stream={cameraStream} mirrored label="ภาพจากกล้องของคุณ" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
              {cameraBusy ? (
                <Loader2 aria-hidden className="size-8 animate-spin" />
              ) : (
                <VideoOff aria-hidden className="size-8" />
              )}
              <span className="text-sm">ปิดกล้องอยู่</span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <RoundButton
              label={cameraStream ? 'ปิดกล้อง' : 'เปิดกล้อง'}
              tone={cameraStream ? 'plain' : 'on'}
              disabled={cameraBusy}
              onClick={onToggleCamera}
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
              onClick={onToggleMic}
            >
              {muted ? (
                <MicOff aria-hidden className="size-5" />
              ) : (
                <Mic aria-hidden className="size-5" />
              )}
            </RoundButton>
            <RoundButton
              label={deafened ? 'เปิดลำโพง' : 'ปิดลำโพง'}
              tone={deafened ? 'on' : 'plain'}
              onClick={onToggleSpeaker}
            >
              {deafened ? (
                <VolumeX aria-hidden className="size-5" />
              ) : (
                <Volume2 aria-hidden className="size-5" />
              )}
            </RoundButton>
            <RoundButton label="การตั้งค่า" onClick={onSettings}>
              <Settings aria-hidden className="size-5" />
            </RoundButton>
          </div>
        </div>

        {/* คนที่จะโทรหา */}
        <div className="flex w-full max-w-sm flex-col items-center text-center">
          {first && (
            <span className="relative mb-4 inline-flex">
              <CallAvatar coreUserId={first} size={group ? 80 : 96} />
              {members[1] && (
                <CallAvatar
                  coreUserId={members[1]}
                  size={56}
                  className="absolute -bottom-2 -right-6 ring-4 ring-neutral-950"
                />
              )}
            </span>
          )}
          <p className="line-clamp-2 text-xl font-semibold">
            <MemberNames members={members} />
          </p>
          <p className="mt-1 text-sm text-white/70">พร้อมที่จะโทรแล้วใช่ไหม</p>
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {starting && <Loader2 aria-hidden className="size-4 animate-spin" />}
            เริ่มการโทร
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
