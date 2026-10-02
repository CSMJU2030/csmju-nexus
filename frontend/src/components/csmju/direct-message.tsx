'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Copy,
  CornerUpLeft,
  Forward,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SmilePlus,
  Phone,
  PhoneMissed,
  Undo2,
  Video,
} from 'lucide-react';
import { AttachmentList } from '@/components/csmju/attachment-list';
import { VoiceMessage } from '@/components/csmju/direct-voice';
import { EMOJI_FONT, EmojiPopover, isEmojiOnly } from '@/components/csmju/emoji-picker';
import { MenuItem, PopMenu } from '@/components/csmju/messages-menu';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { useAssetUrl } from '@/lib/csmju/asset-url';
import { threadStamp } from '@/lib/csmju/time';
import type { CallLog, Message, MessageEmbed, ReactionSummary } from '@/lib/csmju/types';

/// ฟองข้อความหนึ่งฟองของบทสนทนาแบบ Instagram Direct พร้อมปุ่มที่โผล่ตอนชี้
///
///   ชี้ที่ฟอง → ⋮ · ↩ ตอบกลับ · 😊 รีแอ็กชัน (ฝั่งซ้ายของฟองเรา / ขวาของฟองเขา)
///   ⋮        → เวลา (· มีการแก้ไข) · แก้ไข · ส่งต่อ · คัดลอก · ปักหมุด · ยกเลิกการส่ง
///
/// แยกจาก direct-thread.tsx เพราะไฟล์นั้นถือเรื่องการรับส่ง (socket · REST · แคช)
/// ส่วนไฟล์นี้ถือเรื่องหน้าตาของข้อความล้วน ๆ — ทุกการกระทำส่งกลับขึ้นไปผ่าน
/// `onAction` ให้ตัวบทสนทนาเป็นคนยิงหลังบ้านที่เดียว

/// ห่างกันเกินเท่านี้ = ขึ้นป้ายเวลาคั่นและเริ่มกลุ่มฟองใหม่ (ตามที่ IG ทำ)
const GROUP_GAP_MS = 15 * 60_000;

/// หลังบ้านรับการแก้ข้อความภายใน 15 นาทีหลังส่ง (EDIT_WINDOW_MS) — เกินกว่านั้น
/// ไม่ขึ้นปุ่ม "แก้ไข" เลย ดีกว่าให้กดแล้วได้ 400
export const EDIT_WINDOW_MS = 15 * 60_000;

/// อิโมจิแถวแรกของแผงรีแอ็กชัน — ชุดเดียวกับ IG · ปุ่ม + เปิดแผงอิโมจิเต็มชุด
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😠', '👍'] as const;

export const isPending = (message: Message) => message.id.startsWith('pending-');

/// บันทึกการโทรของข้อความ (การ์ด "การโทรด้วยเสียง" ของ IG) — หลังบ้านรุ่นก่อนหน้า
/// ไม่ส่งช่องนี้มาเลย ไม่มีช่อง = ข้อความธรรมดา ไม่เดาว่าเป็นการโทร
export type { CallLog };

export function callLogOf(message: Message): CallLog | null {
  return message.callLog ?? null;
}

export type MessageAction =
  | 'reply'
  | 'edit'
  | 'forward'
  | 'copy'
  | 'pin'
  | 'unpin'
  | 'unsend';

/// ความสามารถของห้อง/ผู้ใช้ที่ตัดสินว่าเมนู ⋮ มีรายการไหนบ้าง
///
/// ไม่ขึ้นรายการที่หลังบ้านจะปฏิเสธ — กดแล้วได้ 403 แย่กว่าไม่มีปุ่ม
export interface MessageAbilities {
  /// ปักหมุดได้ไหม (หลังบ้าน: ผู้ดูแลห้อง อาจารย์ หรือ admin)
  pin: boolean;
  /// ตอบกลับแบบอ้างอิงข้อความได้ไหม
  reply: boolean;
  /// ส่งต่อได้ไหม
  forward: boolean;
}

