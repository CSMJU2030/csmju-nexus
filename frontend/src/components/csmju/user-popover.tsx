'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Send } from 'lucide-react';
import { useProfileData } from '@/components/csmju/profile-data';
import { RoomPopover, type PopoverAnchor } from '@/components/csmju/room-popover';
import { UserAvatar, VerifiedBadge, useOnline } from '@/components/csmju/user-badge';
import { useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, Message } from '@/lib/csmju/types';

/// ป๊อปอัพโปรไฟล์แบบ Discord — เปิดเมื่อคลิกรูปหรือชื่อในห้อง
///
///   ┌ แถบปก (รูปปกจริง หรือไล่สีถ้าไม่มี) ┐
///   │ (รูป●)                               │
///   │ ชื่อที่แสดง ✓                         │
///   │ user-002 · ห้องที่อยู่ร่วมกัน n ห้อง   │
///   │ คำแนะนำตัว                           │
///   │ [ดูประวัติแบบเต็ม]                   │
///   │ [ส่งข้อความถึง @ชื่อ        ]  ⏎     │
///   └──────────────────────────────────────┘
///
/// ช่อง "ส่งข้อความถึง" ส่งจริง: เปิด/หาแชทส่วนตัวด้วย POST /direct-channels
/// แล้วส่งข้อความเข้าไป — ไม่ได้พาไปหน้าข้อความเฉย ๆ
export function UserPopover({
  coreUserId,
  anchor,
  open,
  onClose,
  nickname = null,
}: {
  coreUserId: string;
  anchor: PopoverAnchor;
  open: boolean;
  onClose: () => void;
  /// ชื่อเล่นในห้องนี้ (ถ้ามี)
  nickname?: string | null;
}) {
  return (
    <RoomPopover
      open={open}
      onClose={onClose}
      anchor={anchor}
      side="right"
      width={300}
      label="โปรไฟล์ผู้ใช้"
    >
      {open && <UserCard coreUserId={coreUserId} nickname={nickname} />}
    </RoomPopover>
  );
}

function UserCard({ coreUserId, nickname }: { coreUserId: string; nickname: string | null }) {
  const me = useMe();
  const isMe = coreUserId === me.id;
  const summary = useProfile(coreUserId);
  const online = useOnline(coreUserId);
  const { data } = useProfileData(coreUserId, isMe);
  const profile = data?.profile;
  const name = profile?.displayName ?? summary.displayName;

  /// ห้องที่อยู่ร่วมกัน — แสดงเมื่อหลังบ้านส่งตัวเลขนี้มาเท่านั้น ไม่เดาเอง
  const mutualRooms = (profile as { mutualChannelCount?: unknown } | undefined)
    ?.mutualChannelCount;

  return (
    <div className="max-h-[inherit] overflow-y-auto">
      <div
        className="h-16 w-full bg-gradient-to-r from-primary/70 to-primary/30 bg-cover bg-center"
        style={profile?.coverUrl ? { backgroundImage: `url("${profile.coverUrl}")` } : undefined}
        aria-hidden
      />

      <div className="px-4 pb-4">
        <div className="-mt-9 mb-2 flex items-end justify-between">
          <span className="rounded-full border-4 border-popover bg-popover">
            <UserAvatar
              coreUserId={coreUserId}
              displayName={name}
              avatarUrl={profile?.avatarUrl ?? summary.avatarUrl}
              size={72}
            />
          </span>
        </div>

        <div className="rounded-lg bg-muted/60 p-3">
          <p className="flex items-center gap-1 text-base font-bold leading-tight">
            <span className="truncate">{nickname ?? name}</span>
            <VerifiedBadge badge={profile?.badge ?? summary.badge} className="size-4" />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {nickname ? `${name} · ` : ''}
            {coreUserId}
          </p>

          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`inline-block size-2 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground/50'}`}
              aria-hidden
            />
            {online ? 'ออนไลน์' : 'ออฟไลน์'}
            {typeof mutualRooms === 'number' && (
              <>
                <span aria-hidden>·</span>
                ห้องที่อยู่ร่วมกัน {mutualRooms} ห้อง
              </>
            )}
          </p>

          {profile?.bio && (
            <p className="mt-2 whitespace-pre-wrap break-words border-t border-border pt-2 text-sm leading-snug">
              {profile.bio}
            </p>
          )}

          <Link
            href={`/profile/${encodeURIComponent(coreUserId)}`}
            className="mt-3 block rounded-md bg-background px-3 py-1.5 text-center text-sm font-medium transition-colors hover:bg-accent"
          >
            ดูประวัติแบบเต็ม
          </Link>
        </div>

        {!isMe && <DirectMessageInput coreUserId={coreUserId} name={nickname ?? name} />}
      </div>
    </div>
  );
}

function DirectMessageInput({ coreUserId, name }: { coreUserId: string; name: string }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function send() {
    const content = draft.trim();

    if (!content || busy) return;

    setBusy(true);
    setError(null);

    try {
      const channel = await api.post<Channel>('/direct-channels', {
        peerCoreUserId: coreUserId,
      });

      await api.post<Message>(`/channels/${channel.id}/messages`, {
        content,
        clientNonce: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      });

      setDraft('');
      setSentTo(channel.id);
      // กล่องข้อความต้องเห็นแชทนี้ขึ้นบนสุดทันที
      void queryClient.invalidateQueries({ queryKey: ['channels', 'mine'] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1 rounded-md border border-input bg-background pr-1 focus-within:ring-2 focus-within:ring-ring">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSentTo(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          maxLength={4000}
          placeholder={`ส่งข้อความถึง @${name}`}
          aria-label={`ส่งข้อความถึง @${name}`}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || busy}
          aria-label="ส่ง"
          className="grid size-7 shrink-0 place-items-center rounded text-primary transition-opacity disabled:opacity-30"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>

      {sentTo && (
        <p role="status" className="mt-1.5 flex items-center gap-1 text-xs text-success">
          <Check className="size-3.5" />
          ส่งแล้ว ·{' '}
          <Link href={`/messages?channel=${sentTo}`} className="font-medium text-primary hover:underline">
            เปิดแชท
          </Link>
        </p>
      )}

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
