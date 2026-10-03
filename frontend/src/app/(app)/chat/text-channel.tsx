'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  ChevronLeft,
  Hash,
  Loader2,
  MessagesSquare,
  Pin,
  Search,
  Send,
  SmilePlus,
  Users,
  X,
} from 'lucide-react';
import {
  AttachmentButton,
  AttachmentTray,
  useAttachments,
} from '@/components/csmju/attachment-picker';
import { ChannelMessage, type MessageActions } from '@/components/csmju/channel-message';
import { ForwardDialog } from '@/components/csmju/direct-forward';
import { EmojiPopover } from '@/components/csmju/emoji-picker';
import { MemberList } from '@/components/csmju/member-list';
import { showToast } from '@/components/csmju/messages-toast';
import { PinnedPopover } from '@/components/csmju/pinned-popover';
import { ManageRoomDialog } from '@/components/csmju/room-dialogs';
import { RoomPopover } from '@/components/csmju/room-popover';
import { UserPopover } from '@/components/csmju/user-popover';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError, qs, type Page } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import {
  bindSocket,
  connectSocket,
  emitWithAck,
  forgetRoom,
  onSocketReconnect,
  onSocketStatus,
  rememberRoom,
} from '@/lib/csmju/socket';
import type { Channel, Message, ReactionSummary, SearchHit } from '@/lib/csmju/types';
import {
  PENDING_SEQ,
  buildTimelineRows,
  firstUnreadId,
  keepChipOrder,
  mergeReactionBroadcast,
  newNonce,
  replacePending,
  stampLabel,
  toggleReactionLocally,
  type ReactionBroadcast,
} from './chat-logic';
import { isStaffLike } from '@/lib/csmju/roles';

const PAGE_SIZE = 50;
const MEMBERS_PREF = 'csmju:room-members-open';

function readMembersPref(): boolean {
  try {
    return window.localStorage.getItem(MEMBERS_PREF) !== '0';
  } catch {
    return true;
  }
}

function writeMembersPref(open: boolean) {
  try {
    window.localStorage.setItem(MEMBERS_PREF, open ? '1' : '0');
  } catch {
    // จำไม่ได้ก็แค่เปิดตามค่าเริ่มต้นครั้งหน้า
  }
}