export function MessageList({
  messages,
  reactions,
  myId,
  dock,
  group,
  peerReadSeq,
  abilities,
  highlightId,
  nameOf,
  onReact,
  onAction,
  onJump,
  onCallBack,
}: {
  messages: Message[];
  reactions: Record<string, ReactionSummary | null>;
  myId: string;
  dock: boolean;
  group: boolean;
  peerReadSeq: number | null;
  abilities: MessageAbilities;
  /// ข้อความที่เพิ่งกระโดดไปหา (จากแถบปักหมุด/ข้อความที่อ้างอิง) — กะพริบให้เห็น
  highlightId: string | null;
  /// ชื่อที่ใช้ในห้องนี้ (ชื่อเล่นถ้ามี) — null = ใช้ชื่อที่แสดงตามปกติ
  nameOf?: (coreUserId: string) => string | null;
  onReact: (messageId: string, emoji: string) => void;
  onAction: (action: MessageAction, message: Message) => void;
  /// กดกล่องข้อความที่อ้างอิง → กระโดดไปที่ข้อความต้นทาง
  onJump: (messageId: string) => void;
  /// ปุ่ม "โทรกลับ" ของการ์ดการโทร · ไม่ส่งมา = โทรไม่ได้ในบริบทนี้ (ไม่ขึ้นปุ่ม)
  onCallBack?: (media: CallLog['media']) => void;
}) {
  const byId = new Map(messages.map((row) => [row.id, row]));
  let lastMineIndex = -1;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].authorCoreUserId === myId) {
      lastMineIndex = i;
      break;
    }
  }

  return (
    <ul aria-label="ข้อความ" className="flex flex-col">
      {messages.map((message, index) => {
        const prev = messages[index - 1];
        const next = messages[index + 1];
        const at = Date.parse(message.createdAt);
        const stamp = !prev || at - Date.parse(prev.createdAt) > GROUP_GAP_MS;
        const joinedPrev = !stamp && prev?.authorCoreUserId === message.authorCoreUserId;
        const joinedNext =
          next !== undefined &&
          next.authorCoreUserId === message.authorCoreUserId &&
          Date.parse(next.createdAt) - at <= GROUP_GAP_MS;

        // ป้ายใต้ข้อความสุดท้ายของเรา เฉพาะเมื่อมันเป็นข้อความท้ายสุดของห้อง
        // และเซิร์ฟเวอร์ยืนยันแล้ว — "เห็นแล้ว" เมื่ออีกฝ่ายอ่านถึง seq นี้จริง
        const receipt =
          index === lastMineIndex &&
          index === messages.length - 1 &&
          !isPending(message) &&
          // การ์ดการโทรไม่ใช่ข้อความที่ "ส่ง" — ไม่มีป้ายส่งแล้ว/เห็นแล้วแบบ IG
          !callLogOf(message)
            ? peerReadSeq !== null && peerReadSeq >= message.seq
              ? 'เห็นแล้ว'
              : 'ส่งแล้ว'
            : null;

        return (
          <MessageRow
            key={message.id}
            message={message}
            mine={message.authorCoreUserId === myId}
            stamp={stamp}
            joinedPrev={joinedPrev}
            joinedNext={joinedNext}
            receipt={receipt}
            showSender={group && !joinedPrev}
            summary={reactions[message.id] ?? null}
            dock={dock}
            abilities={abilities}
            highlighted={highlightId === message.id}
            nameOf={nameOf}
            myId={myId}
            original={message.replyTo ? (byId.get(message.replyTo.id) ?? null) : null}
            onReact={onReact}
            onAction={onAction}
            onJump={onJump}
            onCallBack={onCallBack}
          />
        );
      })}
    </ul>
  );
}

/// ชื่อของคนในห้องนี้ — ชื่อเล่นที่ตั้งไว้ในห้องมาก่อนชื่อที่แสดง
export function MemberName({
  coreUserId,
  nameOf,
}: {
  coreUserId: string;
  nameOf?: (coreUserId: string) => string | null;
}) {
  const profile = useProfile(coreUserId);

  return <>{nameOf?.(coreUserId) ?? profile.displayName}</>;
}

/// ข้อความตัวอย่างสั้น ๆ ของข้อความ — ใช้ในแถบปักหมุด แถบตอบกลับ และกล่องยืนยัน
export function messagePreview(
  message: Pick<Message, 'content' | 'attachments'> & Partial<Pick<Message, 'embed'>>,
): string {
  const text = message.content?.replace(/\s+/g, ' ').trim();

  if (text) return text;

  const kind = message.attachments[0]?.kind;
  const embed = (message as Partial<Pick<Message, 'embed'>>).embed;

  if (embed?.kind === 'POST') return 'แชร์โพสต์';
  if (embed?.kind === 'REEL') return 'แชร์คลิปสั้น';
  if (embed?.kind === 'STORY') return 'สตอรี่';
  if (kind === 'IMAGE') return 'รูปภาพ';
  if (kind === 'VIDEO') return 'วิดีโอ';
  if (kind === 'AUDIO') return 'ข้อความเสียง';

  return message.attachments.length > 0 ? 'ไฟล์แนบ' : 'ข้อความ';
}

