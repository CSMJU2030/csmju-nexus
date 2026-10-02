'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Loader2 } from 'lucide-react';
import { parseMembers, type ChannelMember } from '@/components/csmju/channel-types';
import { UserAvatar, VerifiedBadge } from '@/components/csmju/user-badge';
import { useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { bindSocket, connectSocket } from '@/lib/csmju/socket';

export const channelMembersKey = (channelId: string) => ['channel-members', channelId] as const;

const MEMBER_PAGE = 100;

export interface ChannelMembers {
  online: ChannelMember[];
  offline: ChannelMember[];
  /// ยอดทั้งหมดจาก meta.total — ห้องใหญ่อาจมีมากกว่าที่โหลดมาแสดง
  onlineTotal: number;
  offlineTotal: number;
}

/// สมาชิกของห้อง แยกออนไลน์/ออฟไลน์ที่หลังบ้าน (`?status=`) — หลังบ้านเคารพการปิด
/// สถานะกิจกรรมและการบล็อกให้แล้ว จึงเชื่อค่า online ของหลังบ้านตรง ๆ
export function useChannelMembers(channelId: string) {
  return useQuery({
    queryKey: channelMembersKey(channelId),
    queryFn: async (): Promise<ChannelMembers> => {
      const [on, off] = await Promise.all([
        api.list<unknown>(`/channels/${channelId}/members?status=online&limit=${MEMBER_PAGE}`),
        api.list<unknown>(`/channels/${channelId}/members?status=offline&limit=${MEMBER_PAGE}`),
      ]);

      return {
        online: parseMembers(on.items),
        offline: parseMembers(off.items),
        onlineTotal: on.meta.total,
        offlineTotal: off.meta.total,
      };
    },
    staleTime: 30_000,
    retry: false,
  });
}

/// แผงสมาชิกด้านขวาแบบ Discord
///
///   ออนไลน์ — 3
///   (●) สมชาย  👑
///   ออฟไลน์ — 5          ← จางลง
///
/// มีใครออนไลน์/ออฟไลน์ (`presence:changed`) → โหลดสองกลุ่มใหม่ ย้ายแถวให้เอง
export function MemberList({
  channelId,
  onOpenUser,
}: {
  channelId: string;
  onOpenUser: (coreUserId: string, rect: DOMRect, nickname: string | null) => void;
}) {
  const { data, isPending, error } = useChannelMembers(channelId);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void connectSocket()
      .then((socket) => {
        if (cancelled) return;

        off = bindSocket(socket, 'presence:changed', () => {
          // รวบหลายเหตุการณ์ติดกันเป็นการโหลดครั้งเดียว
          if (timer) clearTimeout(timer);
          timer = setTimeout(
            () => void queryClient.invalidateQueries({ queryKey: channelMembersKey(channelId) }),
            400,
          );
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      off?.();
    };
  }, [channelId, queryClient]);

  const byRole = (a: ChannelMember, b: ChannelMember) =>
    Number(b.role === 'MODERATOR') - Number(a.role === 'MODERATOR');
  const online = [...(data?.online ?? [])].sort(byRole);
  const offline = [...(data?.offline ?? [])].sort(byRole);

  return (
    <aside
      aria-label="สมาชิก"
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-l border-border bg-muted/30 px-2 py-3 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-72 max-lg:bg-card max-lg:shadow-csmju-lg"
    >
      {isPending && (
        <p className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> กำลังโหลดสมาชิก…
        </p>
      )}

      {error && (
        <p className="px-2 text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'โหลดรายชื่อสมาชิกไม่สำเร็จ'}
        </p>
      )}

      {!isPending && !error && (
        <>
          <Section label={`ออนไลน์ — ${data?.onlineTotal ?? online.length}`} members={online} dim={false} onOpenUser={onOpenUser} />
          <Section label={`ออฟไลน์ — ${data?.offlineTotal ?? offline.length}`} members={offline} dim onOpenUser={onOpenUser} />
        </>
      )}
    </aside>
  );
}

function Section({
  label,
  members,
  dim,
  onOpenUser,
}: {
  label: string;
  members: ChannelMember[];
  dim: boolean;
  onOpenUser: (coreUserId: string, rect: DOMRect, nickname: string | null) => void;
}) {
  return (
    <section className="mb-4">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <ul>
        {members.map((member) => (
          <li key={member.coreUserId}>
            <MemberRow member={member} dim={dim} onOpenUser={onOpenUser} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MemberRow({
  member,
  dim,
  onOpenUser,
}: {
  member: ChannelMember;
  dim: boolean;
  onOpenUser: (coreUserId: string, rect: DOMRect, nickname: string | null) => void;
}) {
  const profile = useProfile(member.coreUserId);
  const name = member.nickname ?? profile.displayName;

  return (
    <button
      type="button"
      onClick={(event) =>
        onOpenUser(member.coreUserId, event.currentTarget.getBoundingClientRect(), member.nickname)
      }
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent ${
        dim ? 'opacity-45 hover:opacity-100' : ''
      }`}
    >
      <UserAvatar
        coreUserId={member.coreUserId}
        displayName={profile.displayName}
        avatarUrl={profile.avatarUrl}
        size={32}
      />
      <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
        <span className="truncate">{name}</span>
        <VerifiedBadge badge={profile.badge} className="size-3.5" />
        {member.role === 'MODERATOR' && (
          <span title="ผู้ดูแลห้อง" className="shrink-0">
            <Crown className="size-3.5 text-warning" aria-label="ผู้ดูแลห้อง" />
          </span>
        )}
      </span>
    </button>
  );
}
