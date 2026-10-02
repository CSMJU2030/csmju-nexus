'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AtSign,
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Link2,
  Loader2,
  Mail,
  Search,
  Users,
  X,
} from 'lucide-react';
import { FeedModal } from '@/components/csmju/feed-modal';
import { toast } from '@/components/csmju/feed-toast';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, SearchHit } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// แผ่น "แชร์" แบบ Instagram — ใช้ร่วมกันทั้งโพสต์ คลิปสั้น และสตอรี่
///
///   บน    ค้นหา + ตารางสามคอลัมน์: แชทล่าสุดก่อน แล้วคนที่ฉันติดตาม
///   กลาง  เลือกแล้ว → "เขียนข้อความ…" + ปุ่ม "ส่ง" (POST /shares)
///   ล่าง  คัดลอกลิงก์ · แอปภายนอก (ลิงก์แชร์จริงของแต่ละเจ้า เปิดแท็บใหม่)
///
/// ส่งในระบบไปที่ห้องที่มีอยู่แล้วด้วย channelIds และไปหาคนที่ยังไม่เคยคุยด้วย
/// peerCoreUserIds — หลังบ้านเปิดห้อง DM ให้เอง หน้าบ้านไม่ต้องสร้างห้องก่อน
///
/// ลิงก์ที่แชร์ออกไปเป็นหน้าในระบบนี้ (ต้องเข้าสู่ระบบ) — คนนอกได้แค่ลิงก์
/// ไม่ได้ข้อมูล ระบบไม่มีหน้าสาธารณะให้ฝังโดยตั้งใจ

export type ShareKind = 'POST' | 'REEL' | 'STORY';

export interface ShareTarget {
  kind: ShareKind;
  id: string;
}

/// หลังบ้านรับได้ 1–20 ปลายทางต่อครั้ง
const MAX_TARGETS = 20;

/// ที่อยู่เต็มของหน้าที่เปิดสิ่งนั้น — ลิงก์ที่คัดลอกและที่ส่งให้แอปอื่นใช้ตัวนี้
export function shareUrl(target: ShareTarget): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const id = encodeURIComponent(target.id);

  if (target.kind === 'POST') return `${origin}/p/${id}`;
  if (target.kind === 'REEL') return `${origin}/reels?reel=${id}`;

  return `${origin}/feed?story=${id}`;
}

export async function copyShareLink(target: ShareTarget): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl(target));
    toast('คัดลอกลิงก์แล้ว');
  } catch {
    // clipboard ใช้ได้เฉพาะ secure context + ผู้ใช้อนุญาต — บอกตรง ๆ
    toast('คัดลอกลิงก์ไม่ได้');
  }
}

export function ShareSheet({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: ShareTarget;
}) {
  return (
    <FeedModal open={open} onClose={onClose} label="แชร์" sheetOnMobile className="sm:max-w-136">
      <SharePanel target={target} onClose={onClose} />
    </FeedModal>
  );
}

type Recipient =
  | { key: string; kind: 'channel'; channel: Channel }
  | { key: string; kind: 'person'; coreUserId: string };

