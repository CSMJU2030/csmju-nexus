'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Bell,
  BellOff,
  MailWarning,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
  Users,
} from 'lucide-react';
import { ConfirmDialog, MenuItem, PopMenu } from '@/components/csmju/messages-menu';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { igAgo } from '@/lib/csmju/time';
import type { Channel, InboxFolder } from '@/lib/csmju/types';

/// รายการบทสนทนาส่วนตัวแบบ Instagram Direct
///
/// แยกออกมาจากหน้า /messages เพราะมีสองที่ที่ต้องวาดรายการเดียวกัน: คอลัมน์ซ้าย
/// ของหน้าข้อความ และแผงข้อความลอยมุมขวาล่าง — ถ้าต่างคนต่างเขียน ตัวอย่าง
/// ข้อความ จุดยังไม่อ่าน และคำว่า "คุณ:" จะเพี้ยนกันไปคนละแบบในไม่ช้า
///
/// props ตั้งใจให้เรียบที่สุด (`channels` · `activeId` · `onOpen`) — ไม่รู้เรื่อง
/// URL เลย ผู้เรียกจะเปิดบทสนทนาด้วยวิธีไหนก็ได้

/// แคชรายการห้องที่แชร์กับตัวเลขบนแถบซ้าย หน้าห้องแชท และแผงข้อความลอย
///
/// ต้องเป็นกุญแจเดียวกันทุกที่ ไม่งั้นอ่านข้อความ/ปักหมุดที่หนึ่งแล้วอีกที่ยังค้าง
/// ค่าเก่าจนกว่าจะครบรอบดึงใหม่ 30 วินาที
export const CHANNELS_KEY = ['channels', 'mine'] as const;

/// ห้องที่นับเป็น "ข้อความ" แบบ IG — แชทส่วนตัวและแชทกลุ่ม (ไม่ใช่ห้องแชท
/// แบบ Discord ที่อยู่หน้า /chat)
export function isConversation(channel: Channel): boolean {
  return channel.kind === 'DM' || channel.kind === 'GROUP_DM';
}

/// แท็บของกล่องข้อความ — ตรงกับ `inboxFolder` ที่หลังบ้านตัดสินให้แล้ว
///
/// "คำขอ" ไม่ใช่แฟ้มที่ใครเลือก หลังบ้านคำนวณเอง (ไม่มีใครเลือกแฟ้ม · เราไม่ได้
/// ติดตามอีกฝ่าย · เราไม่เคยตอบ) แล้วส่งมาเป็น REQUEST · HIDDEN ถูกส่งมาด้วย
/// จึงต้องกรองที่นี่ ไม่งั้นแชทที่ซ่อนไว้จะโผล่กลับในกล่องหลัก
export function inFolder(channel: Channel, folder: InboxFolder): boolean {
  return isConversation(channel) && channel.inboxFolder === folder;
}

/// เรียงแบบที่หลังบ้านเรียง: ปักหมุดก่อน แล้วความเคลื่อนไหวล่าสุด
///
/// ต้องเรียงซ้ำฝั่งเราเมื่อแก้แคชเอง (ข้อความใหม่ · ปักหมุด) ไม่งั้นห้องที่เพิ่ง
/// มีข้อความจะเด้งขึ้นเหนือห้องที่ปักหมุดไว้
export function sortInbox(channels: Channel[]): Channel[] {
  const activity = (row: Channel) => row.lastMessage?.createdAt ?? row.createdAt;

  return [...channels].sort((a, b) => {
    if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt && b.pinnedAt && a.pinnedAt !== b.pinnedAt) {
      return b.pinnedAt.localeCompare(a.pinnedAt);
    }

    return activity(b).localeCompare(activity(a));
  });
}

/// คู่สนทนาของห้อง DM
///
/// ห้อง DM ถูกสร้างด้วย `name: null` เสมอ ถ้าเดาจากชื่อห้องจะได้ "แชทส่วนตัว"
/// ทุกห้อง แล้วปุ่มโทรก็กดไม่ได้สักห้อง (บั๊กที่เคยเกิดมาแล้ว) — หลังบ้านจึงส่ง
/// `peerCoreUserId` มาให้ตรง ๆ · ห้องรุ่นเก่าที่เคยตั้งชื่อไว้ยังอ่านได้
export function peerOf(channel: Channel, myCoreUserId: string): string | null {
  if (channel.kind === 'GROUP_DM') return null;
  if (channel.peerCoreUserId) return channel.peerCoreUserId;

  if (channel.name && channel.name !== myCoreUserId) return channel.name;

  return null;
}

