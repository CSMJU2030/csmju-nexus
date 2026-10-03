'use client';

import { memo, useRef, useState } from 'react';
import {
  Copy,
  CornerUpLeft,
  CornerUpRight,
  Forward,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { AttachmentList } from '@/components/csmju/attachment-list';
import { EMOJI_FONT, EmojiPopover, rememberEmoji } from '@/components/csmju/emoji-picker';
import { ReactionChips } from '@/components/csmju/reaction-chips';
import { RoomPopover } from '@/components/csmju/room-popover';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { VerifiedBadge } from '@/components/csmju/user-badge';
import { stampLabel, timeLabel } from '@/app/(app)/chat/chat-logic';
import type { Message, ReactionSummary } from '@/lib/csmju/types';

/// อิโมจิด่วนสามตัวบนแถบเครื่องมือตอนชี้ข้อความ (แบบ Discord)
export const QUICK_REACTIONS = ['👍', '❤️', '😂'] as const;

export interface MessageActions {
  onToggleReaction: (message: Message, emoji: string, mine: boolean) => void;
  onReply: (message: Message) => void;
  onThread: (message: Message) => void;
  onForward: (message: Message) => void;
  onEdit: (message: Message, content: string) => Promise<void>;
  onTogglePin: (message: Message) => void;
  onDelete: (message: Message) => void;
  onCopy: (message: Message) => void;
  onJump: (messageId: string) => void;
  onOpenUser: (coreUserId: string, rect: DOMRect) => void;
}

/// ข้อความหนึ่งแถวในห้องแบบ Discord
///
///   (รูป) ชื่อ  วันนี้ เวลา 14:05
///         เนื้อหา…
///         [ไฟล์แนบ]
///         [👍 3] [🔥 1]
///                                   [👍 ❤️ 😂 | 😊 ↩ ↪ ⋯]  ← โผล่ตอนชี้
///
/// `grouped` = ข้อความต่อเนื่องจากคนเดิม → ไม่ซ้ำรูปและชื่อ เวลาโผล่ที่ขอบซ้ายตอนชี้
export const ChannelMessage = memo(function ChannelMessage({
  channelId,
  message,
  grouped,
  reactions,
  isMine,
  canPin,
  canDelete,
  highlighted,
  actions,
}: {
  channelId: string;
  message: Message;
  grouped: boolean;
  reactions: ReactionSummary | null;
  isMine: boolean;
  canPin: boolean;
  canDelete: boolean;
  highlighted: boolean;
  actions: MessageActions;
}) {
  const pending = message.id.startsWith('pending-');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content ?? '');
  const [editError, setEditError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const emojiRef = useRef<HTMLButtonElement | null>(null);
  const author = useProfile(message.authorCoreUserId);
  const now = new Date();
  const mineOf = (emoji: string) =>
    reactions?.totals.find((row) => row.emoji === emoji)?.reactedByMe ?? false;

  const react = (emoji: string) => {
    rememberEmoji(emoji);
    actions.onToggleReaction(message, emoji, mineOf(emoji));
  };

  async function save() {
    const content = draft.trim();

    if (!content) return;

    setEditError(null);

    try {
      await actions.onEdit(message, content);
      setEditing(false);
    } catch (caught) {
      // เช่น "แก้ข้อความได้ภายใน 15 นาทีหลังส่ง"
      setEditError(caught instanceof Error ? caught.message : 'แก้ไม่สำเร็จ');
    }
  }

  const openUser = (event: React.MouseEvent<HTMLElement>) =>
    actions.onOpenUser(message.authorCoreUserId, event.currentTarget.getBoundingClientRect());

  const toolbarOpen = menuOpen || picking;

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      className={`group relative flex gap-4 px-4 pr-12 transition-colors hover:bg-accent/60 ${
        grouped ? 'py-0.5' : 'mt-3 py-0.5'
      } ${toolbarOpen ? 'bg-accent/60' : ''} ${highlighted ? 'bg-warning/15' : ''} ${
        message.pinnedAt ? 'border-l-2 border-primary/60' : ''
      } ${pending ? 'opacity-60' : ''}`}
    >
      {/* ขอบซ้าย: รูป หรือเวลาของข้อความที่ถูกยุบหัว */}
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="hidden pt-1 text-right text-[10px] leading-5 text-muted-foreground group-hover:block">
            {timeLabel(message.createdAt)}
          </span>
        ) : (
          <button
            type="button"
            onClick={openUser}
            className="mt-0.5 rounded-full"
            aria-label={`ดูโปรไฟล์ของ ${author.displayName}`}
          >
            <Avatar coreUserId={message.authorCoreUserId} size={40} showOnline={false} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.replyTo && (
          <button
            type="button"
            onClick={() => actions.onJump(message.replyTo!.id)}
            className="mb-0.5 flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <CornerUpLeft className="size-3.5 shrink-0" aria-hidden />
            <Avatar coreUserId={message.replyTo.authorCoreUserId} size={16} showOnline={false} />
            <ReplyAuthor coreUserId={message.replyTo.authorCoreUserId} />
            <span className="truncate">
              {message.replyTo.deleted
                ? 'ข้อความต้นฉบับถูกลบแล้ว'
                : (message.replyTo.preview ?? 'ไฟล์แนบ')}
            </span>
          </button>
        )}

        {!grouped && (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <button
              type="button"
              onClick={openUser}
              className="inline-flex items-center gap-1 text-[15px] font-semibold leading-snug hover:underline"
            >
              {author.displayName}
              <VerifiedBadge badge={author.badge} className="size-3.5" />
            </button>
            <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
              {stampLabel(message.createdAt, now)}
            </time>
            {pending && <span className="text-xs text-muted-foreground">กำลังส่ง…</span>}
          </p>
        )}

        {editing ? (
          <div className="my-1">
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void save();
                }
                if (event.key === 'Escape') setEditing(false);
              }}
              aria-label="แก้ข้อความ"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Esc เพื่อ
              <button type="button" onClick={() => setEditing(false)} className="mx-1 text-primary hover:underline">
                ยกเลิก
              </button>
              · Enter เพื่อ
              <button type="button" onClick={() => void save()} className="mx-1 text-primary hover:underline">
                บันทึก
              </button>
              {editError && <span className="ml-2 text-destructive">{editError}</span>}
            </p>
          </div>
        ) : (
          message.content && (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {message.forwarded && (
                <span className="mr-1.5 inline-flex items-center gap-1 align-middle text-xs italic text-muted-foreground">
                  <CornerUpRight className="size-3" aria-hidden /> ส่งต่อแล้ว
                </span>
              )}
              {message.content}
              {message.editedAt && (
                <span className="ml-1 text-[10px] text-muted-foreground">(แก้ไขแล้ว)</span>
              )}
            </p>
          )
        )}

        <AttachmentList attachments={message.attachments} />

        <ReactionChips
          channelId={channelId}
          messageId={message.id}
          summary={reactions}
          disabled={pending}
          onToggle={(emoji, mine) => {
            rememberEmoji(emoji);
            actions.onToggleReaction(message, emoji, mine);
          }}
        />

        {message.replyCount > 0 && (
          <button
            type="button"
            onClick={() => actions.onThread(message)}
            className="mt-1 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <MessagesSquare className="size-3.5" aria-hidden />
            {message.replyCount} คำตอบในเธรด
          </button>
        )}
      </div>

      {/* แถบเครื่องมือลอยมุมขวาบนตอนชี้ */}
      {!pending && !editing && (
        <div
          role="toolbar"
          aria-label="การทำงานกับข้อความ"
          className={`absolute -top-4 right-4 z-10 items-center rounded-md border border-border bg-popover p-0.5 shadow-csmju-sm ${
            toolbarOpen ? 'flex' : 'hidden group-focus-within:flex group-hover:flex'
          }`}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <ToolButton key={emoji} label={`รีแอ็กด้วย ${emoji}`} onClick={() => react(emoji)}>
              <span style={{ fontFamily: EMOJI_FONT }} className="text-base leading-none">
                {emoji}
              </span>
            </ToolButton>
          ))}
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <ToolButton
            ref={emojiRef}
            label="เพิ่มรีแอ็กชัน"
            onClick={() => setPicking((open) => !open)}
            expanded={picking}
          >
            <SmilePlus className="size-[18px]" />
          </ToolButton>
          <ToolButton label="ตอบกลับ" onClick={() => actions.onReply(message)}>
            <CornerUpLeft className="size-[18px]" />
          </ToolButton>
          <ToolButton label="ส่งต่อ" onClick={() => actions.onForward(message)}>
            <Forward className="size-[18px]" />
          </ToolButton>
          <ToolButton
            ref={menuRef}
            label="ตัวเลือกเพิ่มเติม"
            onClick={() => setMenuOpen((open) => !open)}
            expanded={menuOpen}
          >
            <MoreHorizontal className="size-[18px]" />
          </ToolButton>
        </div>
      )}

      <EmojiPopover
        anchorRef={emojiRef}
        open={picking}
        onClose={() => setPicking(false)}
        variant="reaction"
        closeOnPick
        onPick={react}
      />

      <RoomPopover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={{ ref: menuRef }}
        side="bottom"
        align="end"
        width={210}
        role="menu"
        label="ตัวเลือกของข้อความ"
        className="p-1.5"
      >
        {isMine && message.content !== null && (
          <MenuItem
            icon={Pencil}
            onClick={() => {
              setMenuOpen(false);
              setDraft(message.content ?? '');
              setEditError(null);
              setEditing(true);
            }}
          >
            แก้ไขข้อความ
          </MenuItem>
        )}
        <MenuItem icon={CornerUpLeft} onClick={() => { setMenuOpen(false); actions.onReply(message); }}>
          ตอบกลับ
        </MenuItem>
        <MenuItem icon={MessagesSquare} onClick={() => { setMenuOpen(false); actions.onThread(message); }}>
          {message.replyCount > 0 ? 'เปิดเธรด' : 'สร้างเธรด'}
        </MenuItem>
        <MenuItem icon={Forward} onClick={() => { setMenuOpen(false); actions.onForward(message); }}>
          ส่งต่อ
        </MenuItem>
        {canPin && (
          <MenuItem
            icon={message.pinnedAt ? PinOff : Pin}
            onClick={() => { setMenuOpen(false); actions.onTogglePin(message); }}
          >
            {message.pinnedAt ? 'ถอนหมุดข้อความ' : 'ปักหมุดข้อความ'}
          </MenuItem>
        )}
        {message.content && (
          <MenuItem icon={Copy} onClick={() => { setMenuOpen(false); actions.onCopy(message); }}>
            คัดลอกข้อความ
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => { setMenuOpen(false); actions.onDelete(message); }}
          >
            ลบข้อความ
          </MenuItem>
        )}
      </RoomPopover>
    </div>
  );
});

function ReplyAuthor({ coreUserId }: { coreUserId: string }) {
  return (
    <span className="shrink-0 font-semibold text-foreground/80">
      @{useProfile(coreUserId).displayName}
    </span>
  );
}

function ToolButton({
  ref,
  label,
  onClick,
  expanded,
  children,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  label: string;
  onClick: () => void;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  danger = false,
  children,
}: {
  icon: typeof Pin;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm transition-colors ${
        danger
          ? 'text-destructive hover:bg-destructive hover:text-white'
          : 'hover:bg-primary hover:text-primary-foreground'
      }`}
    >
      {children}
      <Icon className="size-4 shrink-0" aria-hidden />
    </button>
  );
}
