'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import {
  ChevronLeft,
  Info,
  Loader2,
  Maximize2,
  Phone,
  Pin,
  Video,
  X,
} from 'lucide-react';
import { useAttachments } from '@/components/csmju/attachment-picker';
import { useCall } from '@/components/csmju/call-provider';
import { Composer } from '@/components/csmju/direct-composer';
import { BlockedBar, InfoPanel, useMyBlocks } from '@/components/csmju/direct-info';
import { ForwardDialog } from '@/components/csmju/direct-forward';
import {
  isPending,
  MessageList,
  messagePreview,
  TypingRow,
  type MessageAction,
} from '@/components/csmju/direct-message';
import { uploadVoice, type VoiceClip } from '@/components/csmju/direct-voice';
import {
  CHANNELS_KEY,
  ConversationAvatar,
  ConversationName,
  othersOf,
  peerOf,
  RequestActions,
  sortInbox,
} from '@/components/csmju/inbox-list';
import { ConfirmDialog } from '@/components/csmju/messages-menu';
import { showToast, ToastHost } from '@/components/csmju/messages-toast';
import { useOnline } from '@/components/csmju/user-badge';
import { useProfile } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
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
import { igAgo } from '@/lib/csmju/time';
import { uploadFile, type UploadedAsset } from '@/lib/csmju/upload';
import type { Channel, Message, ReactionSummary } from '@/lib/csmju/types';
import { isStaffLike } from '@/lib/csmju/roles';

/// บทสนทนาส่วนตัวแบบ Instagram Direct — หัว · ข้อความ · ช่องพิมพ์
///
/// แยกจากหน้า /messages เพราะมีสองที่ที่วาดบทสนทนาเดียวกัน: คอลัมน์ขวาของ
/// หน้าข้อความ (`variant="page"`) และหน้าต่างแชทลอยขนาด ~360×480 มุมขวาล่าง
/// (`variant="dock"`) — ตรรกะส่ง/รับ/อ่าน/รีแอ็กชันต้องเป็นชุดเดียวกัน
/// ไม่งั้นแก้บั๊กที่หนึ่งแล้วอีกที่ยังพังอยู่
///
/// ใช้ได้ทั้งแชทส่วนตัว (DM) และแชทกลุ่ม (GROUP_DM) · ทุกอย่างบนจอมาจากหลังบ้าน
/// จริง ไม่มีแถวตัวอย่าง — "ส่งแล้ว" ขึ้นเมื่อเซิร์ฟเวอร์ยืนยันแล้ว และ "เห็นแล้ว"
/// ขึ้นเมื่อ `peerLastReadSeq` ของอีกฝ่ายถึงข้อความนั้นจริง

export type ThreadVariant = 'page' | 'dock';

/// ย้ายไปอยู่ inbox-list.tsx แล้ว (ใช้ร่วมกับเมนูของแถว) — ส่งต่อไว้ให้ที่ import เดิม
export { CHANNELS_KEY };

/// `seq` ของข้อความชั่วคราว — ให้อยู่ท้ายสุดเสมอ แต่ **ห้ามหลุดไปถึงหลังบ้าน**
/// เพราะเกินช่วงของคอลัมน์ Int (ดูที่คัด pending ออกก่อนรายงานการอ่าน)
const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

const PAGE_SIZE = 50;