/// เนื้อในของแผ่นแชร์ — ตัวเล่นสตอรี่วางตัวนี้ข้างในตัวเอง (กักโฟกัสชั้นเดียว)
export function SharePanel({
  target,
  onClose,
}: {
  target: ShareTarget;
  onClose: () => void;
}) {
  const me = useMe();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Map<string, Recipient>>(() => new Map());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const term = query.trim().toLowerCase();

  // กุญแจเดียวกับแถบซ้าย/หน้าข้อความ (รูปข้อมูลเดียวกัน) — เปิดแผ่นแล้วไม่ยิงซ้ำ
  const { data: channels = [], isPending: loadingChannels } = useQuery({
    queryKey: ['channels', 'mine'],
    queryFn: async () => (await api.list<Channel>('/channels?limit=50')).items,
  });

  const { data: following = [] } = useQuery({
    queryKey: ['share-following', me.id],
    queryFn: async () =>
      (await api.list<{ coreUserId: string }>('/follows/following?limit=100')).items.map(
        (row) => row.coreUserId,
      ),
  });

  // พิมพ์ชื่อคนที่ไม่อยู่ในสองรายการบน → ถามหลังบ้าน (ค้นคนต้องยาว 2 ตัวขึ้นไป)
  const { data: found = [] } = useQuery({
    queryKey: ['share-search', term],
    enabled: term.length >= 2,
    queryFn: async () =>
      (await api.list<SearchHit>(`/search${qs({ q: term, kind: 'people', limit: 12 })}`)).items,
  });

  const conversations = channels.filter(
    (channel) =>
      (channel.kind === 'DM' || channel.kind === 'GROUP_DM') && channel.inboxFolder !== 'HIDDEN',
  );
  const dmPeers = new Set(conversations.map((channel) => channel.peerCoreUserId).filter(Boolean));
  const people = [
    ...following,
    ...found.map((hit) => hit.id).filter((id) => !following.includes(id)),
  ].filter((id) => id !== me.id && !dmPeers.has(id));

  const recipients: Recipient[] = [
    ...conversations.map((channel) => ({ key: `c:${channel.id}`, kind: 'channel' as const, channel })),
    ...people.map((coreUserId) => ({ key: `p:${coreUserId}`, kind: 'person' as const, coreUserId })),
  ];

  function toggle(recipient: Recipient) {
    setPicked((prev) => {
      const next = new Map(prev);

      if (next.has(recipient.key)) next.delete(recipient.key);
      else if (next.size < MAX_TARGETS) next.set(recipient.key, recipient);

      return next;
    });
  }

  async function send() {
    if (picked.size === 0 || sending) return;

    setSending(true);
    setError(null);

    const chosen = [...picked.values()];
    const channelIds = chosen.flatMap((row) => (row.kind === 'channel' ? [row.channel.id] : []));
    const peers = chosen.flatMap((row) => (row.kind === 'person' ? [row.coreUserId] : []));

    try {
      await api.post('/shares', {
        targetKind: target.kind,
        targetId: target.id,
        ...(channelIds.length ? { channelIds: channelIds } : {}),
        ...(peers.length ? { peerCoreUserIds: peers } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      toast('ส่งแล้ว');
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ส่งไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="relative flex shrink-0 items-center justify-center border-b border-border px-4 py-3">
        <span
          aria-hidden
          className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-border sm:hidden"
        />
        <h2 className="text-csmju-body font-bold">แชร์</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full hover:bg-accent"
        >
          <X className="size-5" strokeWidth={1.9} />
        </button>
      </header>

      <div className="shrink-0 px-4 pt-3">
        <label className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Search aria-hidden className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหา"
            aria-label="ค้นหาคนที่จะส่งให้"
            className="min-w-0 flex-1 bg-transparent text-csmju-label outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="min-h-40 flex-1 overflow-y-auto px-2 py-3">
        {loadingChannels ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-label="กำลังโหลด" />
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-y-3">
            {recipients.map((recipient) => (
              <RecipientTile
                key={recipient.key}
                recipient={recipient}
                term={term}
                selected={picked.has(recipient.key)}
                onToggle={() => toggle(recipient)}
              />
            ))}
          </ul>
        )}
        {!loadingChannels && recipients.length === 0 && (
          <p className="py-10 text-center text-csmju-label text-muted-foreground">
            ยังไม่มีแชทหรือคนที่ติดตาม — พิมพ์ชื่อเพื่อค้นหา
          </p>
        )}
      </div>

      {picked.size > 0 ? (
        <div className="shrink-0 space-y-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="เขียนข้อความ…"
            aria-label="เขียนข้อความ"
            maxLength={1000}
            className="w-full bg-transparent text-csmju-label outline-none placeholder:text-muted-foreground"
          />
          {error && (
            <p role="alert" className="text-csmju-caption text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-csmju-label font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            ส่ง
          </button>
        </div>
      ) : (
        <ExternalShareRow target={target} />
      )}
    </>
  );
}

function RecipientTile({
  recipient,
  term,
  selected,
  onToggle,
}: {
  recipient: Recipient;
  term: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const peer =
    recipient.kind === 'person' ? recipient.coreUserId : recipient.channel.peerCoreUserId;

  if (peer) {
    return <PersonTile coreUserId={peer} term={term} selected={selected} onToggle={onToggle} />;
  }

  const name = (recipient.kind === 'channel' && recipient.channel.name) || 'แชทกลุ่ม';

  if (term && !name.toLowerCase().includes(term)) return null;

  return (
    <Tile name={name} selected={selected} onToggle={onToggle}>
      <span className="grid size-16 place-items-center rounded-full bg-muted">
        <Users aria-hidden className="size-7" strokeWidth={1.7} />
      </span>
    </Tile>
  );
}

/// แยกเป็นคอมโพเนนต์เพื่อเรียก useProfile เฉพาะแถวที่มีคนจริง — แชทกลุ่มไม่มี
/// coreUserId ถ้าเรียกด้วยค่าว่าง ตัวรวบคำขอจะยิง /profiles?coreUserIds= ว่าง ๆ
function PersonTile({
  coreUserId,
  term,
  selected,
  onToggle,
}: {
  coreUserId: string;
  term: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const profile = useProfile(coreUserId);
  const name = profile.displayName;

  // กรองด้วยชื่อที่แสดงจริง (มาจากแคชโปรไฟล์) — กรองก่อนวาดไม่ได้เพราะชื่อมาจาก hook
  if (term && !name.toLowerCase().includes(term) && !coreUserId.toLowerCase().includes(term)) {
    return null;
  }

  return (
    <Tile name={name} selected={selected} onToggle={onToggle}>
      <Avatar coreUserId={coreUserId} size={64} showOnline={false} />
    </Tile>
  );
}

function Tile({
  name,
  selected,
  onToggle,
  children,
}: {
  name: string;
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={name}
        className="flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2 transition-colors hover:bg-accent"
      >
        <span className="relative">
          {children}
          {selected && (
            <span className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground animate-in zoom-in-50">
              <Check aria-hidden className="size-3.5" strokeWidth={3} />
            </span>
          )}
        </span>
        <span aria-hidden className="line-clamp-2 w-full text-center text-csmju-caption leading-tight">
          {name}
        </span>
      </button>
    </li>
  );
}

/// ลิงก์แชร์ออกไปแอปอื่น — ใช้ URL แชร์ทางการของแต่ละเจ้า เปิดแท็บใหม่
///
/// Messenger บนเว็บไม่มี URL แชร์ที่ใช้ได้โดยไม่มี app_id ของ Facebook
/// (dialog/send ขึ้นหน้า error) จึงโชว์เฉพาะมือถือ ที่เปิดแอปด้วย fb-messenger://
/// "ดูทั้งหมด" ใช้แผ่นแชร์ของระบบ (navigator.share) — ไม่มีก็ไม่โชว์
function ExternalShareRow({ target }: { target: ShareTarget }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const url = shareUrl(target);
  const text = 'ดูบน CS Nexus';
  const e = encodeURIComponent;
  const mobile =
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const links: Array<{ label: string; href: string; icon: ReactNode; external?: boolean }> = [
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`, icon: <FacebookGlyph />, external: true },
    ...(mobile
      ? [{ label: 'Messenger', href: `fb-messenger://share/?link=${e(url)}`, icon: <MessengerGlyph /> }]
      : []),
    { label: 'WhatsApp', href: `https://wa.me/?text=${e(`${text} ${url}`)}`, icon: <WhatsAppGlyph />, external: true },
    { label: 'อีเมล', href: `mailto:?subject=${e(text)}&body=${e(url)}`, icon: <Mail className="size-6" strokeWidth={1.7} /> },
    { label: 'Threads', href: `https://www.threads.net/intent/post?text=${e(`${text} ${url}`)}`, icon: <AtSign className="size-6" strokeWidth={1.7} />, external: true },
    { label: 'X', href: `https://x.com/intent/post?text=${e(text)}&url=${e(url)}`, icon: <XGlyph />, external: true },
  ];

  const item = 'flex w-18 shrink-0 flex-col items-center gap-1.5 text-center text-csmju-caption';
  const circle =
    'grid size-14 place-items-center rounded-full border border-border text-foreground transition-colors group-hover:bg-accent';

  return (
    <div className="relative shrink-0 border-t border-border py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={() => scroller.current?.scrollBy({ left: -240, behavior: 'smooth' })}
        aria-label="เลื่อนไปทางซ้าย"
        className="absolute left-2 top-7.5 z-10 hidden size-7 place-items-center rounded-full bg-card shadow-csmju-md sm:grid"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div ref={scroller} className="flex gap-2 overflow-x-auto px-4 scrollbar-none sm:px-10">
        <button type="button" onClick={() => void copyShareLink(target)} className={cn('group', item)}>
          <span className={circle}>
            <Link2 className="size-6" strokeWidth={1.7} aria-hidden />
          </span>
          คัดลอกลิงก์
        </button>
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className={cn('group', item)}
          >
            <span className={circle} aria-hidden>
              {link.icon}
            </span>
            {link.label}
          </a>
        ))}
        {canNativeShare && (
          <button
            type="button"
            onClick={() => {
              navigator.share({ title: text, url }).catch(() => {
                // ผู้ใช้กดยกเลิกแผ่นแชร์ของระบบ — ไม่ใช่ข้อผิดพลาด
              });
            }}
            className={cn('group', item)}
          >
            <span className={circle}>
              <Ellipsis className="size-6" strokeWidth={1.7} aria-hidden />
            </span>
            ดูทั้งหมด
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => scroller.current?.scrollBy({ left: 240, behavior: 'smooth' })}
        aria-label="เลื่อนไปทางขวา"
        className="absolute right-2 top-7.5 z-10 hidden size-7 place-items-center rounded-full bg-card shadow-csmju-md sm:grid"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/// สัญลักษณ์แบรนด์แบบเส้นเรียบ (lucide ไม่มีโลโก้แบรนด์) — ใช้ currentColor ตามธีม
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <Glyph>
      <path d="M14.5 7.5h-1.6c-1.2 0-1.9.7-1.9 1.9v2.1h3.3l-.5 3H11V21" />
      <path d="M8.5 11.5H11" />
    </Glyph>
  );
}

function MessengerGlyph() {
  return (
    <Glyph>
      <path d="M12 3.2c-4.9 0-8.8 3.6-8.8 8.1 0 2.4 1.1 4.6 2.9 6.1v3.4l3.1-1.7c.9.2 1.8.4 2.8.4 4.9 0 8.8-3.6 8.8-8.1S16.9 3.2 12 3.2Z" />
      <path d="m7.6 13.8 3-3.2 2 1.9 3.8-3.2-3 3.2-2-1.9Z" />
    </Glyph>
  );
}

function WhatsAppGlyph() {
  return (
    <Glyph>
      <path d="m3.5 20.5 1.3-4.1a8.5 8.5 0 1 1 3.1 3Z" />
      <path d="M9.3 8.3c-.3 3.3 3.1 6.7 6.4 6.4l.9-1.3-1.9-1-.9.7a4.4 4.4 0 0 1-2.2-2.2l.7-.9-1-1.9Z" />
    </Glyph>
  );
}

function XGlyph() {
  return (
    <Glyph>
      <path d="m4.5 4.5 11 15h4l-11-15Z" />
      <path d="M19.5 4.5 13.4 11M4.5 19.5l6.1-6.5" />
    </Glyph>
  );
}
