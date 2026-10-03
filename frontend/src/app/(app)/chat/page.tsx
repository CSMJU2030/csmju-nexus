'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { ChannelSidebar, SidebarUserCard, type VoiceChannelState } from '@/components/csmju/channel-sidebar';
import { parseOccupants, type VoiceOccupant, type VoiceOccupantsPayload } from '@/components/csmju/channel-types';
import { VoiceChannelView } from '@/components/csmju/channel-voice';
import { useVoiceRoom } from '@/components/csmju/voice-room-provider';
import { VoiceConnectionPanel, VoiceUserControls } from '@/components/csmju/voice-room-panel';
import { VoiceRoomStage } from '@/components/csmju/voice-room-stage';
import { ToastHost } from '@/components/csmju/messages-toast';
import { CreateRoomDialog } from '@/components/csmju/room-dialogs';
import { InviteMembersButton } from '@/components/csmju/room-invite';
import { api, ApiError } from '@/lib/csmju/api';
import { canInviteMembers } from '@/lib/csmju/room-permissions';
import { useMe } from '@/lib/csmju/session';
import { bindSocket, connectSocket, onSocketReconnect } from '@/lib/csmju/socket';
import type { Channel, VoiceSession } from '@/lib/csmju/types';
import { groupChannels, isRoom } from './chat-logic';
import { TextChannel } from './text-channel';

/// ใช้แคชก้อนเดียวกับกล่องข้อความ (inbox-list.tsx · CHANNELS_KEY)
const CHANNELS_KEY = ['channels', 'mine'] as const;
const VOICE_SESSIONS_KEY = ['voice-sessions', 'mine'] as const;

/// หน้า "ห้อง" แบบ Discord
///
///   ┌ ช่อง ──────────┬ ห้องที่เปิด ─────────────────────┬ สมาชิก ┐
///   │ ช่องข้อความ    │ # ทั่วไป   🧵 🔔 📌 👥  [ค้นหา] │ ออนไลน์│
///   │  # ทั่วไป      │ ── 18 สิงหาคม 2569 ──           │ ออฟไลน์│
///   │ ช่องสำหรับพูด  │ ข้อความ…                        │        │
///   │  🔊 ทั่วไป     │                                 │        │
///   │    (รูป) ชื่อ  │ [ส่งข้อความใน #ทั่วไป]          │        │
///   │ [การ์ดผู้ใช้]  │                                 │        │
///   └────────────────┴─────────────────────────────────┴────────┘
///
/// แชทส่วนตัวและแชทกลุ่มแบบ Instagram อยู่ที่ /messages — หน้านี้มีแต่ห้องกลุ่ม
/// ห้องประจำวิชา และห้องเสียง (ไม่มีโมเดล "เซิร์ฟเวอร์" แยก ห้องทั้งหมดของเราคือหนึ่งเซิร์ฟเวอร์)
export default function ChatPage() {
  // useSearchParams ต้องอยู่ใต้ Suspense ไม่งั้น build แบบ prerender ล้ม
  return (
    <Suspense fallback={null}>
      <RoomsWorkspace />
    </Suspense>
  );
}

