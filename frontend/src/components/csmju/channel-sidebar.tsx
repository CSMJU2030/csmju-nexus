'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  Hash,
  Settings,
  UserPlus,
  Video,
  Volume2,
  MicOff,
  HeadphoneOff,
} from 'lucide-react';
import { RoomPopover } from '@/components/csmju/room-popover';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { UserAvatar } from '@/components/csmju/user-badge';
import { showToast } from '@/components/csmju/messages-toast';
import type { VoiceOccupant } from '@/components/csmju/channel-types';
import { elapsedLabel, type ChannelCategory } from '@/app/(app)/chat/chat-logic';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel } from '@/lib/csmju/types';

export interface VoiceChannelState {
  occupants: VoiceOccupant[];
  /// เวลาที่ห้องเสียงรอบนี้เริ่ม — null ถ้าไม่มีใครอยู่หรือยังไม่รู้
  startedAt: string | null;
}

/// แถบซ้ายแบบ Discord: หมวด "ช่องข้อความ" · "วิชา …" · "ช่องสำหรับพูด"
///
/// ห้องเสียงแสดงคนที่อยู่ข้างในใต้ชื่อห้อง (รูป + ชื่อ + ป้าย "ถ่ายทอดสด" ถ้าแชร์จอ)
/// พร้อมเวลาที่ห้องเปิดมาแล้ว — ข้อมูลมาจาก `voiceOccupants` และ socket `voice:occupants`
export function ChannelSidebar({
  categories,
  activeId,
  onSelect,
  voice,
  connectedChannelId,
  header,
  notice,
  footer,
  loading,
  error,
}: {
  categories: ChannelCategory[];
  activeId: string | null;
  onSelect: (channel: Channel) => void;
  voice: Record<string, VoiceChannelState>;
  /// ห้องเสียงที่เราต่ออยู่ (จาก useVoiceRoom) — null ถ้าไม่ได้ต่อ
  connectedChannelId: string | null;
  header: ReactNode;
  notice?: ReactNode;
  /// แผง "เชื่อมต่อเสียงแล้ว" ของผู้ให้บริการเสียง (ถ้ามี) + การ์ดผู้ใช้
  footer?: ReactNode;
  loading: boolean;
  error: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const empty = categories.every((category) => category.channels.length === 0);

  return (
    <nav aria-label="ช่องของห้อง" className="flex h-full min-h-0 flex-col">
      {header}
      {notice}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <p className="px-2 py-4 text-sm text-muted-foreground">กำลังโหลด…</p>}
        {error && <p className="px-2 py-4 text-sm text-destructive">{error}</p>}
        {!loading && !error && empty && (
          <p className="px-2 py-4 text-sm leading-relaxed text-muted-foreground">
            ยังไม่ได้อยู่ห้องไหน — กด “สร้างห้อง” แล้วบอกว่าห้องนี้ไว้ทำอะไร
          </p>
        )}

        {!loading &&
          !error &&
          !empty &&
          categories.map((category) => {
            const isCollapsed = collapsed.has(category.key);

            return (
              <section key={category.key} className="pt-4">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);

                      if (next.has(category.key)) next.delete(category.key);
                      else next.add(category.key);

                      return next;
                    })
                  }
                  className="flex w-full items-center gap-0.5 px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDown
                    className={`size-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    aria-hidden
                  />
                  {category.label}
                </button>

                <ul className="space-y-px">
                  {category.channels.map((channel) => {
                    const active = channel.id === activeId;

                    // ยุบหมวดแล้วยังเห็นห้องที่เปิดอยู่ และห้องเสียงที่มีคน (แบบ Discord)
                    if (
                      isCollapsed &&
                      !active &&
                      !(category.kind === 'voice' && (voice[channel.id]?.occupants.length ?? 0) > 0)
                    ) {
                      return null;
                    }

                    return category.kind === 'voice' ? (
                      <VoiceRow
                        key={channel.id}
                        channel={channel}
                        active={active}
                        connected={connectedChannelId === channel.id}
                        state={voice[channel.id]}
                        onSelect={() => onSelect(channel)}
                      />
                    ) : (
                      <TextRow
                        key={channel.id}
                        channel={channel}
                        active={active}
                        onSelect={() => onSelect(channel)}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
      </div>

      {footer}
    </nav>
  );
}

function TextRow({
  channel,
  active,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  onSelect: () => void;
}) {
  const unread = channel.unreadCount > 0 && !active;

  return (
    <li className="relative">
      {unread && (
        <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground" aria-hidden />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={channel.description ?? undefined}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[15px] transition-colors ${
          active
            ? 'bg-accent font-medium text-foreground'
            : unread
              ? 'font-semibold text-foreground hover:bg-accent/70'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
        }`}
      >
        <Hash className="size-5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{channel.name ?? 'ห้องไม่มีชื่อ'}</span>
        {unread && (
          <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[11px] font-bold leading-4 text-white tabular-nums">
            {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
          </span>
        )}
      </button>
    </li>
  );
}

function VoiceRow({
  channel,
  active,
  connected,
  state,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  connected: boolean;
  state: VoiceChannelState | undefined;
  onSelect: () => void;
}) {
  const occupants = state?.occupants ?? [];
  const now = useNow(occupants.length > 0 && Boolean(state?.startedAt));

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={channel.description ?? undefined}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[15px] transition-colors ${
          active || connected
            ? 'bg-accent font-medium text-foreground'
            : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
        }`}
      >
        <Volume2 className={`size-5 shrink-0 ${connected ? 'text-success' : 'opacity-70'}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{channel.name ?? 'ห้องเสียง'}</span>
        {occupants.length > 0 && state?.startedAt && (
          <span
            className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
            title="เปิดห้องเสียงมาแล้ว"
          >
            {elapsedLabel(state.startedAt, now)}
          </span>
        )}
      </button>

      {occupants.length > 0 && (
        <>
          <ChannelStatus channel={channel} />
          <ul aria-label={`คนในห้องเสียง ${channel.name ?? ''}`} className="mb-1 ml-7 space-y-px">
            {occupants.map((occupant) => (
              <li key={occupant.coreUserId}>
                <OccupantRow occupant={occupant} />
              </li>
            ))}
          </ul>
        </>
      )}

      {active && <InviteRow channel={channel} />}
    </li>
  );
}

