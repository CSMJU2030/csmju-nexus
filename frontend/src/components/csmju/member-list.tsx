'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Loader2, LogOut, UserMinus } from 'lucide-react';
import { parseMembers, type ChannelMember } from '@/components/csmju/channel-types';
import { ConfirmDialog } from '@/components/csmju/messages-menu';
import { showToast } from '@/components/csmju/messages-toast';
import { UserAvatar, VerifiedBadge } from '@/components/csmju/user-badge';
import { useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { canRemoveMember } from '@/lib/csmju/room-permissions';
import { useMe } from '@/lib/csmju/session';
import { bindSocket, connectSocket } from '@/lib/csmju/socket';
import type { Channel } from '@/lib/csmju/types';

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
///   [+ เชิญสมาชิก]       ← header (เฉพาะคนที่เชิญได้)
///   ออนไลน์ — 3
///   (●) สมชาย  👑   [−]  ← ชี้แล้วเห็นปุ่มนำออก / ออกจากห้อง (แถวของตัวเอง)
///   ออฟไลน์ — 5          ← จางลง
///
/// มีใครออนไลน์/ออฟไลน์ (`presence:changed`) หรือมีคนเข้า/ออกห้อง
/// (`channel:members`) → โหลดสองกลุ่มใหม่ ย้ายแถวให้เอง
///
/// ส่ง `channel` มาด้วยถึงจะมีปุ่มนำออก/ออกจากห้อง — สิทธิ์ตาม room-permissions.ts
export function MemberList({
  channelId,
  channel,
  header,
  onOpenUser,
  onLeft,
}: {
  channelId: string;
  channel?: Channel;
  header?: ReactNode;
  onOpenUser: (coreUserId: string, rect: DOMRect, nickname: string | null) => void;
  /// ออกจากห้องสำเร็จ — ผู้เรียกพาออกจากห้อง
  onLeft?: () => void;
}) {
  const { data, isPending, error } = useChannelMembers(channelId);
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<{ kind: MemberActionKind; member: ChannelMember; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unbind: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    // รวบหลายเหตุการณ์ติดกันเป็นการโหลดครั้งเดียว
    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: channelMembersKey(channelId) }),
        400,
      );
    };

    void connectSocket()
      .then((socket) => {
        if (cancelled) return;

        unbind.push(
          bindSocket(socket, 'presence:changed', reload),
          bindSocket<{ channelId: string }>(socket, 'channel:members', (payload) => {
            if (payload.channelId === channelId) reload();
          }),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const off of unbind) off();
    };
  }, [channelId, queryClient]);

  async function run() {
    if (!confirm) return;

    setBusy(true);
    setActionError(null);

    try {
      if (confirm.kind === 'leave') {
        await api.del(`/channels/${channelId}/members/me`);
        setConfirm(null);
        onLeft?.();

        return;
      }

      await api.del(`/channels/${channelId}/members/${encodeURIComponent(confirm.member.coreUserId)}`);
      await queryClient.invalidateQueries({ queryKey: channelMembersKey(channelId) });
      void queryClient.invalidateQueries({ queryKey: ['channels', 'mine'] });
      showToast(`นำ ${confirm.name} ออกจากห้องแล้ว`);
      setConfirm(null);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const byRole = (a: ChannelMember, b: ChannelMember) =>
    Number(b.role === 'MODERATOR') - Number(a.role === 'MODERATOR');
  const online = [...(data?.online ?? [])].sort(byRole);
  const offline = [...(data?.offline ?? [])].sort(byRole);
  const onAction: MemberAction | undefined = channel
    ? (kind, member, name) => {
        setActionError(null);
        setConfirm({ kind, member, name });
      }
    : undefined;
  const roomName = channel?.name ?? 'ห้องนี้';

  return (
    <aside
      aria-label="สมาชิก"
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-l border-border bg-muted/30 px-2 py-3 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-72 max-lg:bg-card max-lg:shadow-csmju-lg"
    >
      {header}

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
          <Section
            label={`ออนไลน์ — ${data?.onlineTotal ?? online.length}`}
            members={online}
            dim={false}
            channel={channel}
            onOpenUser={onOpenUser}
            onAction={onAction}
          />
          <Section
            label={`ออฟไลน์ — ${data?.offlineTotal ?? offline.length}`}
            members={offline}
            dim
            channel={channel}
            onOpenUser={onOpenUser}
            onAction={onAction}
          />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'leave' ? `ออกจาก ${roomName}?` : `นำ ${confirm?.name ?? ''} ออกจากห้อง?`}
        description={
          confirm?.kind === 'leave'
            ? 'คุณจะไม่เห็นข้อความของห้องนี้อีก จนกว่าผู้ดูแลห้องจะเชิญกลับเข้ามา'
            : `${confirm?.name ?? ''} จะไม่เห็นข้อความของห้องนี้อีก จนกว่าจะถูกเชิญกลับเข้ามา`
        }
        confirmLabel={confirm?.kind === 'leave' ? 'ออกจากห้อง' : 'นำออก'}
        busy={busy}
        error={actionError}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
      />
    </aside>
  );
}

type MemberActionKind = 'remove' | 'leave';
type MemberAction = (kind: MemberActionKind, member: ChannelMember, name: string) => void;

function Section({
  label,
  members,
  dim,
  channel,
  onOpenUser,
  onAction,
}: {
  label: string;
  members: ChannelMember[];
  dim: boolean;
  channel?: Channel;
  onOpenUser: (coreUserId: string, rect: DOMRect, nickname: string | null) => void;
  onAction?: MemberAction;
}) {
  return (
    <section className="mb-4">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <ul>
        {members.map((member) => (
          <li key={member.coreUserId}>
            <MemberRow member={member} dim={dim} channel={channel} onOpenUser={onOpenUser} onAction={onAction} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MemberRow({
  member,
  dim,
  channel,
  onOpenUser,
  onAction,
}: {
  member: ChannelMember;
  dim: boolean;
  channel?: Channel;
  onOpenUser: (coreUserId: string, rect: DOMRect, nickname: string | null) => void;
  onAction?: MemberAction;
}) {
  const me = useMe();
  const profile = useProfile(member.coreUserId);
  const name = member.nickname ?? profile.displayName;
  const self = member.coreUserId === me.id;
  const action: MemberActionKind | null =
    !channel || !onAction || channel.kind === 'DM'
      ? null
      : self
        ? 'leave'
        : canRemoveMember(channel, me, member)
          ? 'remove'
          : null;

  return (
    <div
      className={`group flex items-center rounded-md transition-colors hover:bg-accent ${
        dim ? 'opacity-45 focus-within:opacity-100 hover:opacity-100' : ''
      }`}
    >
      <button
        type="button"
        onClick={(event) =>
          onOpenUser(member.coreUserId, event.currentTarget.getBoundingClientRect(), member.nickname)
        }
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left"
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

      {action && onAction && (
        <button
          type="button"
          onClick={() => onAction(action, member, name)}
          aria-label={action === 'leave' ? 'ออกจากห้อง' : `นำ ${name} ออกจากห้อง`}
          title={action === 'leave' ? 'ออกจากห้อง' : 'นำออกจากห้อง'}
          className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
        >
          {action === 'leave' ? <LogOut className="size-4" /> : <UserMinus className="size-4" />}
        </button>
      )}
    </div>
  );
}
