'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, Volume2 } from 'lucide-react';
import type { VoiceOccupant } from '@/components/csmju/channel-types';
import { UserAvatar } from '@/components/csmju/user-badge';
import { useProfile } from '@/components/csmju/user-name';
import type { Channel } from '@/lib/csmju/types';

/// ปุ่ม/สถานะเสียงที่หน้านี้ต้องใช้ — มาจาก useVoiceRoom() ของผู้ให้บริการเสียง
export interface VoiceControls {
  connectedChannelId: string | null;
  joining: boolean;
  join: (channelId: string) => void;
  /// เวทีระหว่างต่ออยู่ (ช่องผู้เข้าร่วม · จอที่แชร์ · แถบควบคุม)
  stage: ReactNode;
}

/// หน้าช่องเสียงแบบ Discord
///
///   ไม่มีใคร   พื้นไล่สี · "ทั่วไป · ไม่มีคนอยู่ในช่องสำหรับแชทด้วยเสียงในขณะนี้" · [เข้าร่วมการใช้เสียง]
///   มีคน       รูปของคนในห้อง · [เข้าร่วมการใช้เสียง]
///   ต่ออยู่     เวทีของผู้ให้บริการเสียง
export function VoiceChannelView({
  channel,
  occupants,
  voice,
  hiddenOnMobile,
  onBack,
}: {
  channel: Channel;
  occupants: VoiceOccupant[];
  /// null = ยังไม่มีผู้ให้บริการเสียงแบบต่อค้าง → ใช้หน้าห้องเสียงเดิมแทน
  voice: VoiceControls | null;
  hiddenOnMobile: boolean;
  onBack: () => void;
}) {
  const name = channel.name ?? 'ห้องเสียง';
  const connected = voice?.connectedChannelId === channel.id;

  return (
    <section
      aria-label={`ช่องเสียง ${name}`}
      className={`relative flex min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-primary/25 via-background to-success/15 ${
        hiddenOnMobile ? 'max-md:hidden' : ''
      }`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          aria-label="กลับไปที่รายการห้อง"
        >
          <ChevronLeft className="size-5" />
        </button>
        <Volume2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="truncate text-[15px] font-semibold">{name}</h2>
        {channel.description && (
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground max-md:hidden">
            {channel.description}
          </p>
        )}
      </header>

      {connected && voice ? (
        <div className="min-h-0 flex-1">{voice.stage}</div>
      ) : (
        <div className="grid flex-1 place-items-center px-6 pb-16 text-center">
          <div className="flex max-w-md flex-col items-center">
            {occupants.length === 0 ? (
              <span className="mb-5 grid size-20 place-items-center rounded-full bg-background/70 shadow-csmju-sm">
                <Volume2 className="size-10 text-muted-foreground" aria-hidden />
              </span>
            ) : (
              <ul className="mb-5 flex flex-wrap justify-center gap-3" aria-label="คนในห้องเสียง">
                {occupants.slice(0, 8).map((occupant) => (
                  <li key={occupant.coreUserId}>
                    <Occupant coreUserId={occupant.coreUserId} sharing={occupant.sharing} />
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-2xl font-bold">{name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {occupants.length === 0
                ? 'ไม่มีคนอยู่ในช่องสำหรับแชทด้วยเสียงในขณะนี้'
                : `${occupants.length} คนอยู่ในช่องนี้ตอนนี้`}
            </p>

            {voice ? (
              <button
                type="button"
                disabled={voice.joining}
                onClick={() => voice.join(channel.id)}
                className="mt-6 flex items-center gap-2 rounded-full bg-success px-6 py-2.5 text-sm font-semibold text-white shadow-csmju-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {voice.joining && <Loader2 className="size-4 animate-spin" />}
                {voice.connectedChannelId ? 'ย้ายมาช่องนี้' : 'เข้าร่วมการใช้เสียง'}
              </button>
            ) : (
              <Link
                href={`/voice?channel=${channel.id}`}
                className="mt-6 rounded-full bg-success px-6 py-2.5 text-sm font-semibold text-white shadow-csmju-sm transition-opacity hover:opacity-90"
              >
                เข้าร่วมการใช้เสียง
              </Link>
            )}

            <p className="mt-3 text-xs text-muted-foreground">รับได้สูงสุด {channel.maxSeats} คน</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Occupant({ coreUserId, sharing }: { coreUserId: string; sharing: boolean }) {
  const profile = useProfile(coreUserId);

  return (
    <span className="flex flex-col items-center gap-1">
      <UserAvatar
        coreUserId={coreUserId}
        displayName={profile.displayName}
        avatarUrl={profile.avatarUrl}
        size={56}
        showOnline={false}
      />
      <span className="max-w-20 truncate text-xs font-medium">{profile.displayName}</span>
      {sharing && (
        <span className="rounded bg-destructive px-1 text-[10px] font-bold leading-4 text-white">ถ่ายทอดสด</span>
      )}
    </span>
  );
}