/// คนอื่นในห้อง (ไม่รวมเรา) — DM ได้หนึ่งคน · แชทกลุ่มได้ทุกคนตามลำดับที่เข้า
export function othersOf(channel: Channel, myCoreUserId: string): string[] {
  if (channel.kind === 'GROUP_DM') {
    return (channel.memberCoreUserIds ?? []).filter((id) => id !== myCoreUserId);
  }

  const peer = peerOf(channel, myCoreUserId);

  return peer ? [peer] : [];
}

/// บรรทัดที่สองของแถว — สิ่งที่ทำให้รู้ว่าต้องเปิดห้องไหนก่อนโดยไม่ต้องเปิดทุกห้อง
///
/// ข้อความค้างมาก่อนตัวอย่างข้อความ เพราะ "มีอะไรใหม่" สำคัญกว่า "ข้อความ
/// ล่าสุดว่าอะไร" (IG ทำแบบเดียวกัน: "4 new messages")
///
/// `author` = คนส่งข้อความล่าสุดในแชทกลุ่มที่ไม่ใช่เรา — ผู้เรียกเติมชื่อเอง
/// เพราะฟังก์ชันนี้ไม่รู้ชื่อที่แสดง (ต้องมาจาก useProfile)
export function previewOf(
  channel: Channel,
  myCoreUserId: string,
): { text: string; ago: string | null; unread: boolean; author?: string } {
  const last = channel.lastMessage;
  const ago = last ? igAgo(last.createdAt) : null;

  if (channel.unreadCount > 0) {
    return {
      text: `${channel.unreadCount > 9 ? '9+' : channel.unreadCount} ข้อความใหม่`,
      ago,
      unread: true,
    };
  }

  if (!last) {
    // ห้องที่เพิ่งกด "ข้อความใหม่" แต่ยังไม่มีใครพิมพ์ — บอกตรง ๆ ดีกว่าช่องว่าง
    return { text: 'ยังไม่มีข้อความ', ago: null, unread: false };
  }

  // ข้อความที่มีแต่ไฟล์แนบมี content เป็น null — ถ้าไม่แทนด้วยคำ
  // แถวนั้นจะเหลือแค่ "คุณ: · 3 นาที" ซึ่งดูเหมือนข้อความหาย
  const body =
    last.content?.replace(/\s+/g, ' ').trim() ||
    (last.attachmentCount > 0 ? 'ส่งไฟล์แนบ' : '');

  // ข้อความการโทร: หลังบ้านเขียนตามมุมของผู้อ่านมาแล้ว ("คุณเริ่มการโทรด้วยเสียง"
  // "ไม่ได้รับสายวิดีโอคอล") — ใช้ตามนั้น ไม่เติม "คุณ:" หรือชื่อคนส่งซ้ำ
  if (last.callLog) return { text: body, ago, unread: false };

  if (last.authorCoreUserId === myCoreUserId) {
    return { text: `คุณ: ${body}`, ago, unread: false };
  }

  return channel.kind === 'GROUP_DM'
    ? { text: body, ago, unread: false, author: last.authorCoreUserId }
    : { text: body, ago, unread: false };
}

/// ย้ายแฟ้ม ปักหมุด ปิดเสียง ลบแชท — แล้วแก้แคชรายการห้องทันที
///
/// หลังบ้านคืนห้องฉบับใหม่มาทั้งก้อน จึงแทนที่ทั้งแถวแทนการเดาค่าเอง
export function useInboxActions() {
  const queryClient = useQueryClient();

  const replace = (updated: Channel) =>
    queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev) =>
      prev ? sortInbox(prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))) : prev,
    );

  const drop = (channelId: string) =>
    queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev) =>
      prev?.filter((row) => row.id !== channelId),
    );

  return {
    async update(
      channel: Channel,
      body: { folder?: 'PRIMARY' | 'GENERAL' | 'HIDDEN'; pinned?: boolean; muted?: boolean },
    ) {
      const updated = await api.patch<Channel>(`/channels/${channel.id}/inbox`, body);

      replace(updated);

      return updated;
    },
    /// "ทำเครื่องหมายว่ายังไม่ได้อ่าน" — หลังบ้านถอยหมุดอ่านไปหนึ่งข้อความ
    /// แล้วคืนห้องที่ unreadCount ≥ 1 กลับมา จุดฟ้าจึงขึ้นตามของจริง
    async markUnread(channel: Channel) {
      replace(await api.post<Channel>(`/channels/${channel.id}/unread`));
    },
    /// "ลบแชท" = ลบฝั่งเราเท่านั้น อีกฝ่ายยังเห็นครบ · ห้องหายจากกล่องจนมีข้อความใหม่
    async clear(channel: Channel) {
      await api.post(`/channels/${channel.id}/clear`);
      drop(channel.id);
    },
    async leave(channel: Channel) {
      await api.del(`/channels/${channel.id}/members/me`);
      drop(channel.id);
    },
    replace,
    drop,
  };
}