function OccupantRow({ occupant }: { occupant: VoiceOccupant }) {
  const profile = useProfile(occupant.coreUserId);

  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground">
      <UserAvatar
        coreUserId={occupant.coreUserId}
        displayName={profile.displayName}
        avatarUrl={profile.avatarUrl}
        size={22}
        showOnline={false}
      />
      <span className="min-w-0 flex-1 truncate">{profile.displayName}</span>
      {occupant.sharing && (
        <span className="shrink-0 rounded bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
          ถ่ายทอดสด
        </span>
      )}
      {occupant.video && !occupant.sharing && (
        <Video className="size-3.5 shrink-0" aria-label="เปิดกล้อง" />
      )}
      {occupant.deafened ? (
        <HeadphoneOff className="size-3.5 shrink-0 text-destructive" aria-label="ปิดหูฟัง" />
      ) : (
        occupant.muted && <MicOff className="size-3.5 shrink-0 text-destructive" aria-label="ปิดไมค์" />
      )}
    </div>
  );
}

/// "ตั้งสถานะช่อง" — สถานะของห้องเสียงคือวัตถุประสงค์ของห้อง (ช่อง description)
///
/// ผู้ดูแลห้องแก้ได้ตรงนี้ คนอื่นเห็นเป็นบรรทัดสถานะ
function ChannelStatus({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(channel.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement | null>(null);

  if (!channel.canManage) {
    return channel.description ? (
      <p className="ml-9 truncate pb-0.5 text-[11px] text-muted-foreground" title={channel.description}>
        {channel.description}
      </p>
    ) : null;
  }

  async function save() {
    const description = draft.trim();

    if (!description) {
      setError('สถานะต้องยาว 1-300 ตัวอักษร');

      return;
    }

    setBusy(true);
    setError(null);

    try {
      // หน้าห้องฟัง channel:updated อยู่แล้ว รายการจึงอัปเดตเองหลังบันทึก
      await api.patch(`/channels/${channel.id}`, { description });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          setDraft(channel.description ?? '');
          setError(null);
          setOpen(true);
        }}
        className="ml-9 block max-w-[calc(100%-2.25rem)] truncate pb-0.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        title={channel.description ?? 'ตั้งสถานะช่อง'}
      >
        {channel.description ?? 'ตั้งสถานะช่อง'}
      </button>

      <RoomPopover
        open={open}
        onClose={() => setOpen(false)}
        anchor={{ ref }}
        side="right"
        width={300}
        label="ตั้งสถานะช่อง"
        className="p-3"
      >
        <h3 className="mb-2 text-sm font-semibold">ตั้งสถานะช่อง</h3>
        <input
          autoFocus
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
          placeholder="กำลังทำอะไรกันอยู่ในห้องนี้"
          aria-label="สถานะช่อง"
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded px-3 py-1 text-sm hover:underline">
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            บันทึก
          </button>
        </div>
      </RoomPopover>
    </>
  );
}

/// "เชิญเข้าร่วมการแชทด้วยเสียง" — คัดลอกลิงก์ที่พาสมาชิกตรงมาที่ห้องเสียงนี้
function InviteRow({ channel }: { channel: Channel }) {
  return (
    <button
      type="button"
      onClick={() => {
        const link = `${window.location.origin}/chat?channel=${channel.id}`;

        void navigator.clipboard
          .writeText(link)
          .then(() => showToast('คัดลอกลิงก์เชิญเข้าห้องเสียงแล้ว'))
          .catch(() => showToast('คัดลอกลิงก์ไม่สำเร็จ', 'error'));
      }}
      className="ml-7 mt-0.5 flex w-[calc(100%-1.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
    >
      <UserPlus className="size-4 shrink-0" aria-hidden />
      เชิญเข้าร่วมการแชทด้วยเสียง
    </button>
  );
}

/// นาฬิกาที่เดินทุกวินาที — เดินเฉพาะตอนต้องแสดงเวลา
function useNow(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => setNow(new Date()), 1000);

    return () => clearInterval(timer);
  }, [running]);

  return now;
}

/// การ์ดผู้ใช้มุมซ้ายล่าง — รูป ชื่อ สถานะ และปุ่มตั้งค่า
///
/// ปุ่มไมค์/หูฟังส่งมาจากผู้ให้บริการเสียง (`controls`) — ถ้าไม่มีก็ไม่วาด
/// ดีกว่ามีปุ่มที่กดแล้วไม่เกิดอะไร
export function SidebarUserCard({ controls }: { controls?: ReactNode }) {
  const me = useMe();
  const profile = useProfile(me.id);

  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/50 px-2 py-1.5">
      <Link
        href={`/profile/${encodeURIComponent(me.id)}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
      >
        <Avatar coreUserId={me.id} size={32} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">{profile.displayName}</span>
          <span className="block truncate text-[11px] text-muted-foreground">ออนไลน์</span>
        </span>
      </Link>
      {controls}
      <Link
        href="/settings"
        aria-label="การตั้งค่า"
        title="การตั้งค่า"
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings className="size-[18px]" />
      </Link>
    </div>
  );
}