function setUrlChannel(channelId: string | null, messageId?: string) {
  const next = new URLSearchParams(window.location.search);

  if (channelId) next.set('channel', channelId);
  else next.delete('channel');

  if (messageId) next.set('message', messageId);
  else next.delete('message');

  next.delete('create');

  const query = next.toString();

  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function RoomsWorkspace() {
  const params = useSearchParams();
  const requested = params.get('channel');
  const [pickedId, setPickedId] = useState<string | null>(requested);
  const [mobilePane, setMobilePane] = useState<'list' | 'room'>(requested ? 'room' : 'list');
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  /// ห้องเสียงที่ socket บอกล่าสุด — ทับค่าจากรายการห้องจนกว่าจะโหลดรายการใหม่
  const [liveOccupants, setLiveOccupants] = useState<Record<string, VoiceOccupantsPayload>>({});
  const queryClient = useQueryClient();
  const voiceRoom = useVoiceRoom();
  const me = useMe();

  const { data: channels = [], isPending: loading, error: queryError } = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: async () => (await api.list<Channel>('/channels?limit=50')).items,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: VOICE_SESSIONS_KEY,
    queryFn: async () => (await api.list<VoiceSession>('/voice-sessions')).items,
    refetchInterval: 30_000,
  });

  const rooms = useMemo(() => channels.filter(isRoom), [channels]);
  const categories = useMemo(() => groupChannels(rooms), [rooms]);
  const router = useRouter();

  // ลิงก์ ?channel= ที่ชี้ไปแชทส่วนตัวหรือแชทกลุ่ม (เช่นจากการแจ้งเตือน) — ห้องพวกนั้น
  // อยู่ที่ Direct (/messages) ไม่ใช่ที่นี่ จึงส่งต่อไปแทนที่จะเปิดห้องว่าง
  useEffect(() => {
    if (!requested) return;

    const target = channels.find((channel) => channel.id === requested);

    if (target && !isRoom(target)) {
      router.replace(`/messages?channel=${encodeURIComponent(requested)}`);
    }
  }, [channels, requested, router]);

  // ── คนในห้องเสียงแบบสด ──
  useEffect(() => {
    let cancelled = false;
    const unbind: (() => void)[] = [];

    void connectSocket()
      .then((socket) => {
        if (cancelled) return;

        unbind.push(
          bindSocket<VoiceOccupantsPayload>(socket, 'voice:occupants', (payload) => {
            setLiveOccupants((prev) => ({
              ...prev,
              [payload.channelId]: { ...payload, occupants: parseOccupants(payload.occupants) },
            }));
            // เวลาเริ่มของรอบใหม่ (หรือรอบที่จบ) มาจากรายการห้องเสียง
            void queryClient.invalidateQueries({ queryKey: VOICE_SESSIONS_KEY });
          }),
          onSocketReconnect(() => {
            setLiveOccupants({});
            void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
            void queryClient.invalidateQueries({ queryKey: VOICE_SESSIONS_KEY });
          }),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      for (const off of unbind) off();
    };
  }, [queryClient]);

  const voice = useMemo(() => {
    const map: Record<string, VoiceChannelState> = {};

    for (const room of rooms) {
      if (room.kind !== 'VOICE') continue;

      const session = sessions.find((row) => row.channelId === room.id) ?? null;
      const live = liveOccupants[room.id];
      const listed = (room as Channel & { voiceOccupants?: unknown }).voiceOccupants;
      let occupants: VoiceOccupant[];

      if (live) occupants = live.occupants;
      else if (Array.isArray(listed)) occupants = parseOccupants(listed);
      else
        occupants = (session?.participants ?? []).map((row) => ({
          coreUserId: row.coreUserId,
          muted: false,
          deafened: false,
          video: false,
          sharing: false,
        }));

      map[room.id] = {
        occupants,
        startedAt: occupants.length > 0 ? (session?.startedAt ?? null) : null,
      };
    }

    return map;
  }, [rooms, sessions, liveOccupants]);

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดรายการห้องไม่สำเร็จ — หลังบ้านรันอยู่ไหม'
    : null;

  const firstText = categories.find((category) => category.kind === 'text' && category.channels.length > 0)
    ?.channels[0];
  const activeId = (pickedId && rooms.some((room) => room.id === pickedId) ? pickedId : null) ?? firstText?.id ?? null;
  const active = rooms.find((room) => room.id === activeId) ?? null;

  function setChannels(update: (prev: Channel[]) => Channel[]) {
    queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (current) => update(current ?? []));
  }

  function select(channelId: string, messageId?: string) {
    setPickedId(channelId);
    setMobilePane('room');
    setUrlChannel(channelId, messageId);
  }

  function removeChannel(channelId: string, notice: string) {
    setChannels((prev) => prev.filter((row) => row.id !== channelId));

    if (activeId === channelId) {
      setPickedId(null);
      setMobilePane('list');
      setUrlChannel(null);
    }

    setRemovedNotice(notice);
  }

  return (
    <div className="flex h-[calc(100dvh-6.25rem-env(safe-area-inset-bottom))] lg:h-dvh">
      <div
        data-pane="channels"
        className={`flex w-60 shrink-0 flex-col border-r border-border bg-muted/40 max-md:w-full max-md:border-r-0 ${
          mobilePane === 'room' ? 'max-md:hidden' : ''
        }`}
      >
        <ChannelSidebar
          categories={categories}
          activeId={activeId}
          onSelect={(channel) => select(channel.id)}
          voice={voice}
          connectedChannelId={voiceRoom.channelId}
          loading={loading}
          error={error}
          header={
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 shadow-csmju-xs">
              <h2 className="text-[15px] font-semibold">ห้องของฉัน</h2>
              <CreateRoomDialog
                defaultOpen={params.get('create') === '1'}
                onCreated={(channel) => {
                  setChannels((prev) => [channel, ...prev]);
                  setRemovedNotice(null);
                  select(channel.id);
                }}
              />
            </div>
          }
          notice={
            removedNotice && (
              <p
                role="status"
                className="mx-2 mt-2 flex items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-csmju-caption text-secondary-foreground"
              >
                <Trash2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{removedNotice}</span>
                <button
                  type="button"
                  onClick={() => setRemovedNotice(null)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="ปิดข้อความ"
                >
                  ×
                </button>
              </p>
            )
          }
          footer={
            <>
              <VoiceConnectionPanel />
              <SidebarUserCard controls={<VoiceUserControls />} />
            </>
          }
        />
      </div>

      {active?.kind === 'VOICE' ? (
        <VoiceChannelView
          key={active.id}
          channel={active}
          occupants={voice[active.id]?.occupants ?? []}
          voice={{
            connectedChannelId: voiceRoom.channelId,
            joining: voiceRoom.status === 'joining',
            join: (channelId) => void voiceRoom.join(channelId),
            stage: <VoiceRoomStage />,
          }}
          hiddenOnMobile={mobilePane === 'list'}
          onBack={() => setMobilePane('list')}
          headerActions={canInviteMembers(active, me.coreRole) && <InviteMembersButton channel={active} />}
        />
      ) : active ? (
        <TextChannel
          key={active.id}
          channel={active}
          rooms={rooms}
          hiddenOnMobile={mobilePane === 'list'}
          onBack={() => setMobilePane('list')}
          onRead={() =>
            setChannels((prev) => prev.map((row) => (row.id === active.id ? { ...row, unreadCount: 0 } : row)))
          }
          onUpdated={(next) =>
            setChannels((prev) =>
              prev.map((row) =>
                row.id === next.id
                  ? {
                      ...row,
                      name: next.name,
                      description: next.description,
                      ...(next.muted === undefined ? {} : { muted: next.muted }),
                    }
                  : row,
              ),
            )
          }
          onDeleted={(channelId, byMe) =>
            removeChannel(
              channelId,
              byMe ? `ลบห้อง "${active.name ?? ''}" แล้ว` : `ห้อง "${active.name ?? ''}" ถูกลบโดยผู้ดูแลห้อง`,
            )
          }
          onRemoved={(channelId, reason) =>
            removeChannel(
              channelId,
              reason === 'left'
                ? `ออกจากห้อง "${active.name ?? ''}" แล้ว`
                : `คุณถูกนำออกจากห้อง "${active.name ?? ''}"`,
            )
          }
          onOpenChannel={(channelId, messageId) => select(channelId, messageId)}
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center text-sm text-muted-foreground max-md:hidden">
          {loading ? 'กำลังโหลด…' : 'เลือกห้องจากรายการด้านซ้าย หรือสร้างห้องใหม่'}
        </div>
      )}

      <ToastHost />
    </div>
  );
}