// ────────────────────────────────────────────────────────────
// รูปและชื่อของบทสนทนา
// ────────────────────────────────────────────────────────────

/// รูปของบทสนทนา — แชทกลุ่มเป็นรูปสองคนซ้อนกันแบบ IG
export function ConversationAvatar({
  channel,
  size = 56,
  showOnline = true,
}: {
  channel: Channel;
  size?: number;
  showOnline?: boolean;
}) {
  const me = useMe();
  const others = othersOf(channel, me.id);

  if (channel.kind === 'GROUP_DM' && others.length >= 2) {
    const small = Math.round(size * 0.72);

    return (
      <span aria-hidden className="relative block shrink-0" style={{ width: size, height: size }}>
        <span className="absolute right-0 top-0">
          <Avatar coreUserId={others[1]} size={small} showOnline={false} />
        </span>
        <span className="absolute bottom-0 left-0 rounded-full ring-2 ring-background">
          <Avatar coreUserId={others[0]} size={small} showOnline={false} />
        </span>
      </span>
    );
  }

  if (others[0]) {
    return <Avatar coreUserId={others[0]} size={size} showOnline={showOnline} />;
  }

  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <Users aria-hidden className="size-1/2" strokeWidth={1.9} />
    </span>
  );
}

/// ชื่อของคนในแชทนี้ — ชื่อเล่นที่ตั้งไว้ในห้องมาก่อนชื่อที่แสดง (แบบ IG)
function DisplayName({ coreUserId, nickname }: { coreUserId: string; nickname?: string }) {
  const profile = useProfile(coreUserId);

  return <>{nickname || profile.displayName}</>;
}

