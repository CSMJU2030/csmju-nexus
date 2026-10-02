'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Headphones,
  HeadphoneOff,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Signal,
  Video,
  VideoOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useVoiceRoom } from '@/components/csmju/voice-room-provider';
import { cn } from '@/lib/utils';

/// แผง "เชื่อมต่อเสียงแล้ว" มุมซ้ายล่าง — แบบ Discord
///
/// อยู่เหนือการ์ดผู้ใช้ในหน้าห้อง (/chat) และลอยมุมซ้ายล่างในหน้าอื่น ๆ
/// ผู้ใช้จึงรู้เสมอว่ายังต่อเสียงค้างอยู่ห้องไหน และวางสายได้จากทุกหน้า
///
/// มีเฉพาะปุ่มที่ทำงานจริง (กล้อง · แชร์จอ · ตัดการเชื่อมต่อ) — ปุ่มกิจกรรม
/// และซาวด์บอร์ดของ Discord ไม่มีเพราะระบบนี้ยังไม่มีของรองรับ

function PanelButton({
  label,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={danger ? undefined : active}
      onClick={onClick}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md transition-colors',
        danger
          ? 'text-muted-foreground hover:bg-destructive/15 hover:text-destructive'
          : active
            ? 'bg-success/15 text-success hover:bg-success/25'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/// สถานะการต่อ + ชื่อห้อง + ปุ่มกล้อง/แชร์จอ/ตัดการเชื่อมต่อ
export function VoiceConnectionPanel({ className }: { className?: string }) {
  const voice = useVoiceRoom();

  if (voice.status === 'idle') return null;

  const joining = voice.status === 'joining';
  const name = voice.channel?.name ?? 'ห้องเสียง';

  return (
    <section
      aria-label="การเชื่อมต่อเสียง"
      className={cn('border-t border-border bg-muted/50 px-2 py-2', className)}
    >
      <div className="flex items-center gap-1">
        <Link
          href={voice.channelId ? `/chat?channel=${encodeURIComponent(voice.channelId)}` : '/chat'}
          className="min-w-0 flex-1 rounded-md px-1 py-0.5 hover:bg-accent"
        >
          <span
            className={cn(
              'flex items-center gap-1.5 text-sm font-semibold',
              joining ? 'text-warning' : 'text-success',
            )}
          >
            {joining ? (
              <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
            ) : (
              <Signal aria-hidden className="size-4 shrink-0" />
            )}
            {joining ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อเสียงแล้ว'}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{name}</span>
        </Link>

        <PanelButton label="ตัดการเชื่อมต่อ" danger onClick={() => void voice.leave()}>
          <PhoneOff aria-hidden className="size-[18px]" />
        </PanelButton>
      </div>

      {!joining && (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            aria-pressed={voice.cameraOn}
            onClick={() => void voice.toggleCamera()}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
              voice.cameraOn
                ? 'bg-success/15 text-success hover:bg-success/25'
                : 'bg-background hover:bg-accent',
            )}
          >
            {voice.cameraOn ? (
              <Video aria-hidden className="size-4" />
            ) : (
              <VideoOff aria-hidden className="size-4" />
            )}
            {voice.cameraOn ? 'ปิดกล้อง' : 'กล้อง'}
          </button>
          <button
            type="button"
            aria-pressed={voice.sharing}
            onClick={() => void (voice.sharing ? voice.stopShare() : voice.startShare())}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
              voice.sharing
                ? 'bg-success/15 text-success hover:bg-success/25'
                : 'bg-background hover:bg-accent',
            )}
          >
            <MonitorUp aria-hidden className="size-4" />
            {voice.sharing ? 'หยุดแชร์' : 'แชร์จอ'}
          </button>
        </div>
      )}

      {voice.error && (
        <button
          type="button"
          role="alert"
          onClick={voice.clearError}
          className="mt-1.5 block w-full rounded-md bg-destructive/10 px-2 py-1 text-left text-xs text-destructive"
        >
          {voice.error}
        </button>
      )}
    </section>
  );
}

/// ปุ่มไมค์/หูฟังสำหรับการ์ดผู้ใช้ (`SidebarUserCard controls`)
///
/// วาดเฉพาะตอนต่อเสียงอยู่ — นอกห้องเสียงกดแล้วไม่มีอะไรเกิดขึ้น
export function VoiceUserControls() {
  const voice = useVoiceRoom();

  if (voice.status !== 'connected') return null;

  return (
    <>
      <PanelButton
        label={voice.muted ? 'เปิดไมค์' : 'ปิดไมค์'}
        active={false}
        onClick={voice.toggleMute}
      >
        {voice.muted ? (
          <MicOff aria-hidden className="size-[18px] text-destructive" />
        ) : (
          <Mic aria-hidden className="size-[18px]" />
        )}
      </PanelButton>
      <PanelButton
        label={voice.deafened ? 'เปิดหูฟัง' : 'ปิดหูฟัง'}
        active={false}
        onClick={voice.toggleDeafen}
      >
        {voice.deafened ? (
          <HeadphoneOff aria-hidden className="size-[18px] text-destructive" />
        ) : (
          <Headphones aria-hidden className="size-[18px]" />
        )}
      </PanelButton>
    </>
  );
}

/// แผงลอยมุมซ้ายล่างสำหรับหน้าอื่นที่ไม่ใช่ /chat (ที่นั่นอยู่ในแถบช่องแล้ว)
export function VoiceRoomDock() {
  const voice = useVoiceRoom();
  const pathname = usePathname();

  if (voice.status === 'idle' || pathname.startsWith('/chat')) return null;

  return (
    <div className="fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] left-3 z-30 w-[min(16rem,calc(100vw-6.5rem))] overflow-hidden rounded-xl border border-border bg-card shadow-csmju-lg animate-in fade-in-0 zoom-in-95 lg:bottom-4 lg:left-[5.25rem]">
      <VoiceConnectionPanel className="border-t-0 bg-transparent" />
      {voice.status === 'connected' && (
        <div className="flex items-center justify-end gap-0.5 border-t border-border px-2 py-1">
          <VoiceUserControls />
        </div>
      )}
    </div>
  );
}