/// ช่องข้อความแบบ Discord — หัวห้อง · ไทม์ไลน์ · ช่องพิมพ์ · แผงสมาชิก
export function TextChannel({
  channel,
  rooms,
  hiddenOnMobile,
  onBack,
  onRead,
  onUpdated,
  onDeleted,
  onOpenChannel,
}: {
  channel: Channel;
  /// ห้องทั้งหมดในแถบซ้าย — ใช้บอกชื่อห้องในผลค้นหา
  rooms: Channel[];
  hiddenOnMobile: boolean;
  onBack: () => void;
  onRead: () => void;
  onUpdated: (channel: Pick<Channel, 'id' | 'name' | 'description'> & { muted?: boolean }) => void;
  onDeleted: (channelId: string, byMe: boolean) => void;
  /// เปิดห้องอื่นจากผลค้นหา (พร้อมข้อความที่จะเลื่อนไปหา)
  onOpenChannel: (channelId: string, messageId?: string) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedPages, setLoadedPages] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState(true);
  const [reactions, setReactions] = useState<Record<string, ReactionSummary | null>>({});
  const [typing, setTyping] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [threadOf, setThreadOf] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // ทั้งแอปวาดฝั่ง client หลังรู้ตัวผู้ใช้แล้ว (SessionProvider) จึงอ่าน window ได้เลย
  const [membersOpen, setMembersOpen] = useState(
    () =>
      typeof window === 'undefined' ||
      (readMembersPref() &&
        (typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1024px)').matches)),
  );
  const [panel, setPanel] = useState<'pins' | 'threads' | null>(null);
  const [userCard, setUserCard] = useState<{ id: string; rect: DOMRect; nickname: string | null } | null>(null);
  const [draft, setDraft] = useState('');
  const [picking, setPicking] = useState(false);
  const attachments = useAttachments();

  /// เส้น "ใหม่" — จับยอดยังไม่อ่านไว้ตอนเปิดห้องครั้งเดียว ไม่ขยับตามที่อ่านไป
  const [unreadAtOpen] = useState(channel.unreadCount);

  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const pinsRef = useRef<HTMLButtonElement | null>(null);
  const threadsRef = useRef<HTMLButtonElement | null>(null);
  const emojiRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingJump = useRef<string | null>(null);

  const onUpdatedRef = useRef(onUpdated);
  const onDeletedRef = useRef(onDeleted);
  const onReadRef = useRef(onRead);

  useEffect(() => {
    onUpdatedRef.current = onUpdated;
    onDeletedRef.current = onDeleted;
    onReadRef.current = onRead;
  });

  // ── โหลดประวัติ + ข้อความที่ปักหมุด ──
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [history, pins] = await Promise.all([
          api.list<Message>(`/channels/${channel.id}/messages?limit=${PAGE_SIZE}`),
          api.list<Message>(`/channels/${channel.id}/messages/pinned`).catch(() => null),
        ]);

        if (cancelled) return;

        // หลังบ้านคืนใหม่ไปเก่า — กลับด้านให้อ่านตามเวลา
        setMessages([...history.items].reverse());
        setLoadedPages(1);
        setTotalPages(history.meta.totalPages);
        setPinned(pins?.items ?? []);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'โหลดข้อความไม่สำเร็จ');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPinnedLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel.id]);

  // ── socket ──
  useEffect(() => {
    let cancelled = false;
    const unbind: (() => void)[] = [];

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        socketRef.current = socket;

        const result = await emitWithAck<{ ok: boolean; error?: string }>(socket, 'channel:join', {
          channelId: channel.id,
        });

        if (cancelled) return;

        if (!result.ok) {
          setStatus('offline');
          setError(result.error ?? 'เข้าห้องไม่สำเร็จ');

          return;
        }

        setStatus('live');
        rememberRoom(channel.id);

        unbind.push(
          bindSocket<Message>(socket, 'message:new', (message) => {
            if (message.channelId !== channel.id) return;
            setMessages((prev) => replacePending(prev, message));
          }),
          bindSocket<{ channelId: string; messageId: string }>(socket, 'message:deleted', (payload) => {
            if (payload.channelId !== channel.id) return;
            setMessages((prev) => prev.filter((row) => row.id !== payload.messageId));
            setPinned((prev) => prev.filter((row) => row.id !== payload.messageId));
          }),
          bindSocket<Message>(socket, 'message:edited', (message) => {
            if (message.channelId !== channel.id) return;
            setMessages((prev) => prev.map((row) => (row.id === message.id ? message : row)));
            setPinned((prev) => prev.map((row) => (row.id === message.id ? message : row)));
          }),
          bindSocket<Message>(socket, 'message:pinned', (message) => {
            if (message.channelId !== channel.id) return;
            setMessages((prev) => prev.map((row) => (row.id === message.id ? message : row)));
            setPinned((prev) =>
              message.pinnedAt
                ? [message, ...prev.filter((row) => row.id !== message.id)]
                : prev.filter((row) => row.id !== message.id),
            );
          }),
          bindSocket<ReactionBroadcast & { channelId: string }>(socket, 'reaction:changed', (payload) => {
            if (payload.channelId !== channel.id) return;
            setReactions((prev) => ({
              ...prev,
              [payload.targetId]: keepChipOrder(
                prev[payload.targetId],
                mergeReactionBroadcast(prev[payload.targetId], payload, me.id),
              ),
            }));
          }),
          bindSocket<{ channelId: string; parentId: string }>(socket, 'thread:updated', (payload) => {
            if (payload.channelId !== channel.id) return;
            setMessages((prev) =>
              prev.map((row) =>
                row.id === payload.parentId ? { ...row, replyCount: row.replyCount + 1 } : row,
              ),
            );
          }),
          bindSocket<{ channelId: string; name: string | null; description: string | null }>(
            socket,
            'channel:updated',
            (payload) => {
              if (payload.channelId !== channel.id) return;
              onUpdatedRef.current({ id: payload.channelId, name: payload.name, description: payload.description });
            },
          ),
          bindSocket<{ channelId: string; deletedByCoreUserId: string }>(
            socket,
            'channel:deleted',
            (payload) => {
              if (payload.channelId !== channel.id) return;
              forgetRoom(channel.id);
              onDeletedRef.current(channel.id, payload.deletedByCoreUserId === me.id);
            },
          ),
          bindSocket<{ channelId: string; coreUserId: string }>(socket, 'typing:sync', (payload) => {
            if (payload.channelId !== channel.id) return;
            setTyping((prev) => (prev.includes(payload.coreUserId) ? prev : [...prev, payload.coreUserId]));
            setTimeout(() => setTyping((prev) => prev.filter((id) => id !== payload.coreUserId)), 2500);
          }),
          onSocketStatus((next) =>
            setStatus(next === 'connected' ? 'live' : next === 'offline' ? 'offline' : 'connecting'),
          ),
          // ต่อกลับมาได้ = ดึงข้อความที่พลาดไประหว่างหลุด
          onSocketReconnect(() => {
            void api
              .list<Message>(`/channels/${channel.id}/messages?limit=${PAGE_SIZE}`)
              .then((history) => setMessages([...history.items].reverse()))
              .catch(() => undefined);
          }),
        );
      } catch {
        if (!cancelled) setStatus('offline');
      }
    })();

    return () => {
      cancelled = true;
      forgetRoom(channel.id);
      socketRef.current?.emit('channel:leave', { channelId: channel.id });

      // ถอดเฉพาะ handler ของหน้าจอนี้ — socket ใช้ร่วมกันทั้งแอป
      for (const off of unbind) off();
    };
  }, [channel.id, me.id]);

  const timeline = useMemo(() => messages.filter((row) => row.parentId === null), [messages]);
  const unreadId = useMemo(() => firstUnreadId(timeline, unreadAtOpen), [timeline, unreadAtOpen]);
  const rows = useMemo(() => buildTimelineRows(timeline, unreadId), [timeline, unreadId]);

  // ── เลื่อนลงล่างเมื่อมีข้อความใหม่ (ถ้าผู้ใช้อยู่ล่างสุดอยู่แล้ว) ──
  const firstScroll = useRef(true);

  useEffect(() => {
    const box = scrollRef.current;

    if (!box || loading) return;

    if (firstScroll.current) {
      firstScroll.current = false;

      // เปิดห้องที่มีข้อความยังไม่อ่าน → ไปที่เส้น "ใหม่" แบบ Discord
      const divider = box.querySelector('[data-unread-divider]');

      if (divider) {
        (divider as HTMLElement).scrollIntoView({ block: 'center' });

        return;
      }
    }

    if (stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [rows, loading]);

  // ── บันทึกหมุดอ่าน ──
  useEffect(() => {
    // ต้องข้ามข้อความชั่วคราว — seq ของมันล้นคอลัมน์ Int แล้วหลังบ้านตอบ 500
    const latest = messages.filter((row) => row.seq !== PENDING_SEQ).at(-1);

    if (!latest) return;

    void api
      .post(`/channels/${channel.id}/read-markers`, { seq: latest.seq })
      .then(() => onReadRef.current())
      .catch(() => undefined);
  }, [messages, channel.id]);

  // ── ยอดรีแอ็กชันของข้อความที่เห็น (คำขอเดียวต่อชุด) ──
  useEffect(() => {
    const missing = messages
      .filter((row) => !row.id.startsWith('pending-') && reactions[row.id] === undefined)
      .slice(-100);

    if (missing.length === 0) return;

    const fill = (summaries: ReactionSummary[]) =>
      setReactions((prev) => {
        const next = { ...prev };

        for (const message of missing) {
          if (next[message.id] === undefined) {
            next[message.id] = summaries.find((row) => row.targetId === message.id) ?? null;
          }
        }

        return next;
      });

    void api
      .get<ReactionSummary[]>(
        `/reactions/summaries${qs({ targetKind: 'MESSAGE', targetIds: missing.map((row) => row.id).join(',') })}`,
      )
      .then(fill)
      .catch(() => fill([]));
  }, [messages, reactions]);

  // ── ไปที่ข้อความ (จากหมุด ผลค้นหา หรือกล่องตอบกลับ) ──
  const jumpTo = useCallback(
    (messageId: string) => {
      const node = document.getElementById(`message-${messageId}`);

      if (!node) {
        if (!loading) showToast('ข้อความนี้เก่ากว่าที่โหลดไว้ — เลื่อนขึ้นเพื่อโหลดก่อนหน้า', 'error');
        else pendingJump.current = messageId;

        return;
      }

      stickToBottom.current = false;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(messageId);
      setTimeout(() => setHighlight((current) => (current === messageId ? null : current)), 2000);
    },
    [loading],
  );

  // ห้องที่เปิดจากผลค้นหา — รอโหลดเสร็จก่อนค่อยเลื่อนไปหา
  useEffect(() => {
    if (loading) return;

    const params = new URLSearchParams(window.location.search);
    const target = pendingJump.current ?? params.get('message');

    if (target) {
      pendingJump.current = null;
      requestAnimationFrame(() => jumpTo(target));
    }
  }, [loading, jumpTo]);

  async function loadOlder() {
    if (loadingOlder || loadedPages >= totalPages) return;

    const box = scrollRef.current;
    const before = box ? box.scrollHeight - box.scrollTop : 0;

    setLoadingOlder(true);

    try {
      const page: Page<Message> = await api.list<Message>(
        `/channels/${channel.id}/messages?limit=${PAGE_SIZE}&page=${loadedPages + 1}`,
      );

      setMessages((prev) => {
        const known = new Set(prev.map((row) => row.id));

        return [...[...page.items].reverse().filter((row) => !known.has(row.id)), ...prev];
      });
      setLoadedPages((n) => n + 1);
      setTotalPages(page.meta.totalPages);

      // คงตำแหน่งที่อ่านอยู่ ไม่ให้กระโดดขึ้นบนสุด
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight - before;
      });
    } catch (caught) {
      showToast(caught instanceof ApiError ? caught.message : 'โหลดข้อความก่อนหน้าไม่สำเร็จ', 'error');
    } finally {
      setLoadingOlder(false);
    }
  }

  // ── การทำงานกับข้อความ ──
  const reactionsRef = useRef(reactions);

  useEffect(() => {
    reactionsRef.current = reactions;
  });

  const actions: MessageActions = useMemo(
    () => ({
      onToggleReaction: (message, emoji, mine) => {
        const target = { targetKind: 'MESSAGE' as const, targetId: message.id };
        const before = reactionsRef.current[message.id] ?? null;

        // ชิปเปลี่ยนทันที แล้วค่อยยืนยันด้วยยอดจริงจากหลังบ้าน
        setReactions((prev) => ({
          ...prev,
          [message.id]: toggleReactionLocally(prev[message.id], target, emoji, mine),
        }));

        const request = mine
          ? api.del<ReactionSummary>(`/reactions${qs({ ...target, emoji })}`)
          : api.post<ReactionSummary>('/reactions', { ...target, emoji });

        void request
          .then((summary) => {
            if (summary && Array.isArray(summary.totals)) {
              setReactions((prev) => ({ ...prev, [message.id]: keepChipOrder(prev[message.id], summary) }));
            }
          })
          .catch((caught: unknown) => {
            setReactions((prev) => ({ ...prev, [message.id]: before }));
            showToast(caught instanceof ApiError ? caught.message : 'รีแอ็กชันไม่สำเร็จ', 'error');
          });
      },
      onReply: (message) => {
        setReplyTo(message);
        inputRef.current?.focus();
      },
      onThread: (message) => setThreadOf(message),
      onForward: (message) => setForwarding(message),
      onEdit: async (message, content) => {
        await api.patch(`/channels/${channel.id}/messages/${message.id}`, { content });
      },
      onTogglePin: (message) => {
        const path = `/channels/${channel.id}/messages/${message.id}/pin`;

        void (message.pinnedAt ? api.del(path) : api.put(path))
          .then(() => showToast(message.pinnedAt ? 'ถอนหมุดแล้ว' : 'ปักหมุดข้อความแล้ว'))
          .catch((caught: unknown) =>
            showToast(caught instanceof ApiError ? caught.message : 'ปักหมุดไม่สำเร็จ', 'error'),
          );
      },
      onDelete: (message) => {
        if (!window.confirm('ลบข้อความนี้? ลบแล้วกู้คืนไม่ได้')) return;

        void api
          .del(`/channels/${channel.id}/messages/${message.id}`)
          .catch((caught: unknown) =>
            showToast(caught instanceof ApiError ? caught.message : 'ลบไม่สำเร็จ', 'error'),
          );
      },
      onCopy: (message) => {
        void navigator.clipboard
          .writeText(message.content ?? '')
          .then(() => showToast('คัดลอกแล้ว'))
          .catch(() => showToast('คัดลอกไม่สำเร็จ', 'error'));
      },
      onJump: jumpTo,
      onOpenUser: (coreUserId, rect) => setUserCard({ id: coreUserId, rect, nickname: null }),
    }),
    [channel.id, jumpTo],
  );

  // ── ส่งข้อความ ──
  async function send(parentId: string | null = null, text = draft) {
    const content = text.trim();
    const useAttachments = parentId === null;
    const assetIds = useAttachments ? attachments.assets.map((asset) => asset.assetId) : [];

    if (!content && assetIds.length === 0) return;

    if (useAttachments && attachments.uploading) {
      setError('ยังอัปโหลดไฟล์ไม่เสร็จ — รอสักครู่');

      return;
    }

    const nonce = newNonce();
    const reply = parentId === null ? replyTo : null;
    const payload = {
      channelId: channel.id,
      ...(content ? { content } : {}),
      ...(assetIds.length ? { assetIds: assetIds } : {}),
      clientNonce: nonce,
      ...(parentId ? { parentId: parentId } : {}),
      ...(reply ? { replyToMessageId: reply.id } : {}),
    };

    const pending: Message = {
      id: `pending-${nonce}`,
      seq: PENDING_SEQ,
      clientNonce: nonce,
      content: content || null,
      channelId: channel.id,
      authorCoreUserId: me.id,
      parentId: parentId,
      replyCount: 0,
      pinnedAt: null,
      pinnedByCoreUserId: null,
      editedAt: null,
      attachments: useAttachments
        ? attachments.assets.map((asset) => ({
            id: asset.assetId,
            fileName: asset.fileName,
            kind: asset.kind,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
          }))
        : [],
      embed: null,
      replyTo: reply
        ? {
            id: reply.id,
            authorCoreUserId: reply.authorCoreUserId,
            preview: reply.content?.slice(0, 120) ?? null,
            attachmentKind: null,
            deleted: false,
          }
        : null,
      createdAt: new Date().toISOString(),
    };

    stickToBottom.current = true;
    setMessages((prev) => [...prev, pending]);

    if (parentId === null) {
      setDraft('');
      setReplyTo(null);
      attachments.clear();
    }

    setError(null);

    const drop = () => setMessages((prev) => prev.filter((row) => row.id !== pending.id));
    const socket = socketRef.current;

    try {
      if (socket?.connected) {
        const result = await emitWithAck<{ ok: boolean; error?: string }>(socket, 'message:send', payload);

        if (!result.ok) {
          setError(result.error ?? 'ส่งไม่สำเร็จ');
          if (parentId === null) setDraft(content);
          drop();
        }

        return;
      }

      // socket ต่อไม่ได้ก็ยังส่งได้ทาง REST
      const message = await api.post<Message>(`/channels/${channel.id}/messages`, payload);

      setMessages((prev) => replacePending(prev, message));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งไม่สำเร็จ');
      if (parentId === null) setDraft(content);
      drop();
    }
  }

  const canPin = channel.myRole === 'MODERATOR' || isStaffLike(me.coreRole);
  const canModerate = channel.myRole === 'MODERATOR' || me.coreRole === 'admin';
  const threads = timeline.filter((row) => row.replyCount > 0).reverse();
  const name = channel.name ?? 'ห้องไม่มีชื่อ';

  async function toggleMute() {
    const muted = !channel.muted;

    try {
      await api.patch(`/channels/${channel.id}/inbox`, { muted });
      onUpdated({ id: channel.id, name: channel.name, description: channel.description, muted });
      showToast(muted ? 'ปิดการแจ้งเตือนของห้องนี้แล้ว' : 'เปิดการแจ้งเตือนของห้องนี้แล้ว');
    } catch (caught) {
      showToast(caught instanceof ApiError ? caught.message : 'ตั้งค่าการแจ้งเตือนไม่สำเร็จ', 'error');
    }
  }

  return (
    <div className={`flex min-w-0 flex-1 ${hiddenOnMobile ? 'max-md:hidden' : ''}`}>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* ── หัวห้อง ── */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 shadow-csmju-xs">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            aria-label="กลับไปที่รายการห้อง"
          >
            <ChevronLeft className="size-5" />
          </button>

          <Hash className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="truncate text-[15px] font-semibold">{name}</h2>

          {channel.description && (
            <>
              <span className="mx-1 h-6 w-px shrink-0 bg-border max-md:hidden" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground max-md:hidden" title={channel.description}>
                {channel.description}
              </p>
            </>
          )}
          {!channel.description && <span className="flex-1" />}

          {status !== 'live' && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                status === 'connecting' ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'
              }`}
            >
              {status === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'ออฟไลน์ (ส่งผ่าน REST)'}
            </span>
          )}

          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderButton
              ref={threadsRef}
              label="เธรด"
              active={panel === 'threads'}
              onClick={() => setPanel((p) => (p === 'threads' ? null : 'threads'))}
            >
              <MessagesSquare className="size-5" />
            </HeaderButton>
            <HeaderButton
              label={channel.muted ? 'เปิดการแจ้งเตือน' : 'ปิดการแจ้งเตือน'}
              active={channel.muted}
              onClick={() => void toggleMute()}
            >
              {channel.muted ? <BellOff className="size-5" /> : <Bell className="size-5" />}
            </HeaderButton>
            <HeaderButton
              ref={pinsRef}
              label="ข้อความที่ปักหมุด"
              active={panel === 'pins'}
              onClick={() => setPanel((p) => (p === 'pins' ? null : 'pins'))}
            >
              <Pin className="size-5" />
            </HeaderButton>
            <HeaderButton
              label={membersOpen ? 'ซ่อนรายชื่อสมาชิก' : 'แสดงรายชื่อสมาชิก'}
              active={membersOpen}
              onClick={() =>
                setMembersOpen((open) => {
                  writeMembersPref(!open);

                  return !open;
                })
              }
            >
              <Users className="size-5" />
            </HeaderButton>
            {channel.canManage && (
              <ManageRoomDialog
                channel={channel}
                onUpdated={onUpdated}
                onDeleted={(channelId) => {
                  forgetRoom(channelId);
                  onDeleted(channelId, true);
                }}
              />
            )}
          </div>

          <RoomSearch
            rooms={rooms}
            onOpen={(id, messageId) =>
              id === channel.id && messageId ? jumpTo(messageId) : onOpenChannel(id, messageId)
            }
          />
        </header>

        <PinnedPopover
          open={panel === 'pins'}
          onClose={() => setPanel(null)}
          anchor={{ ref: pinsRef }}
          pinned={pinned}
          loading={pinnedLoading}
          canPin={canPin}
          onJump={(message) => jumpTo(message.id)}
          onUnpin={(message) => actions.onTogglePin(message)}
        />

        <RoomPopover
          open={panel === 'threads'}
          onClose={() => setPanel(null)}
          anchor={{ ref: threadsRef }}
          width={380}
          label="เธรด"
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="flex-1 text-sm font-semibold">เธรด</h2>
          </header>
          {threads.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              ยังไม่มีเธรดในข้อความที่โหลดไว้ — ชี้ที่ข้อความ กด ⋯ แล้วเลือก “สร้างเธรด”
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {threads.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setThreadOf(message);
                      setPanel(null);
                    }}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                  >
                    <Avatar coreUserId={message.authorCoreUserId} size={24} showOnline={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{message.content ?? 'ไฟล์แนบ'}</span>
                      <span className="text-xs text-primary">{message.replyCount} คำตอบ</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RoomPopover>

        {/* ── ไทม์ไลน์ ── */}
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const box = event.currentTarget;

            stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto pb-4"
        >
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> กำลังโหลดข้อความ…
            </p>
          ) : (
            <>
              {loadedPages < totalPages ? (
                <div className="flex justify-center py-3">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {loadingOlder ? 'กำลังโหลด…' : 'โหลดข้อความก่อนหน้า'}
                  </button>
                </div>
              ) : (
                <ChannelWelcome channel={channel} />
              )}

              {rows.map((row) =>
                row.type === 'date' ? (
                  <div key={row.key} role="separator" className="mx-4 mb-1 mt-5 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-semibold text-muted-foreground">{row.label}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : row.type === 'unread' ? (
                  <div
                    key={row.key}
                    data-unread-divider=""
                    role="separator"
                    aria-label="ข้อความใหม่"
                    className="relative mx-4 my-2 flex items-center"
                  >
                    <span className="h-px flex-1 bg-destructive" />
                    <span className="rounded-sm bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
                      ใหม่
                    </span>
                  </div>
                ) : (
                  <ChannelMessage
                    key={row.key}
                    channelId={channel.id}
                    message={row.message}
                    grouped={row.grouped}
                    reactions={reactions[row.message.id] ?? null}
                    isMine={row.message.authorCoreUserId === me.id}
                    canPin={canPin}
                    canDelete={row.message.authorCoreUserId === me.id || canModerate}
                    highlighted={highlight === row.message.id}
                    actions={actions}
                  />
                ),
              )}
            </>
          )}
        </div>

        {/* ── ช่องพิมพ์ ── */}
        <div className="shrink-0 px-4 pb-4">
          {typing.length > 0 && <TypingLine ids={typing} />}

          {error && <p className="mb-1 text-xs text-destructive">{error}</p>}

          <div className="rounded-lg bg-muted">
            {replyTo && (
              <div className="flex items-center gap-2 rounded-t-lg border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  กำลังตอบกลับ <ReplyName coreUserId={replyTo.authorCoreUserId} />
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="ยกเลิกการตอบกลับ"
                  className="grid size-5 place-items-center rounded-full hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            <div className="px-2">
              <AttachmentTray attachments={attachments} />
            </div>

            <div className="flex items-end gap-1 px-2 py-1.5">
              <AttachmentButton attachments={attachments} />

              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  socketRef.current?.emit('typing:start', { channelId: channel.id });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                  if (event.key === 'Escape' && replyTo) setReplyTo(null);
                }}
                placeholder={`ส่งข้อความใน #${name}`}
                aria-label={`ส่งข้อความใน #${name}`}
                className="max-h-48 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-5 outline-none [field-sizing:content] placeholder:text-muted-foreground"
              />

              <button
                ref={emojiRef}
                type="button"
                onClick={() => setPicking((open) => !open)}
                aria-expanded={picking}
                aria-label="ใส่อีโมจิ"
                className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <SmilePlus className="size-5" />
              </button>

              <button
                type="button"
                onClick={() => void send()}
                disabled={(!draft.trim() && attachments.assets.length === 0) || attachments.uploading}
                aria-label="ส่งข้อความ"
                className="grid size-9 shrink-0 place-items-center rounded-md text-primary transition-opacity disabled:opacity-30"
              >
                <Send className="size-5" />
              </button>

              <EmojiPopover
                anchorRef={emojiRef}
                open={picking}
                onClose={() => setPicking(false)}
                onPick={(emoji) => {
                  setDraft((value) => value + emoji);
                  inputRef.current?.focus();
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {threadOf && (
        <ThreadPanel
          key={threadOf.id}
          channelId={channel.id}
          parent={threadOf}
          live={messages.filter((row) => row.parentId === threadOf.id)}
          onClose={() => setThreadOf(null)}
          onSend={(text) => send(threadOf.id, text)}
        />
      )}

      {membersOpen && !threadOf && (
        <MemberList
          channelId={channel.id}
          onOpenUser={(id, rect, nickname) => setUserCard({ id, rect, nickname })}
        />
      )}

      {userCard && (
        <UserPopover
          open
          coreUserId={userCard.id}
          nickname={userCard.nickname}
          anchor={{ rect: userCard.rect }}
          onClose={() => setUserCard(null)}
        />
      )}

      <ForwardDialog
        message={forwarding}
        onClose={() => {
          setForwarding(null);
          void queryClient.invalidateQueries({ queryKey: ['channels', 'mine'] });
        }}
      />
    </div>
  );
}

function HeaderButton({
  ref,
  label,
  active = false,
  onClick,
  children,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid size-8 place-items-center rounded-md transition-colors hover:text-foreground ${
        active ? 'text-foreground' : 'text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function ReplyName({ coreUserId }: { coreUserId: string }) {
  return <strong className="font-semibold text-foreground">{useProfile(coreUserId).displayName}</strong>;
}

function TypingName({ coreUserId }: { coreUserId: string }) {
  return <strong className="font-semibold">{useProfile(coreUserId).displayName}</strong>;
}

function TypingLine({ ids }: { ids: string[] }) {
  return (
    <p className="mb-1 text-xs text-muted-foreground">
      {ids.slice(0, 3).map((id, index) => (
        <span key={id}>
          {index > 0 && ', '}
          <TypingName coreUserId={id} />
        </span>
      ))}{' '}
      กำลังพิมพ์…
    </p>
  );
}

/// หัวไทม์ไลน์ตอนเลื่อนถึงข้อความแรกของห้อง — "ยินดีต้อนรับสู่ #ชื่อห้อง!"
function ChannelWelcome({ channel }: { channel: Channel }) {
  const creator = useProfile(channel.createdByCoreUserId ?? '');

  return (
    <div className="px-4 pb-2 pt-8">
      <span className="mb-3 grid size-16 place-items-center rounded-full bg-muted">
        <Hash className="size-9" aria-hidden />
      </span>
      <h3 className="text-2xl font-bold">ยินดีต้อนรับสู่ #{channel.name ?? 'ห้องนี้'}!</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        นี่คือจุดเริ่มต้นของห้อง #{channel.name ?? ''}
        {channel.createdByCoreUserId && ` · สร้างโดย ${creator.displayName}`}
        {channel.description && ` · ${channel.description}`}
      </p>
    </div>
  );
}

/// ค้นหาข้อความในทุกห้องของหน้า "ห้อง" — คลิกผลแล้วพาไปที่ห้องและข้อความนั้น
function RoomSearch({
  rooms,
  onOpen,
}: {
  rooms: Channel[];
  onOpen: (channelId: string, messageId?: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | null>(null);
  const roomIds = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  async function run() {
    const query = q.trim();

    if (query.length < 2) {
      setError('พิมพ์อย่างน้อย 2 ตัวอักษร');
      setHits(null);
      setOpen(true);

      return;
    }

    setError(null);
    setHits(null);
    setOpen(true);

    try {
      const page = await api.list<SearchHit>(`/search${qs({ q: query, kind: 'messages', limit: 50 })}`);

      setHits(page.items.filter((hit) => hit.channelId && roomIds.has(hit.channelId)));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ค้นหาไม่สำเร็จ');
    }
  }

  const now = new Date();

  return (
    <div className="relative ml-1 shrink-0 max-sm:hidden">
      <input
        ref={ref}
        value={q}
        onChange={(event) => setQ(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void run();
        }}
        placeholder="ค้นหา"
        aria-label="ค้นหาข้อความในห้อง"
        className="h-7 w-36 rounded-md bg-muted pl-2 pr-7 text-sm outline-none transition-[width] focus:w-56 focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Search className="pointer-events-none absolute right-2 top-1.5 size-4 text-muted-foreground" aria-hidden />

      <RoomPopover open={open} onClose={() => setOpen(false)} anchor={{ ref }} width={400} label="ผลการค้นหา">
        <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">
          {hits ? `ผลการค้นหา ${hits.length} รายการ` : 'ค้นหาข้อความ'}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <p className="px-2 py-4 text-sm text-destructive">{error}</p>}
          {!error && hits === null && (
            <p className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> กำลังค้นหา…
            </p>
          )}
          {hits?.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">ไม่พบข้อความที่ตรงกับคำค้น</p>
          )}
          {hits?.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen(hit.channelId!, hit.id);
              }}
              className="mb-1 flex w-full items-start gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent"
            >
              {hit.authorCoreUserId && (
                <Avatar coreUserId={hit.authorCoreUserId} size={28} showOnline={false} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-muted-foreground">
                  #{roomIds.get(hit.channelId!)?.name ?? ''}
                  {hit.createdAt && ` · ${stampLabel(hit.createdAt, now)}`}
                </span>
                <span className="block break-words text-sm">{hit.snippet ?? hit.title}</span>
              </span>
            </button>
          ))}
        </div>
      </RoomPopover>
    </div>
  );
}

/// เธรดของข้อความหนึ่ง — คำตอบไม่ขึ้นไทม์ไลน์หลัก และเธรดซ้อนเธรดไม่ได้
function ThreadPanel({
  channelId,
  parent,
  live,
  onClose,
  onSend,
}: {
  channelId: string;
  parent: Message;
  /// คำตอบที่มาทาง socket หลังเปิดเธรด
  live: Message[];
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [loaded, setLoaded] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const now = new Date();

  useEffect(() => {
    let cancelled = false;

    void api
      .list<Message>(`/channels/${channelId}/messages/${parent.id}/thread?limit=50`)
      .then((page) => {
        if (!cancelled) setLoaded(page.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, parent.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-room-popover]')) onClose();
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const replies = useMemo(() => {
    let list = [...loaded];

    for (const message of live) list = replacePending(list, message);

    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [loaded, live]);

  return (
    <aside
      aria-label="เธรด"
      className="flex w-96 shrink-0 flex-col border-l border-border bg-background max-xl:fixed max-xl:inset-0 max-xl:z-50 max-xl:w-full max-xl:border-l-0"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <MessagesSquare className="size-5 text-muted-foreground" aria-hidden />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          เธรด · {parent.content?.slice(0, 40) ?? 'ไฟล์แนบ'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดเธรด"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <ThreadRow message={parent} now={now} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {replies.length} คำตอบ
          <span className="h-px flex-1 bg-border" />
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> กำลังโหลด…
          </p>
        ) : replies.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีคำตอบ — พิมพ์ในช่องด้านล่างเพื่อเริ่ม</p>
        ) : (
          replies.map((reply) => <ThreadRow key={reply.id} message={reply} now={now} />)
        )}
      </div>

      <div className="shrink-0 px-4 pb-4">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && draft.trim()) {
              event.preventDefault();
              const text = draft;

              setDraft('');
              void onSend(text);
            }
          }}
          placeholder="ตอบในเธรด…"
          aria-label="ตอบในเธรด"
          className="w-full rounded-lg bg-muted px-3 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </aside>
  );
}

function ThreadRow({ message, now }: { message: Message; now: Date }) {
  const author = useProfile(message.authorCoreUserId);

  return (
    <div className={`flex items-start gap-3 ${message.id.startsWith('pending-') ? 'opacity-60' : ''}`}>
      <Avatar coreUserId={message.authorCoreUserId} size={32} showOnline={false} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{author.displayName}</span>
          <span className="text-[11px] text-muted-foreground">{stampLabel(message.createdAt, now)}</span>
        </p>
        {message.content && <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>}
      </div>
    </div>
  );
}