const newNonce = () =>
  `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/// เอาข้อความจริงไปแทนตัวชั่วคราวที่ `clientNonce` ตรงกัน
///
/// จับคู่ด้วย nonce ไม่ใช่ id เพราะตัวชั่วคราวยังไม่มี id จริง — ถ้าไม่จับคู่
/// ข้อความจะขึ้นสองอัน (ตัวที่วาดเองกับตัวที่เซิร์ฟเวอร์ส่งกลับ) · กันซ้ำด้วย id
/// อีกชั้น เพราะคนส่งได้ทั้ง ack ของ REST และ broadcast ของ socket
///
/// ตรรกะเดียวกับ `replacePending` ของหน้าห้องแชท — ไม่ import จากไฟล์หน้า
/// เพราะจะลากทั้งหน้าห้องแชทเข้ามาในหน้าต่างแชทลอยด้วย
export function replacePending(current: Message[], incoming: Message): Message[] {
  const byNonce = current.findIndex(
    (row) => row.clientNonce === incoming.clientNonce,
  );

  if (byNonce !== -1) {
    const next = [...current];

    next[byNonce] = incoming;

    return next;
  }

  return current.some((row) => row.id === incoming.id)
    ? current
    : [...current, incoming];
}

/// ข้อความใหม่ → ตัวอย่างข้อความของห้องเปลี่ยน แล้วเรียงรายการใหม่
///
/// หลังบ้านเรียงห้องให้อยู่แล้ว (ปักหมุดก่อน แล้วความเคลื่อนไหวล่าสุด) แต่กว่าจะ
/// ดึงรอบหน้าก็อีก 30 วินาที — ระหว่างนั้นรายการซ้ายจะโชว์ข้อความเก่าทั้งที่เพิ่ง
/// คุยกันอยู่ตรงหน้า · เรียงด้วยกติกาเดียวกับหลังบ้าน ห้องที่ปักหมุดจึงยังอยู่บนสุด
export function withIncoming(
  channels: Channel[] | undefined,
  message: Message,
): Channel[] | undefined {
  if (!channels || message.parentId) return channels;

  const index = channels.findIndex((row) => row.id === message.channelId);

  if (index === -1) return channels;

  const current = channels[index];

  // ข้อความที่มาช้ากว่า (เช่นเติมช่วงที่ขาดหลังต่อใหม่) ต้องไม่ทับตัวที่ใหม่กว่า
  if (
    current.lastMessage &&
    current.lastMessage.createdAt > message.createdAt
  ) {
    return channels;
  }

  const updated: Channel = {
    ...current,
    lastMessage: {
      seq: message.seq,
      content: message.content,
      authorCoreUserId: message.authorCoreUserId,
      attachmentCount: message.attachments?.length ?? 0,
      createdAt: message.createdAt,
    },
  };

  return sortInbox(channels.map((row, i) => (i === index ? updated : row)));
}

/// อ่านแล้ว → จุดฟ้าในรายการและตัวเลขบนแถบซ้ายหายพร้อมกัน
export function withRead(
  channels: Channel[] | undefined,
  channelId: string,
): Channel[] | undefined {
  if (!channels) return channels;

  return channels.map((row) =>
    row.id === channelId && row.unreadCount !== 0
      ? { ...row, unreadCount: 0 }
      : row,
  );
}

export function DirectThread({
  channel,
  variant = 'page',
  onBack,
  onClose,
  onExpand,
}: {
  channel: Channel;
  variant?: ThreadVariant;
  /// ปุ่มลูกศรกลับ — หน้าเต็มแสดงเฉพาะจอแคบ · หน้าต่างลอยแสดงเสมอ
  onBack?: () => void;
  /// ปุ่ม X ของหน้าต่างลอย
  onClose?: () => void;
  /// ปุ่มขยายของหน้าต่างลอย (ไปหน้า /messages เต็ม)
  onExpand?: () => void;
}) {
  // key = id ห้อง: เปลี่ยนห้องแล้ว state ทั้งหมด (ข้อความ · ร่าง · ไฟล์แนบ)
  // เริ่มใหม่หมด ไม่ต้องไล่ล้างทีละตัว และไม่มีทางที่ข้อความห้องเก่าจะค้าง
  return (
    <ThreadView
      key={channel.id}
      channel={channel}
      variant={variant}
      onBack={onBack}
      onClose={onClose}
      onExpand={onExpand}
    />
  );
}

type Status = 'connecting' | 'live' | 'offline';

function ThreadView({
  channel,
  variant,
  onBack,
  onClose,
  onExpand,
}: {
  channel: Channel;
  variant: ThreadVariant;
  onBack?: () => void;
  onClose?: () => void;
  onExpand?: () => void;
}) {
  const me = useMe();
  const peer = peerOf(channel, me.id);
  const queryClient = useQueryClient();
  const attachments = useAttachments();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [older, setOlder] = useState<{ page: number; more: boolean }>({
    page: 1,
    more: false,
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reactions, setReactions] = useState<
    Record<string, ReactionSummary | null>
  >({});
  /// ใครกำลังพิมพ์อยู่ (แชทกลุ่มมีได้หลายคน แต่ IG โชว์ทีละคนก็พอ) · null = ไม่มี
  const [typing, setTyping] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  /// ข้อความที่กำลังแก้ (แถบ "กำลังแก้ไขข้อความ" เหนือช่องพิมพ์)
  const [editing, setEditing] = useState<Message | null>(null);
  /// ข้อความที่กำลังตอบกลับ (แถบ "กำลังตอบกลับ …" เหนือช่องพิมพ์)
  const [reply, setReply] = useState<Message | null>(null);
  /// ข้อความที่กำลังจะส่งต่อ (กล่อง "ส่งต่อ")
  const [forwarding, setForwarding] = useState<Message | null>(null);
  /// ข้อความที่รอยืนยัน "ยกเลิกการส่ง"
  const [unsending, setUnsending] = useState<Message | null>(null);
  const [unsendBusy, setUnsendBusy] = useState(false);
  /// ข้อความที่ปักหมุดของห้อง ใหม่สุดก่อน — แถบใต้หัวบทสนทนาโชว์ตัวแรก
  const [pinned, setPinned] = useState<Message[]>([]);
  /// ข้อความที่เพิ่งกระโดดไปหา — ไฮไลต์ชั่วครู่ให้ตาหาเจอ
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /// ติดล่างสุดอยู่ไหม — ถ้าผู้ใช้เลื่อนขึ้นไปอ่านของเก่าอยู่ ข้อความใหม่
  /// และรูปที่โหลดเสร็จต้องไม่กระชากเขากลับลงมา
  const stickRef = useRef(true);
  /// เวลาล่าสุดที่ผู้ใช้ "ตั้งใจเลื่อน" (ล้อเมาส์ · ปัดจอ · คีย์บอร์ด · ลากแถบเลื่อน)
  ///
  /// **บั๊กที่ตัวนี้แก้: เปิดห้องที่มีรูปแล้วข้อความล่าสุดจมอยู่ใต้รูป**
  ///
  /// เดิมตัดสิน "ติดล่างสุด" จากตำแหน่งทุกครั้งที่มี scroll event แต่ scroll
  /// event ไม่ได้มาจากผู้ใช้อย่างเดียว — ตอนรูปโหลดเสร็จแล้วกล่องสูงขึ้น
  /// เบราว์เซอร์ขยับตำแหน่งเอง (scroll anchoring) และบางจังหวะ event นั้นมาถึง
  /// **ก่อน** ResizeObserver ได้ทำงาน ระยะห่างจากล่างสุดตอนนั้นจึงเท่ากับความสูง
  /// ที่รูปเพิ่งงอกออกมาพอดี (วัดได้ 171px ในหน้าต่างแชทลอย) โค้ดเลยสรุปว่า
  /// "ผู้ใช้เลื่อนขึ้นไปแล้ว" แล้วเลิกตามลงล่างทั้งที่ไม่มีใครแตะจอเลย
  ///
  /// ตอนนี้ scroll event ที่ไม่มีความตั้งใจของผู้ใช้นำหน้า **ติด** ล่างสุดได้
  /// แต่ **ปลด** ไม่ได้ — ปลดได้เฉพาะเมื่อผู้ใช้เพิ่งเลื่อนเองจริง ๆ
  const intentRef = useRef(0);
  /// ความสูงก่อนเติมข้อความเก่าไว้บนสุด — ใช้คงตำแหน่งที่อ่านอยู่
  const anchorRef = useRef<number | null>(null);

  /// seq ล่าสุดที่เซิร์ฟเวอร์ยืนยันแล้ว — ตัวชั่วคราวไม่นับ เพราะ seq ของมัน
  /// เกินช่วง Int ของหลังบ้าน (ใช้ทั้งรายงานการอ่านและเติมช่วงที่ขาด)
  const latestSeq = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (!isPending(messages[i])) return messages[i].seq;
    }

    return null;
  }, [messages]);

  const latestIsMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (!isPending(messages[i])) return messages[i].authorCoreUserId === me.id;
    }

    return false;
  }, [messages, me.id]);

  const latestSeqRef = useRef<number | null>(null);

  useEffect(() => {
    latestSeqRef.current = latestSeq;
  }, [latestSeq]);

  const bumpList = useCallback(
    (message: Message) => {
      // ข้อความการโทรมี content = null — ข้อความตัวอย่างในกล่อง ("คุณเริ่มการโทร
      // ด้วยเสียง" ฯลฯ) หลังบ้านเขียนตามมุมของผู้อ่านแต่ละคน ฝั่งเราเดาเองไม่ได้
      // จึงขอรายการห้องใหม่แทนการเขียนตัวอย่างเอง
      if (message.callLog) {
        void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });

        return;
      }

      queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev) => withIncoming(prev, message));
    },
    [queryClient],
  );

  /// ยกเลิกการส่งแล้ว → ขอรายการห้องใหม่
  ///
  /// พบตอนทดสอบกับ Core Hub จริง: ยกเลิกข้อความล่าสุดแล้ว แถวในกล่องข้อความ
  /// ยังโชว์ "คุณ: <ข้อความที่ยกเลิกไปแล้ว>" ทั้งฝั่งผู้ส่งและผู้รับ จนกว่าจะรีเฟรช
  /// ฝั่งเราเดาตัวอย่างใหม่เองไม่ได้ (ข้อความก่อนหน้าอาจยังไม่ได้โหลด) จึงถามหลังบ้าน
  const dropFromList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
  }, [queryClient]);

  // ── เห็นแล้ว ─────────────────────────────────────────────
  //
  // หลังบ้านไม่มี event "อีกฝ่ายอ่านแล้ว" ทาง socket — ถามห้องนี้ซ้ำทุก 8 วินาที
  // **เฉพาะตอนที่ข้อความสุดท้ายเป็นของเราและยังไม่ถูกอ่าน** (DM เท่านั้น) พอขึ้น
  // "เห็นแล้ว" หรือมีคนตอบกลับมาก็หยุดถาม ไม่ยิงหลังบ้านไปเรื่อย ๆ ทั้งที่ไม่มีอะไรเปลี่ยน
  const lastMine = useMemo(() => {
    const last = messages.at(-1);

    return last && !isPending(last) && last.authorCoreUserId === me.id ? last : null;
  }, [messages, me.id]);
  const [seenSeq, setSeenSeq] = useState<number | null>(channel.peerLastReadSeq);
  const peerRead = Math.max(seenSeq ?? -1, channel.peerLastReadSeq ?? -1);
  const waitingForSeen = channel.kind === 'DM' && lastMine !== null && lastMine.seq > peerRead;

  useEffect(() => {
    if (!waitingForSeen) return;

    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;

      void api
        .get<Channel>(`/channels/${channel.id}`)
        .then((fresh) => setSeenSeq(fresh.peerLastReadSeq))
        .catch(() => undefined);
    }, 8000);

    return () => clearInterval(timer);
  }, [waitingForSeen, channel.id]);

  // ── ประวัติ ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    void api
      .list<Message>(`/channels/${channel.id}/messages${qs({ limit: PAGE_SIZE })}`)
      .then((history) => {
        if (cancelled) return;

        setMessages(
          // DM ไม่มีเธรด — คำตอบในเธรด (ถ้ามีจากที่อื่น) ไม่ขึ้นไทม์ไลน์หลัก
          [...history.items].reverse().filter((row) => row.parentId === null),
        );
        setOlder({ page: 1, more: history.meta.totalPages > 1 });
        setLoaded(true);
      })
      .catch((caught) => {
        if (cancelled) return;

        setError(
          caught instanceof ApiError ? caught.message : 'โหลดข้อความไม่สำเร็จ',
        );
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [channel.id]);

  // ── ปักหมุด ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    void api
      .list<Message>(`/channels/${channel.id}/messages/pinned${qs({ limit: 20 })}`)
      .then((page) => {
        // กรองซ้ำฝั่งเรา — แถบนี้ต้องไม่มีทางโชว์ข้อความที่ไม่ได้ปักหมุด
        if (!cancelled) setPinned(page.items.filter((row) => row.pinnedAt));
      })
      .catch(() => {
        // แถบปักหมุดเป็นของเสริม — โหลดไม่ได้ก็แค่ไม่ขึ้นแถบ
      });

    return () => {
      cancelled = true;
    };
  }, [channel.id]);

  /// ปักหรือถอนหมุดแล้ว → แก้ทั้งฟองในไทม์ไลน์และรายการในแถบปักหมุดพร้อมกัน
  const applyPinned = useCallback((message: Message) => {
    setMessages((prev) => prev.map((row) => (row.id === message.id ? { ...row, ...message } : row)));
    setPinned((prev) => {
      const rest = prev.filter((row) => row.id !== message.id);

      return message.pinnedAt
        ? [message, ...rest].sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''))
        : rest;
    });
  }, []);

  async function loadOlder() {
    if (!older.more || loadingOlder) return;

    setLoadingOlder(true);

    try {
      const next = older.page + 1;
      const history = await api.list<Message>(
        `/channels/${channel.id}/messages${qs({ limit: PAGE_SIZE, page: next })}`,
      );

      anchorRef.current = listRef.current?.scrollHeight ?? null;

      // แบ่งหน้าด้วยลำดับ ถ้ามีข้อความใหม่เข้ามาระหว่างนั้น หน้าถัดไปจะเหลื่อม
      // กับที่มีอยู่ไม่กี่แถว — กรองด้วย id กันขึ้นซ้ำ
      setMessages((prev) => {
        const known = new Set(prev.map((row) => row.id));
        const fresh = [...history.items]
          .reverse()
          .filter((row) => row.parentId === null && !known.has(row.id));

        return [...fresh, ...prev];
      });
      setOlder({ page: next, more: history.meta.totalPages > next });
    } catch {
      // โหลดของเก่าพลาดไม่ต้องตะโกน — เลื่อนขึ้นอีกครั้งก็ลองใหม่เอง
    } finally {
      setLoadingOlder(false);
    }
  }

  // ── socket ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const unbind: (() => void)[] = [];
    let typingTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        socketRef.current = socket;

        const joined = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'channel:join',
          { channelId: channel.id },
        );

        if (cancelled) return;

        if (!joined.ok) {
          setStatus('offline');

          return;
        }

        setStatus('live');

        // จำห้องไว้ ไม่งั้นหลังเน็ตกระตุกจะ "ต่อแล้ว" แต่ไม่ได้อยู่ในห้องนี้
        // แล้วข้อความใหม่จะไม่เข้ามาอีกเลย
        rememberRoom(channel.id);

        unbind.push(
          bindSocket<Message>(socket, 'message:new', (message) => {
            if (message.channelId !== channel.id || message.parentId) return;

            setMessages((prev) => replacePending(prev, message));
            bumpList(message);

            // อีกฝ่ายส่งมาแล้ว = เลิกพิมพ์แล้ว ไม่ต้องรอให้จุดสามจุดหมดเวลาเอง
            if (message.authorCoreUserId !== me.id) setTyping(null);
          }),
        );

        // แก้ข้อความ (message:edited) และสถานะการโทรเปลี่ยน (message:updated — รับสาย ·
        // วางสาย · ไม่ได้รับสาย) ส่งข้อความเต็มมาเหมือนกัน → แทนที่ทั้งก้อน
        for (const event of ['message:edited', 'message:updated']) {
          unbind.push(
            bindSocket<Message>(socket, event, (message) => {
              if (message.channelId !== channel.id) return;

              setMessages((prev) =>
                prev.map((row) => (row.id === message.id ? message : row)),
              );
              bumpList(message);
            }),
          );
        }

        unbind.push(
          bindSocket<{ channelId: string; messageId: string }>(
            socket,
            'message:deleted',
            (payload) => {
              if (payload.channelId !== channel.id) return;

              setMessages((prev) =>
                prev.filter((row) => row.id !== payload.messageId),
              );
              setPinned((prev) => prev.filter((row) => row.id !== payload.messageId));
              // ข้อความที่ถูกยกเลิกอาจเป็นตัวอย่างในกล่องข้อความอยู่ — ดูหัวข้อ dropFromList
              dropFromList();
            },
          ),
        );

        // ชื่อเล่นเปลี่ยน (ใครในห้องก็ตั้งได้) → แก้แคชห้องให้ชื่อในบทสนทนาและ
        // แถวในกล่องข้อความเปลี่ยนพร้อมกันทันที
        unbind.push(
          bindSocket<{ channelId: string; nicknames?: Record<string, string> }>(
            socket,
            'channel:updated',
            (payload) => {
              if (payload.channelId !== channel.id || !payload.nicknames) return;

              const nicknames = payload.nicknames;

              queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev) =>
                prev?.map((row) => (row.id === channel.id ? { ...row, nicknames } : row)),
              );
            },
          ),
        );

        unbind.push(
          bindSocket<Message>(socket, 'message:pinned', (message) => {
            if (message.channelId !== channel.id) return;

            applyPinned(message);
          }),
        );

        unbind.push(
          bindSocket<ReactionSummary & { channelId: string; actorCoreUserId?: string }>(
            socket,
            'reaction:changed',
            (payload) => {
              if (payload.channelId !== channel.id) return;

              // **`reactedByMe` ใน broadcast เป็นของคนที่กด ไม่ใช่ของเรา**
              // (เซิร์ฟเวอร์คำนวณยอดชุดเดียวแล้วส่งให้ทั้งห้อง) — ถ้าเชื่อตามนั้น
              // อีกฝ่ายกด ❤️ แล้วฝั่งเราจะขึ้นว่า "เรากดแล้ว" ด้วย จึงเก็บสถานะ
              // ของเราเองไว้ แล้วเอาเฉพาะยอดนับจาก broadcast
              // เรากดเองจากอีกแท็บ/อีกเครื่อง → reactedByMe ใน broadcast เป็นของเราจริง
              if (payload.actorCoreUserId === me.id) {
                setReactions((prev) => ({
                  ...prev,
                  [payload.targetId]: {
                    targetKind: payload.targetKind,
                    targetId: payload.targetId,
                    totalCount: payload.totalCount,
                    totals: payload.totals,
                  },
                }));

                return;
              }

              setReactions((prev) => {
                const mine = new Set(
                  (prev[payload.targetId]?.totals ?? [])
                    .filter((row) => row.reactedByMe)
                    .map((row) => row.emoji),
                );

                return {
                  ...prev,
                  [payload.targetId]: {
                    targetKind: payload.targetKind,
                    targetId: payload.targetId,
                    totalCount: payload.totalCount,
                    totals: payload.totals.map((row) => ({
                      ...row,
                      reactedByMe: mine.has(row.emoji),
                    })),
                  },
                };
              });
            },
          ),
        );

        unbind.push(
          bindSocket<{ channelId: string; coreUserId: string }>(
            socket,
            'typing:sync',
            (payload) => {
              if (
                payload.channelId !== channel.id ||
                payload.coreUserId === me.id
              ) {
                return;
              }

              setTyping(payload.coreUserId);

              // เก็บตัวจับเวลาไว้ล้างตอนออก ไม่งั้นมันยิง setState ใส่หน้าที่ปิดไปแล้ว
              if (typingTimer) clearTimeout(typingTimer);

              typingTimer = setTimeout(() => setTyping(null), 3000);
            },
          ),
        );

        // สถานะมาจากชั้น socket กลางซึ่งรู้เรื่องการต่อใหม่ด้วย — ฟัง
        // 'disconnect' ดิบ ๆ บอกได้แค่ว่าหลุด ไม่รู้ว่ากลับมาแล้ว
        unbind.push(
          onSocketStatus((next) =>
            setStatus(
              next === 'connected'
                ? 'live'
                : next === 'offline'
                  ? 'offline'
                  : 'connecting',
            ),
          ),
        );

        // ต่อกลับมาแล้วเติมเฉพาะช่วงที่ขาด ไม่โหลดทั้งห้องใหม่ (หลังบ้านมี
        // afterSeq ไว้เพื่อเรื่องนี้โดยตรง)
        unbind.push(
          onSocketReconnect(() => {
            // อ่าน seq ล่าสุดจาก ref ไม่ใช่จากใน updater ของ setMessages —
            // updater ต้องไม่มีผลข้างเคียง (StrictMode เรียกมันสองรอบ = ยิงซ้ำ)
            void api
              .list<Message>(
                `/channels/${channel.id}/messages${qs({
                  limit: PAGE_SIZE,
                  afterSeq: latestSeqRef.current ?? undefined,
                })}`,
              )
              .then((page) => {
                const rows = [...page.items]
                  .sort((a, b) => a.seq - b.seq)
                  .filter((row) => row.parentId === null);

                setMessages((current) =>
                  rows.reduce(
                    (acc, row) => replacePending(acc, row),
                    current,
                  ),
                );
                rows.forEach(bumpList);
              })
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

      if (typingTimer) clearTimeout(typingTimer);

      // ถอดเฉพาะ handler ของหน้าจอนี้ — `socket.off(event)` เฉย ๆ ลบของ
      // ทุกคนบน socket ที่แชร์กันทั้งแอป แล้วหน้าอื่นจะเงียบไปโดยไม่มี error
      for (const off of unbind) {
        off();
      }
    };
  }, [channel.id, me.id, bumpList, dropFromList, applyPinned, queryClient]);

  // ── อ่านแล้ว ─────────────────────────────────────────────
  //
  // รายงานเฉพาะข้อความที่ยืนยันแล้ว — seq ของตัวชั่วคราวเกินช่วง Int ของหลังบ้าน
  // และรายงานเมื่อผู้ใช้เห็นจอจริงเท่านั้น: แท็บที่ซ่อนอยู่ไม่ควรทำให้จุดฟ้าหาย
  // ทั้งที่ยังไม่มีใครได้อ่าน
  useEffect(() => {
    if (latestSeq === null) return;

    const report = () => {
      // ข้อความล่าสุดเป็นของเราเอง = เราเห็นแน่นอน (เพิ่งส่ง) รายงานได้แม้แท็บถูกซ่อน
      // ไม่งั้นส่งจากแท็บหนึ่งแล้วสลับไปแท็บอื่นทันที ห้องนี้จะค้าง "ยังไม่อ่าน" ข้อความตัวเอง
      if (document.visibilityState !== 'visible' && !latestIsMine) return;

      // เส้นทางเป็นคำนามพหูพจน์ตามมาตรฐานหน้า 7 (ไม่ใช่ PATCH /read)
      void api
        .post(`/channels/${channel.id}/read-markers`, { seq: latestSeq })
        .then(() =>
          queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev) =>
            withRead(prev, channel.id),
          ),
        )
        .catch(() => {
          // พลาดไม่ใช่เรื่องใหญ่ — ตัวเลขจะถูกต้องในรอบดึงถัดไป
        });
    };

    report();
    document.addEventListener('visibilitychange', report);

    return () => document.removeEventListener('visibilitychange', report);
  }, [latestSeq, latestIsMine, channel.id, queryClient]);

  // ── รีแอ็กชัน ────────────────────────────────────────────
  useEffect(() => {
    const missing = messages
      .filter((row) => !isPending(row) && reactions[row.id] === undefined)
      .slice(-30);

    if (missing.length === 0) return;

    // คำขอเดียวต่อชุด — ยิงทีละข้อความ สามสิบข้อความ = สามสิบ round trip
    void api
      .get<ReactionSummary[]>(
        `/reactions/summaries${qs({
          targetKind: 'MESSAGE',
          targetIds: missing.map((row) => row.id).join(','),
        })}`,
      )
      .catch(() => [] as ReactionSummary[])
      .then((summaries) => {
        setReactions((prev) => {
          const next = { ...prev };

          // เขียนทุก id ที่ขอ ไม่ใช่แค่ที่มีผล ไม่งั้น id ที่ยังไม่มีใครกด
          // ค้างเป็น undefined แล้ว effect นี้ขอซ้ำทุกครั้งที่วาด
          for (const row of missing) {
            next[row.id] =
              summaries.find((summary) => summary.targetId === row.id) ?? null;
          }

          return next;
        });
      });
  }, [messages, reactions]);

  async function react(messageId: string, emoji: string) {
    const mine =
      reactions[messageId]?.totals.find((row) => row.emoji === emoji)
        ?.reactedByMe ?? false;

    try {
      const next = mine
        ? await api.del<ReactionSummary>(
            `/reactions${qs({ targetKind: 'MESSAGE', targetId: messageId, emoji })}`,
          )
        : await api.post<ReactionSummary>('/reactions', {
            targetKind: 'MESSAGE',
            targetId: messageId,
            emoji,
          });

      setReactions((prev) => ({ ...prev, [messageId]: next }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'กดรีแอ็กชันไม่สำเร็จ');
    }
  }

  // ── เลื่อน ───────────────────────────────────────────────
  const lastId = messages.at(-1)?.id;

  useLayoutEffect(() => {
    const list = listRef.current;

    if (!list) return;

    // เติมของเก่าไว้บนสุด → คงบรรทัดที่อ่านอยู่ไว้ที่เดิม ไม่ให้จอกระโดด
    if (anchorRef.current !== null) {
      list.scrollTop += list.scrollHeight - anchorRef.current;
      anchorRef.current = null;

      return;
    }

    if (stickRef.current) list.scrollTop = list.scrollHeight;
  }, [lastId, messages.length, typing, loaded]);

  // รูปและวิดีโอในข้อความโหลดเสร็จทีหลัง ความสูงจึงเพิ่มหลังเลื่อนลงไปแล้ว —
  // ถ้าไม่ตาม เปิดห้องที่มีรูปจะค้างอยู่เหนือข้อความล่าสุด
  //
  // ตามสองทาง: ResizeObserver จับทุกการเปลี่ยนขนาด (รวมกรอบเองที่เปลี่ยน
  // เมื่อช่องพิมพ์ยืด/หน้าต่างถูกย่อ) ส่วน load/loadedmetadata แบบ capture
  // เป็นตาข่ายอีกชั้นในเบราว์เซอร์ที่ไม่มี ResizeObserver
  // (load ไม่ bubble แต่ผ่านช่วง capture ของบรรพบุรุษ จึงดักที่กล่องเดียวได้)
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;

    if (!list || !content) return;

    const follow = () => {
      if (stickRef.current) list.scrollTop = list.scrollHeight;
    };

    content.addEventListener('load', follow, true);
    content.addEventListener('loadedmetadata', follow, true);

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);

    observer?.observe(content);
    observer?.observe(list);

    return () => {
      content.removeEventListener('load', follow, true);
      content.removeEventListener('loadedmetadata', follow, true);
      observer?.disconnect();
    };
  }, []);

  /// จดว่าผู้ใช้เพิ่งตั้งใจเลื่อน — ใช้ตัดสินว่า scroll event ถัดไปปลดการติด
  /// ล่างสุดได้ไหม (ดู intentRef)
  const markIntent = () => {
    intentRef.current = Date.now();
  };

  // ── ส่ง ──────────────────────────────────────────────────
  /// ส่งแบบเห็นทันที — ใส่ตัวชั่วคราวลงไทม์ไลน์ก่อน แล้วค่อยให้ของจริงแทนที่
  ///
  /// ถ้ารอเซิร์ฟเวอร์ตอบก่อนค่อยวาด บนเน็ตช้าผู้ใช้จะกด Enter แล้วเห็นความว่าง
  /// หลายวินาที แล้วกดส่งซ้ำ · คืน false เมื่อส่งไม่สำเร็จ ให้ช่องพิมพ์คืนร่างเดิม
  async function send(content: string, voice?: UploadedAsset): Promise<boolean> {
    // ข้อความเสียงส่งเดี่ยว ๆ ไม่พ่วงไฟล์ที่ค้างอยู่ในแถวแนบ — คนกดไมค์ตั้งใจส่งเสียง
    // ไม่ได้ตั้งใจส่งรูปที่เลือกไว้เมื่อกี้ไปด้วย
    const assets = voice ? [voice] : attachments.assets;
    const assetIds = assets.map((asset) => asset.assetId);

    // ไฟล์อย่างเดียวไม่มีข้อความก็ต้องส่งได้ — คนส่งรูปเปล่า ๆ บ่อยที่สุด
    if (!content && assetIds.length === 0) return true;

    // ไฟล์ยังอัปไม่เสร็จ ถ้าปล่อยส่ง ไฟล์นั้นจะหลุดหายไปเงียบ ๆ
    if (!voice && attachments.uploading) {
      setError('ยังอัปโหลดไฟล์ไม่เสร็จ — รอสักครู่');

      return false;
    }

    const nonce = newNonce();
    // ตอบกลับ = อ้างข้อความไว้เหนือข้อความใหม่ (ข้อความเสียงก็ตอบกลับได้)
    const replying = reply;
    const payload = {
      channelId: channel.id,
      ...(content ? { content } : {}),
      ...(assetIds.length ? { assetIds: assetIds } : {}),
      ...(replying ? { replyToMessageId: replying.id } : {}),
      clientNonce: nonce,
    };

    const pending: Message = {
      id: `pending-${nonce}`,
      seq: PENDING_SEQ,
      channelId: channel.id,
      authorCoreUserId: me.id,
      content: content || null,
      // โชว์ไฟล์ในตัวชั่วคราวด้วย ไม่งั้นรูป "หาย" ไปหนึ่งจังหวะก่อนของจริงมา
      // ซึ่งดูเหมือนส่งไม่สำเร็จ
      attachments: assets.map((asset) => ({
        id: asset.assetId,
        fileName: asset.fileName,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      })),
      embed: null,
      parentId: null,
      replyCount: 0,
      pinnedAt: null,
      pinnedByCoreUserId: null,
      clientNonce: nonce,
      editedAt: null,
      createdAt: new Date().toISOString(),
      // กล่องอ้างอิงขึ้นทันทีในตัวชั่วคราว ไม่ต้องรอของจริงจากเซิร์ฟเวอร์
      replyTo: replying
        ? {
            id: replying.id,
            authorCoreUserId: replying.authorCoreUserId,
            preview: replying.content?.slice(0, 120) ?? null,
            attachmentKind: null,
            deleted: false,
          }
        : null,
    };

    // ส่งเองต้องเห็นข้อความตัวเองเสมอ แม้จะเลื่อนขึ้นไปอ่านของเก่าอยู่
    stickRef.current = true;
    setMessages((prev) => [...prev, pending]);
    if (!voice) attachments.clear();
    setReply(null);
    setError(null);

    const dropPending = () =>
      setMessages((prev) => prev.filter((row) => row.id !== pending.id));

    try {
      const socket = socketRef.current;

      if (socket?.connected) {
        const result = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'message:send',
          payload,
        );

        if (!result.ok) {
          setError(result.error ?? 'ส่งไม่สำเร็จ');
          dropPending();

          return false;
        }

        return true;
      }

      // socket ต่อไม่ได้ก็ยังส่งได้ทาง REST — หลังบ้านเปิดไว้เป็นทางสำรอง
      const message = await api.post<Message>(
        `/channels/${channel.id}/messages`,
        payload,
      );

      setMessages((prev) => replacePending(prev, message));
      bumpList(message);

      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งไม่สำเร็จ');
      dropPending();

      return false;
    }
  }

  /// อัปข้อความเสียงก่อน แล้วค่อยส่งเป็นข้อความที่มีไฟล์แนบ AUDIO หนึ่งไฟล์
  async function sendVoice(clip: VoiceClip): Promise<boolean> {
    // เสียงสั้นกว่าครึ่งวินาทีคือกดพลาด ไม่ใช่ข้อความ
    if (clip.durationMs < 500 || clip.blob.size === 0) return true;

    setError(null);

    try {
      const asset = await uploadVoice(clip.blob, clip.fileName, clip.contentType);

      return await send('', asset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งข้อความเสียงไม่สำเร็จ');

      return false;
    }
  }

  /// GIF จากแผงสติกเกอร์ — อัปขึ้นท่อไฟล์แนบตามปกติ แล้วส่งเดี่ยว ๆ ทันทีแบบ IG
  async function sendGif(file: File): Promise<boolean> {
    setError(null);

    try {
      return await send('', await uploadFile(file, 'attachments'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่ง GIF ไม่สำเร็จ');

      return false;
    }
  }

  async function saveEdit(content: string): Promise<boolean> {
    if (!editing) return false;

    try {
      const updated = await api.patch<Message>(
        `/channels/${channel.id}/messages/${editing.id}`,
        { content },
      );

      setMessages((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setEditing(null);
      setError(null);

      return true;
    } catch (caught) {
      // เช่น "แก้ข้อความได้ภายใน 15 นาทีหลังส่ง" — บอกตามจริง
      setError(caught instanceof Error ? caught.message : 'แก้ข้อความไม่สำเร็จ');

      return false;
    }
  }

  async function unsend(message: Message) {
    setUnsendBusy(true);

    try {
      await api.del(`/channels/${channel.id}/messages/${message.id}`);
      setMessages((prev) => prev.filter((row) => row.id !== message.id));
      setPinned((prev) => prev.filter((row) => row.id !== message.id));
      setUnsending(null);
      dropFromList();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'ยกเลิกการส่งไม่สำเร็จ', 'error');
    } finally {
      setUnsendBusy(false);
    }
  }

  /// กระโดดไปที่ข้อความ (จากแถบปักหมุด/ข้อความที่อ้างอิง) แล้วไฮไลต์ชั่วครู่
  ///
  /// ถ้าข้อความนั้นยังไม่ถูกโหลด (อยู่เก่ากว่า 50 ข้อความล่าสุด) บอกตรง ๆ
  /// แทนการเลื่อนไปผิดที่ — ผู้ใช้เลื่อนขึ้นเพื่อโหลดของเก่าได้เอง
  const jumpTo = useCallback((messageId: string) => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);

    if (!row) {
      showToast('ข้อความนี้เก่ากว่าที่โหลดไว้ — เลื่อนขึ้นเพื่อดู', 'error');

      return;
    }

    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((current) => (current === messageId ? null : current)), 1600);
  }, []);

  function onAction(action: MessageAction, message: Message) {
    if (action === 'edit') {
      setReply(null);
      setEditing(message);

      return;
    }

    if (action === 'reply') {
      setEditing(null);
      setReply(message);

      return;
    }

    if (action === 'forward') {
      setForwarding(message);

      return;
    }

    if (action === 'copy') {
      void navigator.clipboard
        ?.writeText(message.content ?? '')
        .then(() => showToast('คัดลอกแล้ว'))
        .catch(() => showToast('คัดลอกไม่ได้ — เบราว์เซอร์ไม่อนุญาต', 'error'));

      return;
    }

    if (action === 'unsend') {
      setUnsending(message);

      return;
    }

    if (action === 'pin' || action === 'unpin') {
      const request =
        action === 'pin'
          ? api.put<Message>(`/channels/${channel.id}/messages/${message.id}/pin`)
          : api.del<Message>(`/channels/${channel.id}/messages/${message.id}/pin`);

      void request
        .then((updated) => {
          applyPinned(updated);
          showToast(action === 'pin' ? 'ปักหมุดแล้ว' : 'เลิกปักหมุดแล้ว');
        })
        .catch((caught: unknown) =>
          showToast(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ', 'error'),
        );
    }
  }

  const lastTyping = useRef(0);

  function notifyTyping() {
    // พิมพ์หนึ่งประโยค = ยิงทุกตัวอักษร ถ้าไม่หน่วง — อีกฝ่ายต้องรู้แค่ว่า
    // "ยังพิมพ์อยู่" ซึ่งสองวินาทีครั้งก็พอ
    const now = Date.now();

    if (now - lastTyping.current < 2000) return;

    lastTyping.current = now;
    socketRef.current?.emit('typing:start', { channelId: channel.id });
  }

  const dock = variant === 'dock';
  const group = channel.kind === 'GROUP_DM';
  const request = channel.inboxFolder === 'REQUEST';
  const others = othersOf(channel, me.id);
  // แชทส่วนตัวและแชทกลุ่มปักหมุดได้ทุกคนเหมือน Instagram (messages.service setPinned)
  // ห้องชนิดอื่นที่หลุดมาเปิดที่นี่ยังใช้กติกาเดิม — ไม่ขึ้นเมนูให้คนที่กดแล้วจะได้ 403
  const canPin =
    channel.kind === 'DM' ||
    group ||
    channel.myRole === 'MODERATOR' ||
    isStaffLike(me.coreRole);
  /// ชื่อเล่นที่ตั้งไว้ในห้องนี้ — ใช้แทนชื่อที่แสดงทุกที่ในบทสนทนา
  const nameOf = (coreUserId: string) => channel.nicknames?.[coreUserId] || null;
  const replyAuthor = useProfile(reply?.authorCoreUserId ?? me.id);
  const blocks = useMyBlocks();
  // บล็อกมีผลเฉพาะแชทสองคน — แชทกลุ่มยังคุยได้ตามปกติ (กติกาของหลังบ้าน)
  const blockedPeer = channel.kind === 'DM' && peer !== null && (blocks.data?.has(peer) ?? false);
  // โทรได้ทั้งแชทสองคนและแชทกลุ่ม (call-provider รับรายชื่อสมาชิกได้)
  const { startCall, inCall } = useCall();
  const callees: string | string[] = group ? others : (peer ?? '');
  const canCall = !inCall && !blockedPeer && (group ? others.length > 0 : peer !== null);

  return (
    <div
      className={
        dock
          ? 'relative flex h-full min-h-0 flex-col bg-background'
          : 'flex min-h-0 min-w-0 flex-1'
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ThreadHeader
          channel={channel}
          peer={peer}
          variant={variant}
          status={status}
          typing={typing !== null}
          infoOpen={showInfo}
          onInfo={() => setShowInfo((open) => !open)}
          onBack={onBack}
          onClose={onClose}
          onExpand={onExpand}
        />

        {pinned[0] && <PinnedBanner message={pinned[0]} count={pinned.length} onJump={jumpTo} />}

        <div
          ref={listRef}
          onWheel={markIntent}
          onTouchMove={markIntent}
          onKeyDown={markIntent}
          // กดที่แถบเลื่อนแล้วลาก — pointerdown บนกรอบเอง ไม่ใช่บนลูกข้างใน
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) markIntent();
          }}
          onScroll={(event) => {
            const list = event.currentTarget;
            const nearBottom =
              list.scrollHeight - list.scrollTop - list.clientHeight < 80;

            if (nearBottom) {
              stickRef.current = true;
            } else if (Date.now() - intentRef.current < 1000) {
              stickRef.current = false;
            }

            if (list.scrollTop < 160) void loadOlder();
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]"
        >
          <div
            ref={contentRef}
            className={dock ? 'px-3 pb-2 pt-3' : 'px-4 pb-3 pt-4'}
          >
            {!loaded && (
              <p className="flex justify-center py-10 text-muted-foreground">
                <Loader2 aria-label="กำลังโหลด" className="size-5 animate-spin" />
              </p>
            )}

            {loadingOlder && (
              <p className="flex justify-center py-2 text-muted-foreground">
                <Loader2
                  aria-label="กำลังโหลดข้อความก่อนหน้า"
                  className="size-4 animate-spin"
                />
              </p>
            )}

            {/* ถึงต้นบทสนทนาแล้ว = โชว์ว่าคุยกับใคร เหมือนหัวบทสนทนาของ IG */}
            {loaded && !older.more && (peer || group) && (
              <PeerIntro channel={channel} peer={peer} compact={dock} />
            )}

            <MessageList
              messages={messages}
              reactions={reactions}
              myId={me.id}
              dock={dock}
              group={group}
              // "เห็นแล้ว" มีความหมายเฉพาะแชทสองคน — แชทกลุ่มหลังบ้านไม่ได้บอกว่าใครอ่านถึงไหน
              peerReadSeq={channel.kind === 'DM' ? peerRead : null}
              abilities={{ pin: canPin, reply: !blockedPeer, forward: true }}
              highlightId={highlightId}
              nameOf={nameOf}
              onReact={(id, emoji) => void react(id, emoji)}
              onAction={onAction}
              onJump={jumpTo}
              onCallBack={canCall ? (media) => void startCall(channel.id, callees, { kind: media }) : undefined}
            />

            {typing && others.includes(typing) && <TypingRow typist={typing} nameOf={nameOf} />}
          </div>
        </div>

        {request && (
          <RequestBanner channel={channel} onGone={onBack ?? onClose} />
        )}

        {blockedPeer && peer ? (
          <BlockedBar coreUserId={peer} />
        ) : (
        <Composer
          dock={dock}
          attachments={attachments}
          error={error}
          status={status}
          onTyping={notifyTyping}
          editing={editing}
          reply={
            reply
              ? {
                  message: reply,
                  name:
                    reply.authorCoreUserId === me.id
                      ? 'ตัวคุณเอง'
                      : (nameOf(reply.authorCoreUserId) ?? replyAuthor.displayName),
                }
              : null
          }
          onSend={send}
          onSendVoice={sendVoice}
          onSendGif={sendGif}
          onSaveEdit={saveEdit}
          onCancelEdit={() => setEditing(null)}
          onCancelReply={() => setReply(null)}
        />
        )}
      </div>

      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />

      <ConfirmDialog
        open={unsending !== null}
        title="ยกเลิกการส่งข้อความไหม"
        description="ข้อความนี้จะถูกลบออกจากแชทสำหรับทุกคน"
        confirmLabel="ยกเลิกการส่ง"
        busy={unsendBusy}
        onCancel={() => setUnsending(null)}
        onConfirm={() => {
          if (unsending) void unsend(unsending);
        }}
      />

      <ToastHost />

      {showInfo && (
        <InfoPanel
          channel={channel}
          layout={dock ? 'overlay' : 'side'}
          onClose={() => setShowInfo(false)}
          onGone={() => {
            setShowInfo(false);
            (onBack ?? onClose)?.();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// หัวบทสนทนา
// ────────────────────────────────────────────────────────────

function IconButton({
  label,
  onClick,
  disabled,
  title,
  pressed,
  small,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  pressed?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      aria-pressed={pressed}
      className={`grid shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent ${
        small ? 'size-8' : 'size-10'
      }`}
    >
      {children}
    </button>
  );
}

interface PresenceUser {
  coreUserId: string;
  online: boolean;
  /// null = ปิดสถานะกิจกรรมไว้ (ฝั่งใดฝั่งหนึ่ง) หรือบล็อกกัน — หลังบ้านไม่บอก
  lastActiveAt: string | null;
}

/// สถานะออนไลน์/ใช้งานล่าสุดของคู่สนทนา จาก `GET /presence?ids=`
///
/// จุดเขียวสดมาจาก socket อยู่แล้ว (useOnline) — ตัวนี้เติม "ใช้งานเมื่อ…"
/// ซึ่ง socket ไม่รู้ และเคารพการปิดสถานะกิจกรรมที่หลังบ้านตัดสินให้
function usePresence(coreUserId: string | null): PresenceUser | null {
  const { data } = useQuery({
    queryKey: ['presence', coreUserId],
    queryFn: async () =>
      (await api.get<{ users?: PresenceUser[] } | null>(`/presence${qs({ ids: coreUserId ?? '' })}`))
        ?.users ?? [],
    enabled: Boolean(coreUserId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return data?.find((row) => row.coreUserId === coreUserId) ?? null;
}

/// "ใช้งานเมื่อ 5 นาทีที่แล้ว" แบบ IG — เกินสัปดาห์ไปแล้วบอกเป็นวันที่
export function activeAgo(iso: string): string {
  const ago = igAgo(iso);

  if (ago === 'เมื่อครู่') return 'ใช้งานเมื่อครู่';
  if (/นาที|ชั่วโมง|วัน|สัปดาห์/.test(ago)) return `ใช้งานเมื่อ ${ago}ที่แล้ว`;

  return `ใช้งานล่าสุด ${ago}`;
}

function ThreadHeader({
  channel,
  peer,
  variant,
  status,
  typing,
  infoOpen,
  onInfo,
  onBack,
  onClose,
  onExpand,
}: {
  channel: Channel;
  peer: string | null;
  variant: ThreadVariant;
  status: Status;
  typing: boolean;
  infoOpen: boolean;
  onInfo?: () => void;
  onBack?: () => void;
  onClose?: () => void;
  onExpand?: () => void;
}) {
  const me = useMe();
  const online = useOnline(peer ?? '');
  const presence = usePresence(peer);
  const { startCall, inCall } = useCall();
  const dock = variant === 'dock';
  const group = channel.kind === 'GROUP_DM';
  const memberCount = channel.memberCoreUserIds?.length ?? channel.memberCount;

  // บรรทัดรองบอกสิ่งที่เป็นจริงตอนนี้ เรียงตามความสำคัญ: กำลังพิมพ์ →
  // การเชื่อมต่อของเราเอง (ถ้ามีปัญหา) → อีกฝ่ายออนไลน์ → ชื่อผู้ใช้/จำนวนคน
  const secondary = typing
    ? 'กำลังพิมพ์…'
    : status === 'connecting'
      ? 'กำลังเชื่อมต่อ…'
      : status === 'offline'
        ? 'ออฟไลน์ · ส่งผ่าน REST'
        : group
          ? `${memberCount} คน`
          : online || presence?.online
            ? 'กำลังใช้งาน'
            : presence?.lastActiveAt
              ? activeAgo(presence.lastActiveAt)
              : (peer ?? `${channel.memberCount} คน`);

  const others = othersOf(channel, me.id);
  const callees: string | string[] | null = group ? (others.length ? others : null) : peer;
  const call = (kind: 'AUDIO' | 'VIDEO') => {
    if (callees) void startCall(channel.id, callees, { kind });
  };
  const callTitle = inCall
    ? 'อยู่ในสายอื่นอยู่'
    : callees
      ? group
        ? 'โทรหาทุกคนในกลุ่ม'
        : 'โทรหาคู่สนทนา'
      : 'ห้องนี้ไม่มีคนให้โทรหา';
  const iconClass = dock ? 'size-5' : 'size-6';

  const identity = (
    <>
      <ConversationAvatar channel={channel} size={dock ? 32 : 44} />

      <span className="min-w-0">
        <span
          className={`block truncate font-semibold ${dock ? 'text-sm' : 'text-base leading-5'}`}
        >
          <ConversationName channel={channel} />
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {secondary}
        </span>
      </span>
    </>
  );

  return (
    <header
      className={`flex shrink-0 items-center border-b border-border ${
        dock ? 'h-14 gap-1.5 px-2' : 'h-[75px] gap-3 px-4'
      }`}
    >
      {onBack && (
        <span className={dock ? '' : 'md:hidden'}>
          <IconButton label="กลับไปรายการข้อความ" onClick={onBack} small={dock}>
            <ChevronLeft className={dock ? 'size-6' : 'size-7'} strokeWidth={1.9} />
          </IconButton>
        </span>
      )}

      {peer ? (
        <Link
          href={`/profile/${encodeURIComponent(peer)}`}
          className="flex min-w-0 items-center gap-3 rounded-lg"
        >
          {identity}
        </Link>
      ) : (
        // แชทกลุ่มกดที่ชื่อแล้วเปิดรายละเอียด (ดูสมาชิก) แบบ IG
        <button
          type="button"
          onClick={onInfo}
          className="flex min-w-0 items-center gap-3 rounded-lg text-left"
        >
          {identity}
        </button>
      )}

      <span className="flex-1" />

      <span className={`flex shrink-0 items-center ${dock ? '' : 'gap-1'}`}>
        {/* โทรได้ทั้งแชทสองคนและแชทกลุ่ม · วิดีโอคอลเปิดกล้องไว้ตั้งแต่ห้องรอ */}
        <IconButton
          label="โทรด้วยเสียง"
          title={callTitle}
          onClick={() => call('AUDIO')}
          disabled={inCall || !callees}
          small={dock}
        >
          <Phone className={iconClass} strokeWidth={1.9} />
        </IconButton>

        <IconButton
          label="โทรวิดีโอ"
          title={inCall || !callees ? callTitle : 'วิดีโอคอล'}
          onClick={() => call('VIDEO')}
          disabled={inCall || !callees}
          small={dock}
        >
          <Video className={iconClass} strokeWidth={1.9} />
        </IconButton>

        {onInfo && (
          <IconButton
            label="รายละเอียดบทสนทนา"
            onClick={onInfo}
            pressed={infoOpen}
            small={dock}
          >
            <Info
              className={`${iconClass} ${infoOpen ? 'fill-foreground text-background' : ''}`}
              strokeWidth={1.9}
            />
          </IconButton>
        )}

        {onExpand && (
          <IconButton label="เปิดเต็มหน้า" onClick={onExpand} small>
            <Maximize2 className="size-4.5" strokeWidth={1.9} />
          </IconButton>
        )}

        {onClose && (
          <IconButton label="ปิดหน้าต่างแชท" onClick={onClose} small>
            <X className="size-5" strokeWidth={1.9} />
          </IconButton>
        )}
      </span>

    </header>
  );
}

// ────────────────────────────────────────────────────────────
// ข้อความ
// ────────────────────────────────────────────────────────────

function PeerIntro({
  channel,
  peer,
  compact,
}: {
  channel: Channel;
  peer: string | null;
  compact: boolean;
}) {
  const memberCount = channel.memberCoreUserIds?.length ?? channel.memberCount;

  return (
    <div className="flex flex-col items-center pb-6 pt-4 text-center">
      <ConversationAvatar channel={channel} size={compact ? 64 : 96} showOnline={false} />
      <p className={`mt-3 font-semibold ${compact ? 'text-base' : 'text-xl'}`}>
        <ConversationName channel={channel} />
      </p>

      {peer ? (
        <>
          <p className="text-sm text-muted-foreground">{peer} · CS Nexus</p>
          <Link
            href={`/profile/${encodeURIComponent(peer)}`}
            className="mt-4 rounded-lg bg-muted px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-accent"
          >
            ดูโปรไฟล์
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          แชทกลุ่ม · {memberCount} คน
        </p>
      )}
    </div>
  );
}

/// แถบข้อความที่ปักหมุดใต้หัวบทสนทนา แบบ IG — กดแล้วกระโดดไปที่ข้อความนั้น
function PinnedBanner({
  message,
  count,
  onJump,
}: {
  message: Message;
  count: number;
  onJump: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(message.id)}
      aria-label={`ข้อความที่ปักหมุด: ${messagePreview(message)} — กดเพื่อไปที่ข้อความ`}
      className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-left text-sm transition-colors hover:bg-accent animate-in fade-in-0 duration-150"
    >
      <Pin aria-hidden className="size-4 shrink-0 rotate-45 fill-current text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{messagePreview(message)}</span>
      {count > 1 && (
        <span className="shrink-0 text-xs text-muted-foreground">+{count - 1}</span>
      )}
    </button>
  );
}

/// คำขอข้อความที่เปิดดูอยู่ — แถบล่างแบบ IG ให้ตัดสินใจก่อนตอบ
///
/// ตอบกลับได้เลยโดยไม่ต้องกดยอมรับ (หลังบ้านนับว่า "เคยตอบ" = ไม่ใช่คำขอแล้ว)
/// แต่บอกไว้ให้รู้ว่าอีกฝ่ายยังไม่รู้ว่าเราเห็นข้อความจนกว่าจะยอมรับหรือตอบ
function RequestBanner({ channel, onGone }: { channel: Channel; onGone?: () => void }) {
  return (
    <div className="shrink-0 border-t border-border px-4 pb-1 pt-3 text-center animate-in fade-in-0 duration-150">
      <p className="text-sm font-semibold">
        <ConversationName channel={channel} /> ต้องการส่งข้อความถึงคุณ
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        คุณยังไม่ได้ติดตามบัญชีนี้ ยอมรับเพื่อย้ายแชทไปกล่องหลัก หรือพิมพ์ตอบได้เลย
      </p>
      <RequestActions channel={channel} onGone={onGone} className="mt-2 justify-center" />
    </div>
  );
}