function MessageRow({
  message,
  mine,
  stamp,
  joinedPrev,
  joinedNext,
  receipt,
  showSender,
  summary,
  dock,
  abilities,
  highlighted,
  nameOf,
  myId,
  original,
  onReact,
  onAction,
  onJump,
  onCallBack,
}: {
  message: Message;
  mine: boolean;
  stamp: boolean;
  joinedPrev: boolean;
  joinedNext: boolean;
  receipt: 'ส่งแล้ว' | 'เห็นแล้ว' | null;
  showSender: boolean;
  summary: ReactionSummary | null;
  dock: boolean;
  abilities: MessageAbilities;
  highlighted: boolean;
  nameOf?: (coreUserId: string) => string | null;
  myId: string;
  /// ข้อความต้นทางที่ตอบกลับ ถ้าโหลดอยู่ในหน้าจอ (ใช้ทำรูปย่อของกล่องอ้างอิง)
  original: Message | null;
  onReact: (messageId: string, emoji: string) => void;
  onAction: (action: MessageAction, message: Message) => void;
  onJump: (messageId: string) => void;
  onCallBack?: (media: CallLog['media']) => void;
}) {
  const call = callLogOf(message);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [fullPicker, setFullPicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const pending = isPending(message);
  const content = message.content?.trim() ?? '';
  const jumbo = isEmojiOnly(content);
  const totals = summary?.totals.filter((row) => row.count > 0) ?? [];
  const voice = message.attachments.filter((file) => file.kind === 'AUDIO');
  const files = message.attachments.filter((file) => file.kind !== 'AUDIO');
  const pinned = Boolean(message.pinnedAt);

  // แก้ได้เฉพาะข้อความตัวอักษรของเราเองภายใน 15 นาที (เหมือนหลังบ้าน)
  // — คำนวณตอนเปิดเมนู ไม่ใช่ตอนวาด เพราะเวลาเดินไปเรื่อย ๆ ระหว่างที่หน้าเปิดค้าง
  const [editable, setEditable] = useState(false);

  // มุมที่ต่อกับฟองข้างบน/ข้างล่างของคนเดียวกันจะเหลี่ยมลง — ทำให้อ่านออกว่า
  // เป็นก้อนเดียวกันโดยไม่ต้องมีชื่อคนส่งซ้ำทุกฟอง
  const corners = mine
    ? `${joinedPrev ? 'rounded-tr-[4px]' : ''} ${joinedNext ? 'rounded-br-[4px]' : ''}`
    : `${joinedPrev ? 'rounded-tl-[4px]' : ''} ${joinedNext ? 'rounded-bl-[4px]' : ''}`;

  const openPicker = (target: HTMLElement) => {
    triggerRef.current = target;
    setFullPicker(false);
    setPicker((open) => (open ? null : target));
  };

  const act = (action: MessageAction) => {
    setMenuOpen(false);
    onAction(action, message);
  };

  const hoverClass = `grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 ${
    // จอสัมผัสไม่มี hover — ถ้าซ่อนสนิทจะไม่มีทางกดได้เลยบนมือถือ
    picker || fullPicker || menuOpen ? 'opacity-100' : 'opacity-0 pointer-coarse:opacity-40'
  }`;

  const moreButton = (
    <button
      ref={menuRef}
      type="button"
      onClick={() => {
        setEditable(
          mine && content !== '' && Date.now() - Date.parse(message.createdAt) < EDIT_WINDOW_MS,
        );
        setMenuOpen((open) => !open);
      }}
      aria-label="ตัวเลือกของข้อความ"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      title="ตัวเลือกเพิ่มเติม"
      className={hoverClass}
    >
      <MoreVertical className="size-4" strokeWidth={1.9} />
    </button>
  );

  const replyButton = abilities.reply && (
    <button
      type="button"
      onClick={() => onAction('reply', message)}
      aria-label="ตอบกลับ"
      title="ตอบกลับ"
      className={hoverClass}
    >
      <CornerUpLeft className="size-4" strokeWidth={1.9} />
    </button>
  );

  const reactButton = (
    <button
      type="button"
      onClick={(event) => openPicker(event.currentTarget)}
      aria-label="รีแอ็กชันข้อความนี้"
      aria-expanded={picker !== null || fullPicker}
      title="รีแอ็กชัน"
      className={hoverClass}
    >
      <SmilePlus className="size-4" strokeWidth={1.9} />
    </button>
  );

  // ลำดับแบบ IG: ฟองเรา ⋮ ↩ 😊 [ฟอง] · ฟองเขา [ฟอง] 😊 ↩ ⋮ — ปุ่มที่ใช้บ่อย
  // (รีแอ็กชัน) อยู่ชิดฟองที่สุด
  const actions = !pending && !call && (
    <span className={`flex shrink-0 items-center self-center ${mine ? '' : 'flex-row-reverse'}`}>
      {moreButton}
      {replyButton}
      {reactButton}
    </span>
  );

  const reply = message.replyTo ?? null;
  const storyReply = message.storyReply ?? null;
  const embed = message.embed;
  const hasLabel = Boolean(message.editedAt || pinned || message.forwarded || reply);

  return (
    <>
      {stamp && (
        <li aria-hidden className="py-3 text-center text-xs font-medium text-muted-foreground">
          {threadStamp(message.createdAt)}
        </li>
      )}

      {showSender && !mine && (
        <li aria-hidden className="ml-9 mt-2 px-3 text-xs text-muted-foreground">
          <MemberName coreUserId={message.authorCoreUserId} nameOf={nameOf} />
        </li>
      )}

      <li
        id={`message-${message.id}`}
        data-message-id={message.id}
        className={`group flex items-end gap-1 rounded-2xl transition-colors duration-700 ${
          mine ? 'justify-end' : 'justify-start'
        } ${joinedPrev || (showSender && !mine) ? 'mt-0.5' : stamp ? '' : 'mt-2'} ${
          pending ? 'opacity-70' : ''
        } ${highlighted ? 'bg-accent' : ''}`}
      >
        {!mine &&
          (joinedNext ? (
            <span aria-hidden className="mr-1 w-7 shrink-0" />
          ) : (
            <span className="mr-1 shrink-0">
              <Avatar coreUserId={message.authorCoreUserId} size={28} showOnline={false} />
            </span>
          ))}

        {mine && actions}

        <div
          className={`flex min-w-0 flex-col ${mine ? 'items-end' : 'items-start'} ${
            dock ? 'max-w-[72%]' : 'max-w-[60%] max-md:max-w-[74%]'
          }`}
        >
          {hasLabel && (
            <span className="mb-0.5 flex flex-wrap items-center gap-x-1 px-3 text-[11px] text-muted-foreground">
              {reply && (
                <span className="inline-flex items-center gap-0.5">
                  <CornerUpLeft aria-hidden className="size-3" />
                  <ReplyLabel
                    author={message.authorCoreUserId}
                    target={reply.authorCoreUserId}
                    myId={myId}
                    nameOf={nameOf}
                  />
                </span>
              )}
              {message.forwarded && (
                <span className="inline-flex items-center gap-0.5">
                  <Forward aria-hidden className="size-3" />
                  ส่งต่อแล้ว
                </span>
              )}
              {message.editedAt && <span className="text-link">มีการแก้ไข</span>}
              {pinned && (
                <span className="inline-flex items-center gap-0.5">
                  {(reply || message.forwarded || message.editedAt) && '· '}
                  <Pin aria-hidden className="size-3 rotate-45" />
                  ปักหมุดแล้ว
                </span>
              )}
            </span>
          )}

          {reply && (
            <ReplyQuote
              reply={reply}
              original={original}
              mine={mine}
              onJump={() => onJump(reply.id)}
            />
          )}

          {storyReply && embed?.kind === 'STORY' && (
            <StoryReplyHeader
              embed={embed}
              mine={mine}
              myId={myId}
              author={message.authorCoreUserId}
              nameOf={nameOf}
            />
          )}

          {embed && !storyReply && (embed.kind === 'POST' || embed.kind === 'REEL' || embed.kind === 'STORY') && (
            <EmbedCard embed={embed} nameOf={nameOf} />
          )}

          {storyReply?.emoji && content === '' && (
            <span style={{ fontFamily: EMOJI_FONT }} className="px-1 text-[2.75rem] leading-[1.15]">
              {storyReply.emoji}
            </span>
          )}

          {call && <CallCard call={call} myId={myId} onCallBack={onCallBack} />}

          {!call && content !== '' &&
            (jumbo ? (
              // อิโมจิล้วน 1–3 ตัว = ตัวใหญ่ไม่มีฟอง แบบ IG
              <span
                style={{ fontFamily: EMOJI_FONT }}
                className="px-1 text-[2.75rem] leading-[1.15]"
                onDoubleClick={() => {
                  if (!pending) onReact(message.id, '❤️');
                }}
              >
                {content}
              </span>
            ) : (
              <div
                title={new Date(message.createdAt).toLocaleString('th-TH')}
                // ดับเบิลคลิก = ❤️ แบบ IG — ใส่อย่างเดียว ไม่ถอน (ดับเบิลคลิกซ้ำ
                // ไม่ควรลบหัวใจที่ตั้งใจกดไว้) · ตัวชั่วคราวยังไม่มี id จริงให้ผูก
                onDoubleClick={() => {
                  const hearted = totals.some((row) => row.emoji === '❤️' && row.reactedByMe);

                  if (!pending && !hearted) onReact(message.id, '❤️');
                }}
                className={`whitespace-pre-wrap break-words rounded-[22px] px-3 py-[7px] text-[15px] leading-[1.35] ${corners} ${
                  mine
                    ? 'bg-[var(--bubble-mine)] text-white'
                    : 'bg-[var(--bubble-theirs)] text-foreground'
                }`}
              >
                {content}
              </div>
            ))}

          {voice.map((file) => (
            <div key={file.id} className={content ? 'mt-1' : ''}>
              <VoiceMessage attachment={file} mine={mine} />
            </div>
          ))}

          {/* ไฟล์แนบไม่อยู่ในฟอง — รูปในฟองสีฟ้าดูเหมือนกรอบรูป ไม่ใช่รูป */}
          {files.length > 0 && (
            <div className="w-full min-w-48 max-w-xs">
              <AttachmentList attachments={files} />
            </div>
          )}

          {totals.length > 0 && (
            <button
              type="button"
              onClick={(event) => openPicker(event.currentTarget)}
              aria-label={`รีแอ็กชัน ${totals.map((row) => `${row.emoji} ${row.count}`).join(' ')}`}
              style={{ fontFamily: EMOJI_FONT }}
              className="relative z-10 -mt-1.5 flex items-center gap-0.5 rounded-full border-2 border-background bg-muted px-1.5 text-sm leading-6"
            >
              {totals.slice(0, 3).map((row) => (
                <span key={row.emoji} aria-hidden>
                  {row.emoji}
                </span>
              ))}
              {(summary?.totalCount ?? 0) > 1 && (
                <span className="font-sans text-xs text-muted-foreground tabular-nums">
                  {summary?.totalCount}
                </span>
              )}
            </button>
          )}

          {pending && (
            <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">กำลังส่ง…</span>
          )}

          {receipt && (
            <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">{receipt}</span>
          )}
        </div>

        {!mine && actions}
      </li>

      <PopMenu
        anchorRef={menuRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        label="ตัวเลือกของข้อความ"
        width={232}
      >
        {/* หัวเมนูบอกเวลาที่ส่ง (· มีการแก้ไข) แบบ IG — ไม่ใช่รายการที่กดได้ */}
        <p className="border-b border-border px-4 pb-2 pt-1.5 text-xs text-muted-foreground">
          {new Date(message.createdAt).toLocaleString('th-TH', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {message.editedAt ? ' · มีการแก้ไข' : ''}
        </p>

        {editable && (
          <MenuItem trailing icon={<Pencil className="size-4" />} onSelect={() => act('edit')}>
            แก้ไข
          </MenuItem>
        )}
        {abilities.forward && (
          <MenuItem trailing icon={<Forward className="size-4" />} onSelect={() => act('forward')}>
            ส่งต่อ
          </MenuItem>
        )}
        {content !== '' && (
          <MenuItem trailing icon={<Copy className="size-4" />} onSelect={() => act('copy')}>
            คัดลอก
          </MenuItem>
        )}
        {abilities.pin && (
          <MenuItem
            trailing
            icon={pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            onSelect={() => act(pinned ? 'unpin' : 'pin')}
          >
            {pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}
          </MenuItem>
        )}
        {mine && (
          <MenuItem
            trailing
            tone="danger"
            icon={<Undo2 className="size-4" />}
            onSelect={() => act('unsend')}
          >
            ยกเลิกการส่ง
          </MenuItem>
        )}
      </PopMenu>

      {picker && (
        <ReactionPicker
          anchor={picker}
          summary={summary}
          onPick={(emoji) => {
            setPicker(null);
            onReact(message.id, emoji);
          }}
          onMore={() => {
            setPicker(null);
            setFullPicker(true);
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {/* ปุ่ม + ของแถวรีแอ็กชัน = แผงอิโมจิเต็มชุด (ค้นหาไทยได้) ตัวเดียวกับช่องพิมพ์ */}
      <EmojiPopover
        anchorRef={triggerRef}
        open={fullPicker}
        variant="reaction"
        closeOnPick
        onClose={() => setFullPicker(false)}
        onPick={(emoji) => onReact(message.id, emoji)}
      />
    </>
  );
}

function mmss(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/// การ์ดประวัติการโทรแบบ IG: ไอคอน · ชนิดสาย/ผล · ความยาวหรือเวลา · "โทรกลับ"
///
/// ไม่ได้รับสายเป็นสีแดง · การ์ดนี้ไม่มีเมนู ⋮/ตอบกลับ/ส่งต่อ เพราะไม่ใช่คำพูดของใคร
export function CallCard({
  call,
  myId,
  onCallBack,
}: {
  call: CallLog;
  myId: string;
  onCallBack?: (media: CallLog['media']) => void;
}) {
  const video = call.media === 'VIDEO';
  // endedAt = null = สายยังไม่จบ — ระหว่างรอรับ status เป็น MISSED และระหว่างคุยเป็น
  // ANSWERED ที่ยังไม่มีความยาว จึงห้ามอ่าน status จนกว่าจะจบจริง
  const live = call.endedAt === null;
  const missed = !live && call.status === 'MISSED';
  const title = live
    ? 'กำลังโทร…'
    : call.status === 'MISSED'
      ? 'ไม่ได้รับสาย'
      : call.status === 'DECLINED'
        ? 'ปฏิเสธสาย'
        : call.status === 'CANCELLED'
          ? 'ยกเลิกแล้ว'
          : video
            ? 'วิดีโอคอล'
            : 'การโทรด้วยเสียง';
  const at = new Date(call.startedAt).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const subtitle =
    !live && call.status === 'ANSWERED' && call.durationSec !== null
      ? mmss(call.durationSec)
      : `${video ? 'วิดีโอคอล' : 'สายเสียง'} · ${call.callerCoreUserId === myId ? 'คุณโทรออก' : 'สายเข้า'} ${at}`;
  const Icon = missed ? PhoneMissed : video ? Video : Phone;

  return (
    <div className="w-64 overflow-hidden rounded-2xl bg-[var(--bubble-theirs)] text-foreground">
      <div className="flex items-center gap-3 px-3 py-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full ${
            missed ? 'bg-destructive/15 text-destructive' : 'bg-background/60'
          }`}
        >
          <Icon aria-hidden className="size-5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${missed ? 'text-destructive' : ''}`}>
            {title}
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">{subtitle}</span>
        </span>
      </div>

      {/* ระหว่างที่สายยังไม่จบไม่มี "โทรกลับ" — สายนั้นยังเปิดอยู่ */}
      {onCallBack && !live && (
        <button
          type="button"
          onClick={() => onCallBack(call.media)}
          className="block w-full border-t border-border py-2.5 text-sm font-semibold text-link transition-colors hover:bg-accent"
        >
          โทรกลับ
        </button>
      )}
    </div>
  );
}

/// "คุณตอบกลับ…" เหนือข้อความที่ตอบกลับ — ข้อความเดียวกับที่ IG ใช้ทุกกรณี
function ReplyLabel({
  author,
  target,
  myId,
  nameOf,
}: {
  author: string;
  target: string;
  myId: string;
  nameOf?: (coreUserId: string) => string | null;
}) {
  if (author === myId) {
    return target === myId ? (
      <>คุณได้ตอบกลับตัวคุณเอง</>
    ) : (
      <>
        คุณตอบกลับ <MemberName coreUserId={target} nameOf={nameOf} />
      </>
    );
  }

  return (
    <>
      <MemberName coreUserId={author} nameOf={nameOf} />{' '}
      {target === myId ? (
        'ตอบกลับคุณ'
      ) : target === author ? (
        'ตอบกลับตัวเอง'
      ) : (
        <>
          ตอบกลับ <MemberName coreUserId={target} nameOf={nameOf} />
        </>
      )}
    </>
  );
}

/// กล่องจาง ๆ ของข้อความที่ถูกอ้างอิง — กดแล้วกระโดดไปที่ข้อความต้นทาง
function ReplyQuote({
  reply,
  original,
  mine,
  onJump,
}: {
  reply: NonNullable<Message['replyTo']>;
  original: Message | null;
  mine: boolean;
  onJump: () => void;
}) {
  // รูปย่อมาได้เฉพาะเมื่อข้อความต้นทางอยู่ในหน้าจอ — หลังบ้านส่งมาแค่ชนิดไฟล์
  const image =
    original?.attachments.find((file) => file.kind === 'IMAGE' || file.kind === 'VIDEO') ?? null;
  const { url } = useAssetUrl(!reply.deleted && image?.kind === 'IMAGE' ? image.id : null);

  const text = reply.deleted
    ? 'ข้อความถูกลบ'
    : (reply.preview ??
      (reply.attachmentKind === 'IMAGE'
        ? 'รูปภาพ'
        : reply.attachmentKind === 'VIDEO'
          ? 'วิดีโอ'
          : reply.attachmentKind === 'AUDIO'
            ? 'ข้อความเสียง'
            : 'ไฟล์แนบ'));

  if (url) {
    return (
      <button
        type="button"
        onClick={onJump}
        aria-label={`ไปที่ข้อความที่ตอบกลับ: ${text}`}
        className="mb-[-10px] overflow-hidden rounded-2xl opacity-60 transition-opacity hover:opacity-80"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL อายุสั้น ใช้ next/image ไม่ได้ */}
        <img src={url} alt="" className="h-28 w-auto max-w-40 object-cover" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onJump}
      disabled={reply.deleted}
      aria-label={`ไปที่ข้อความที่ตอบกลับ: ${text}`}
      className={`mb-[-10px] max-w-full truncate rounded-[18px] border border-border px-3 pb-3 pt-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:italic ${
        mine ? 'self-end' : 'self-start'
      }`}
    >
      {text}
    </button>
  );
}

/// ปลายทางของการ์ดแชร์ — หน้าโพสต์ · คลิปสั้น · ตัวดูสตอรี่ของฟีด
export function embedHref(embed: MessageEmbed): string {
  const id = encodeURIComponent(embed.targetId ?? embed.refId);

  if (embed.kind === 'POST') return `/p/${id}`;
  if (embed.kind === 'REEL') return `/reels?reel=${id}`;

  return `/feed?story=${id}`;
}

function EmbedThumb({ embed, className }: { embed: MessageEmbed; className: string }) {
  if (!embed.thumbnailUrl) return null;

  return embed.thumbnailKind === 'VIDEO' ? (
    <video
      src={embed.thumbnailUrl}
      preload="metadata"
      muted
      playsInline
      className={className}
    >
      <track kind="captions" label="ไม่มีคำบรรยาย" />
    </video>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL อายุสั้น ใช้ next/image ไม่ได้
    <img src={embed.thumbnailUrl} alt="" className={className} />
  );
}

/// การ์ดแชร์โพสต์/คลิป/สตอรี่แบบ IG: แถวเจ้าของ · รูปย่อ · คำบรรยาย — กดแล้วเปิดของจริง
///
/// `available: false` (ถูกลบ · สตอรี่หมดอายุ · บล็อกกัน) ขึ้นกล่องเทาแบบ IG
/// แทนการเดาเนื้อหา — หลังบ้านไม่ส่งชื่อ/รูปมาในกรณีนี้อยู่แล้ว
export function EmbedCard({
  embed,
  nameOf,
}: {
  embed: MessageEmbed;
  nameOf?: (coreUserId: string) => string | null;
}) {
  if (embed.available === false) {
    return (
      <p className="w-60 rounded-2xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
        ข้อความนี้ไม่พร้อมใช้งาน
      </p>
    );
  }

  const kindLabel = embed.kind === 'POST' ? 'โพสต์' : embed.kind === 'REEL' ? 'คลิปสั้น' : 'สตอรี่';

  return (
    <Link
      href={embedHref(embed)}
      aria-label={`เปิด${kindLabel}${embed.title ? `: ${embed.title}` : ''}`}
      className="block w-60 overflow-hidden rounded-2xl bg-[var(--bubble-theirs)] text-foreground transition-opacity hover:opacity-90"
    >
      {embed.authorCoreUserId && (
        <span className="flex items-center gap-2 px-3 py-2">
          <Avatar coreUserId={embed.authorCoreUserId} size={28} showOnline={false} />
          <span className="truncate text-sm font-semibold">
            <MemberName coreUserId={embed.authorCoreUserId} nameOf={nameOf} />
          </span>
        </span>
      )}

      {embed.thumbnailUrl ? (
        <EmbedThumb
          embed={embed}
          className={`w-full bg-black object-cover ${embed.kind === 'POST' ? 'aspect-square' : 'aspect-[9/16] max-h-80'}`}
        />
      ) : (
        <span className="block px-3 pb-1 text-xs text-muted-foreground">{kindLabel}</span>
      )}

      {(embed.title || embed.preview) && (
        <span className="block px-3 py-2 text-[13px] leading-snug">
          {embed.title && <span className="block font-semibold">{embed.title}</span>}
          {embed.preview && (
            <span className="line-clamp-2 text-muted-foreground">{embed.preview}</span>
          )}
        </span>
      )}
    </Link>
  );
}

/// "ตอบกลับสตอรี่ของคุณ" + รูปย่อของสตอรี่ที่ถูกตอบ (ข้อความ/อิโมจิอยู่ใต้)
function StoryReplyHeader({
  embed,
  mine,
  myId,
  author,
  nameOf,
}: {
  embed: MessageEmbed;
  mine: boolean;
  myId: string;
  author: string;
  nameOf?: (coreUserId: string) => string | null;
}) {
  const owner = embed.authorCoreUserId ?? null;

  return (
    <span className={`mb-1 flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      <span className="px-3 text-[11px] text-muted-foreground">
        {mine ? 'คุณ' : <MemberName coreUserId={author} nameOf={nameOf} />}{' '}
        {owner === myId ? (
          'ตอบกลับสตอรี่ของคุณ'
        ) : owner ? (
          <>
            ตอบกลับสตอรี่ของ <MemberName coreUserId={owner} nameOf={nameOf} />
          </>
        ) : (
          'ตอบกลับสตอรี่'
        )}
      </span>

      {embed.available === false ? (
        <span className="rounded-2xl bg-muted px-3 py-4 text-xs text-muted-foreground">
          สตอรี่นี้ไม่พร้อมใช้งานแล้ว
        </span>
      ) : (
        <Link
          href={embedHref(embed)}
          aria-label="เปิดสตอรี่ที่ตอบกลับ"
          className="overflow-hidden rounded-2xl opacity-90 transition-opacity hover:opacity-100"
        >
          <EmbedThumb embed={embed} className="h-40 w-auto max-w-28 bg-black object-cover" />
        </Link>
      )}
    </span>
  );
}

export function TypingRow({
  typist,
  nameOf,
}: {
  typist: string;
  nameOf?: (coreUserId: string) => string | null;
}) {
  return (
    <div className="mt-2 flex items-end gap-2" aria-live="polite">
      <Avatar coreUserId={typist} size={28} showOnline={false} />
      <span className="flex h-9 items-center gap-1 rounded-[22px] bg-[var(--bubble-theirs)] px-4">
        <span className="sr-only">
          <MemberName coreUserId={typist} nameOf={nameOf} /> กำลังพิมพ์
        </span>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            aria-hidden
            style={{ animationDelay: `${delay}ms` }}
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
          />
        ))}
      </span>
    </div>
  );
}

/// แผงรีแอ็กชันแบบ IG — แถวอิโมจิหกตัว + ปุ่มบวกเปิดแผงเต็มชุด
///
/// วาดผ่าน portal ด้วย `fixed` เพราะรายการข้อความอยู่ในกรอบที่เลื่อนได้
/// ถ้าวาง `absolute` ในแถว แผงของข้อความที่อยู่ชิดขอบบน/ล่างจะถูกกรอบตัดทิ้ง
/// (บั๊กเดียวกับที่ ReactionBar เคยเจอ) · ตามตำแหน่งปุ่มเมื่อหน้าจอเลื่อน
/// ไม่ใช่ปิดทิ้ง เพราะรายการเลื่อนตัวเองลงล่างเมื่อมีข้อความใหม่
/// หกตัว + ปุ่มบวก × 40px + ช่องไฟ + ขอบ — แคบกว่านี้ปุ่มบวกตกบรรทัด
const PICKER_WIDTH = 312;
const PICKER_HEIGHT = 52;
const PICKER_GAP = 6;

function pickerPosition(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const above = rect.top - PICKER_HEIGHT - PICKER_GAP;

  return {
    top: above > PICKER_GAP ? above : rect.bottom + PICKER_GAP,
    left: Math.min(
      Math.max(PICKER_GAP, rect.left + rect.width / 2 - PICKER_WIDTH / 2),
      Math.max(PICKER_GAP, window.innerWidth - PICKER_WIDTH - PICKER_GAP),
    ),
  };
}

function ReactionPicker({
  anchor,
  summary,
  onPick,
  onMore,
  onClose,
}: {
  anchor: HTMLElement;
  summary: ReactionSummary | null;
  onPick: (emoji: string) => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const [position, setPosition] = useState(() => pickerPosition(anchor));
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const follow = () => setPosition(pickerPosition(anchor));
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') onClose();

        return;
      }

      const target = event.target as Node | null;

      if (target && (panelRef.current?.contains(target) || anchor.contains(target))) {
        return;
      }

      onClose();
    };

    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);

    // โฟกัสอิโมจิตัวแรก — คนใช้คีย์บอร์ดกดเปิดแล้วเลือกต่อได้ทันที
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>('button')?.focus(),
    );

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [anchor, onClose]);

  const mine = new Set(
    (summary?.totals ?? []).filter((row) => row.reactedByMe).map((row) => row.emoji),
  );

  return createPortal(
    <div
      ref={panelRef}
      role="group"
      aria-label="เลือกรีแอ็กชัน"
      onKeyDown={(event) => {
        // กักโฟกัสไว้ในแถว — Tab วนกลับตัวแรก
        if (event.key !== 'Tab') return;

        const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLElement);

        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}
      style={{ top: position.top, left: position.left, width: PICKER_WIDTH }}
      className="fixed z-100 flex items-center gap-0.5 rounded-full border border-border bg-card p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          aria-pressed={mine.has(emoji)}
          aria-label={mine.has(emoji) ? `ถอน ${emoji}` : emoji}
          style={{ fontFamily: EMOJI_FONT }}
          className={`grid size-10 place-items-center rounded-full text-2xl transition-transform hover:scale-110 ${
            mine.has(emoji) ? 'bg-accent' : ''
          }`}
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}

      <button
        type="button"
        onClick={onMore}
        aria-label="อิโมจิทั้งหมด"
        className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-5" strokeWidth={1.9} />
      </button>
    </div>,
    document.body,
  );
}