/// ชื่อของบทสนทนา: ชื่อคู่สนทนา · ชื่อกลุ่ม · หรือชื่อสมาชิกคั่นด้วย ", " แบบ IG
///
/// ใช้คอมโพเนนต์ย่อยต่อคน เพราะ useProfile เรียกในลูปไม่ได้
export function ConversationName({ channel }: { channel: Channel }) {
  const me = useMe();

  if (channel.kind === 'GROUP_DM' && channel.name) return <>{channel.name}</>;

  const others = othersOf(channel, me.id);

  if (others.length === 0) return <>{channel.kind === 'GROUP_DM' ? 'แชทกลุ่ม' : 'แชทส่วนตัว'}</>;

  return (
    <>
      {others.map((id, index) => (
        <span key={id}>
          {index > 0 && ', '}
          <DisplayName coreUserId={id} nickname={channel.nicknames?.[id]} />
        </span>
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// แถว
// ────────────────────────────────────────────────────────────

export function InboxRow({
  channel,
  active = false,
  onOpen,
  actions = true,
  footer,
}: {
  channel: Channel;
  active?: boolean;
  onOpen: (channel: Channel) => void;
  /// เมนู ⋯ (ปักหมุด · ปิดเสียง · ย้ายแฟ้ม · ลบแชท) — ปิดได้สำหรับหน้าคำขอ
  actions?: boolean;
  /// แถวปุ่มใต้แถว เช่น ลบ/ยอมรับ/ซ่อน ของหน้าคำขอ
  footer?: ReactNode;
}) {
  const me = useMe();
  const preview = previewOf(channel, me.id);

  return (
    <div
      className={`group relative transition-colors hover:bg-accent ${active ? 'bg-accent' : ''}`}
    >
      <button
        type="button"
        onClick={() => onOpen(channel)}
        aria-current={active ? 'true' : undefined}
        className="flex w-full items-center gap-3 px-6 py-2 text-left max-md:px-4"
      >
        <ConversationAvatar channel={channel} />

        <span className={`min-w-0 flex-1 ${actions ? 'pr-8' : ''}`}>
          <span
            className={`flex items-center gap-1 text-sm leading-5 ${
              preview.unread ? 'font-semibold text-foreground' : 'font-normal'
            }`}
          >
            <span className="truncate">
              <ConversationName channel={channel} />
            </span>
            {/* ป้ายเล็กต่อท้ายชื่อแบบ IG: 📌 ปักหมุด · 🔕 ปิดเสียง */}
            {channel.pinnedAt && (
              <Pin aria-label="ปักหมุดไว้" className="size-3.5 shrink-0 rotate-45 fill-current text-muted-foreground" />
            )}
            {channel.muted && (
              <BellOff aria-label="ปิดเสียงไว้" className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </span>

          <span
            className={`flex min-w-0 text-xs leading-4 ${
              preview.unread ? 'font-semibold text-foreground' : 'text-muted-foreground'
            }`}
          >
            {/* ตัดเฉพาะตัวอย่างข้อความ เวลาต้องเห็นเสมอ — ถ้าตัดทั้งบรรทัด
                ข้อความยาว ๆ จะดันเวลาหลุดขอบไปทุกแถว */}
            <span className="truncate">
              {preview.author && (
                <>
                  <DisplayName
                    coreUserId={preview.author}
                    nickname={channel.nicknames?.[preview.author]}
                  />
                  {': '}
                </>
              )}
              {preview.text}
            </span>
            {preview.ago && (
              <span className="shrink-0 whitespace-pre">{` · ${preview.ago}`}</span>
            )}
          </span>
        </span>

        {preview.unread && (
          <span className="size-2 shrink-0 rounded-full bg-link">
            <span className="sr-only">ยังไม่อ่าน</span>
          </span>
        )}
      </button>

      {actions && <RowMenu channel={channel} />}

      {footer}
    </div>
  );
}

/// เมนู ⋯ ของแถว — โผล่ตอนชี้/โฟกัส แบบ IG บนเว็บ
function RowMenu({ channel }: { channel: Channel }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inbox = useInboxActions();

  async function run(action: () => Promise<unknown>) {
    setOpen(false);
    setError(null);

    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    }
  }

  const general = channel.inboxFolder === 'GENERAL';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="ตัวเลือกของแชท"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`absolute right-10 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 max-md:right-8 ${
          open ? 'opacity-100' : 'opacity-0 pointer-coarse:opacity-60'
        }`}
      >
        <MoreHorizontal aria-hidden className="size-5" strokeWidth={1.9} />
      </button>

      {error && (
        <p role="alert" className="px-6 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <PopMenu anchorRef={anchorRef} open={open} width={280} onClose={() => setOpen(false)} label="ตัวเลือกของแชท">
        {/* ห้องที่ยังไม่มีข้อความทำเครื่องหมายไม่ได้ (หลังบ้านตอบ 400) · ห้องที่ค้างอยู่แล้วไม่ต้องทำ */}
        {channel.lastMessage && channel.unreadCount === 0 && (
          <MenuItem
            icon={<MailWarning className="size-4" />}
            onSelect={() => void run(() => inbox.markUnread(channel))}
          >
            ทำเครื่องหมายว่ายังไม่ได้อ่าน
          </MenuItem>
        )}
        <MenuItem
          icon={channel.pinnedAt ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          onSelect={() => void run(() => inbox.update(channel, { pinned: !channel.pinnedAt }))}
        >
          {channel.pinnedAt ? 'เลิกปักหมุด' : 'ปักหมุด'}
        </MenuItem>
        <MenuItem
          icon={channel.muted ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          onSelect={() => void run(() => inbox.update(channel, { muted: !channel.muted }))}
        >
          {channel.muted ? 'เปิดเสียง' : 'ปิดเสียง'}
        </MenuItem>
        <MenuItem
          icon={<ArrowRightLeft className="size-4" />}
          onSelect={() =>
            void run(() => inbox.update(channel, { folder: general ? 'PRIMARY' : 'GENERAL' }))
          }
        >
          {general ? 'ย้ายไปหลัก' : 'ย้ายไปทั่วไป'}
        </MenuItem>
        <MenuItem
          tone="danger"
          icon={<Trash2 className="size-4" />}
          onSelect={() => {
            setOpen(false);
            setConfirm(true);
          }}
        >
          ลบ
        </MenuItem>
      </PopMenu>

      <ConfirmDialog
        open={confirm}
        title="ลบแชทนี้ไหม"
        description="ข้อความทั้งหมดจะหายจากฝั่งคุณเท่านั้น คนอื่นในแชทยังเห็นอยู่ แชทจะกลับมาเมื่อมีข้อความใหม่"
        confirmLabel="ลบ"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setBusy(true);
          setError(null);
          inbox
            .clear(channel)
            .then(() => setConfirm(false))
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : 'ลบแชทไม่สำเร็จ'),
            )
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

/// รายการห้อง เรียงตามที่หลังบ้านเรียงมาให้ (ปักหมุดก่อน แล้วความเคลื่อนไหวล่าสุด)
///
/// กรองเฉพาะแชทส่วนตัวและแชทกลุ่มในตัว เพื่อให้ผู้เรียกส่งแคช
/// `['channels','mine']` ทั้งก้อนเข้ามาได้ — แคชนั้นมีห้องแชทแบบ Discord ปนอยู่
/// **ไม่กรองแฟ้ม** — ผู้เรียกเลือกแฟ้มเองด้วย `inFolder` (หน้าคำขอ/ที่ซ่อนไว้
/// ใช้รายการเดียวกันนี้)
export function InboxList({
  channels,
  activeId = null,
  onOpen,
  actions = true,
}: {
  channels: Channel[];
  activeId?: string | null;
  onOpen: (channel: Channel) => void;
  actions?: boolean;
}) {
  const direct = channels.filter(isConversation);

  return (
    <ul aria-label="บทสนทนา">
      {direct.map((channel) => (
        <li key={channel.id}>
          <InboxRow
            channel={channel}
            active={channel.id === activeId}
            onOpen={onOpen}
            actions={actions}
          />
        </li>
      ))}
    </ul>
  );
}

/// ปุ่มสามปุ่มของคำขอข้อความ แบบ IG: ลบ · ซ่อน · ยอมรับ
///
///   ลบ     = ลบแชทฝั่งเรา (POST /clear) — อีกฝ่ายไม่รู้ และส่งมาใหม่ได้
///   ซ่อน   = ย้ายไป "คำขอที่ซ่อนไว้" (folder HIDDEN)
///   ยอมรับ = ย้ายไปกล่องหลัก (folder PRIMARY)
export function RequestActions({
  channel,
  onGone,
  className = '',
}: {
  channel: Channel;
  /// ห้องออกจากหน้าคำขอแล้ว (ยอมรับ/ซ่อน/ลบ) — ผู้เรียกอาจพากลับไปรายการ
  onGone?: (outcome: 'accepted' | 'hidden' | 'deleted') => void;
  className?: string;
}) {
  const inbox = useInboxActions();
  const [busy, setBusy] = useState<'accepted' | 'hidden' | 'deleted' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidden = channel.inboxFolder === 'HIDDEN';

  async function run(outcome: 'accepted' | 'hidden' | 'deleted') {
    setBusy(outcome);
    setError(null);

    try {
      if (outcome === 'deleted') await inbox.clear(channel);
      else await inbox.update(channel, { folder: outcome === 'accepted' ? 'PRIMARY' : 'HIDDEN' });

      setConfirm(false);
      onGone?.(outcome);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  const button =
    'h-8 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-50';

  return (
    <div className={className}>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy !== null}
          className={`${button} bg-muted text-destructive hover:bg-accent`}
        >
          ลบ
        </button>
        {!hidden && (
          <button
            type="button"
            onClick={() => void run('hidden')}
            disabled={busy !== null}
            className={`${button} bg-muted hover:bg-accent`}
          >
            {busy === 'hidden' ? 'กำลังซ่อน…' : 'ซ่อน'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void run('accepted')}
          disabled={busy !== null}
          className={`${button} bg-primary text-primary-foreground hover:opacity-90`}
        >
          {busy === 'accepted' ? 'กำลังยอมรับ…' : 'ยอมรับ'}
        </button>
      </div>

      {error && !confirm && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirm}
        title="ลบคำขอนี้ไหม"
        description="แชทนี้จะหายจากฝั่งคุณ อีกฝ่ายจะไม่รู้ และยังส่งข้อความมาใหม่ได้"
        confirmLabel="ลบ"
        busy={busy === 'deleted'}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void run('deleted')}
      />
    </div>
  );
}
