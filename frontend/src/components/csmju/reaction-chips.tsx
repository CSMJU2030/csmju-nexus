'use client';

import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { EMOJI_FONT, EmojiPopover } from '@/components/csmju/emoji-picker';
import { RoomPopover } from '@/components/csmju/room-popover';
import { useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import type { ReactionSummary } from '@/lib/csmju/types';

/// ชิปรีแอ็กชันใต้ข้อความแบบ Discord
///
///   [👍 3] [🔥 1] [😊+]
///
/// - กดชิปที่มีอยู่ = เพิ่มหรือถอน **ของเราเอง** (+1/−1) ไม่ใช่ของคนที่กดล่าสุด
/// - ชิปที่เรากดไว้เรืองสีหลัก
/// - ชี้ค้างที่ชิป = ขึ้นรายชื่อคนที่กด (ดึงจากหลังบ้านตอนชี้ ไม่โหลดล่วงหน้าทุกข้อความ)
///
/// คอมโพเนนต์นี้ไม่ยิง API เปลี่ยนยอดเอง — ให้ผู้เรียกทำผ่าน `onToggle` เพราะผู้เรียก
/// ถือยอดของทั้งไทม์ไลน์ (รวมยอดที่มาทาง socket) จึงคาดผลล่วงหน้าและแก้กลับได้ถูกที่
export function ReactionChips({
  channelId,
  messageId,
  summary,
  onToggle,
  disabled = false,
}: {
  channelId: string;
  messageId: string;
  summary: ReactionSummary | null;
  /// `mine` = สถานะก่อนกด (true → ถอน)
  onToggle: (emoji: string, mine: boolean) => void;
  disabled?: boolean;
}) {
  const totals = summary?.totals ?? [];
  const [picking, setPicking] = useState(false);
  const addRef = useRef<HTMLButtonElement | null>(null);

  if (totals.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="reaction-chips">
      {totals.map((row) => (
        <ReactionChip
          key={row.emoji}
          channelId={channelId}
          messageId={messageId}
          emoji={row.emoji}
          count={row.count}
          mine={row.reactedByMe}
          disabled={disabled}
          onToggle={() => onToggle(row.emoji, row.reactedByMe)}
        />
      ))}

      <button
        ref={addRef}
        type="button"
        disabled={disabled}
        onClick={() => setPicking((open) => !open)}
        aria-expanded={picking}
        aria-label="เพิ่มรีแอ็กชัน"
        title="เพิ่มรีแอ็กชัน"
        className="grid h-6 w-7 place-items-center rounded-md border border-transparent bg-muted text-muted-foreground opacity-0 transition-opacity hover:border-border hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40 aria-expanded:opacity-100"
      >
        <SmilePlus className="size-3.5" />
      </button>

      <EmojiPopover
        anchorRef={addRef}
        open={picking}
        onClose={() => setPicking(false)}
        variant="reaction"
        closeOnPick
        onPick={(emoji) =>
          onToggle(emoji, totals.find((row) => row.emoji === emoji)?.reactedByMe ?? false)
        }
      />
    </div>
  );
}

/// รายชื่อคนที่กดอิโมจินี้ — แคชตามยอด ถ้ายอดเปลี่ยนค่อยดึงใหม่
const reactorCache = new Map<string, string[] | 'unavailable'>();

/// ดึงคนที่กดอิโมจินี้จาก `GET /channels/:id/messages/:messageId/reactions?emoji=`
///
/// รับได้ทั้งอาเรย์ล้วนและแบบแบ่งหน้า · แต่ละแถวมี `coreUserId` (หรือ `coreUserId`)
export function parseReactors(data: unknown): string[] {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];

  return rows
    .map((row) => {
      if (typeof row === 'string') return row;
      if (row && typeof row === 'object') {
        const value =
          (row as { coreUserId?: unknown }).coreUserId ??
          (row as { coreUserId?: unknown }).coreUserId;

        return typeof value === 'string' ? value : null;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));
}

function ReactionChip({
  channelId,
  messageId,
  emoji,
  count,
  mine,
  disabled,
  onToggle,
}: {
  channelId: string;
  messageId: string;
  emoji: string;
  count: number;
  mine: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [hover, setHover] = useState(false);
  const [fetched, setFetched] = useState<{ key: string; value: string[] | 'unavailable' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `${messageId}:${emoji}:${count}`;
  const reactors = reactorCache.get(key) ?? (fetched?.key === key ? fetched.value : null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!hover) return;

    if (reactorCache.has(key)) return;

    let cancelled = false;

    void api
      .get<unknown>(
        `/channels/${channelId}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
      )
      .then((data) => {
        const ids = parseReactors(data);

        reactorCache.set(key, ids);
        if (!cancelled) setFetched({ key, value: ids });
      })
      .catch(() => {
        // ยังไม่มีทางดูรายชื่อ (หรือเน็ตหลุด) — บอกแค่ยอด ไม่เดาชื่อ
        if (!cancelled) setFetched({ key, value: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, [hover, key, channelId, messageId, emoji]);

  const open = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(true), 350);
  };

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    setHover(false);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        onPointerEnter={open}
        onPointerLeave={close}
        onFocus={open}
        onBlur={close}
        aria-pressed={mine}
        aria-label={`${emoji} ${count} คน${mine ? ' · คุณรีแอ็กแล้ว กดเพื่อถอน' : ' · กดเพื่อรีแอ็กด้วย'}`}
        className={`flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs transition-colors disabled:opacity-50 ${
          mine
            ? 'border-primary bg-primary/15 text-primary'
            : 'border-transparent bg-muted text-foreground hover:border-border'
        }`}
      >
        <span aria-hidden style={{ fontFamily: EMOJI_FONT }} className="text-sm leading-none">
          {emoji}
        </span>
        <span className="font-semibold tabular-nums">{count}</span>
      </button>

      <RoomPopover
        open={hover}
        onClose={close}
        anchor={{ ref }}
        side="top"
        align="center"
        width={240}
        role="tooltip"
        label={`คนที่รีแอ็กด้วย ${emoji}`}
        className="pointer-events-none"
      >
        <div className="flex items-center gap-2.5 px-3 py-2">
          <span aria-hidden style={{ fontFamily: EMOJI_FONT }} className="text-3xl leading-none">
            {emoji}
          </span>
          <p className="min-w-0 flex-1 text-xs leading-snug">
            {reactors === null ? (
              <span className="text-muted-foreground">กำลังโหลด…</span>
            ) : reactors === 'unavailable' ? (
              <span>{count} คนรีแอ็กด้วย {emoji}</span>
            ) : (
              <ReactorLine ids={reactors} total={count} emoji={emoji} />
            )}
          </p>
        </div>
      </RoomPopover>
    </>
  );
}

function ProfileName({ coreUserId }: { coreUserId: string }) {
  return <strong className="font-semibold">{useProfile(coreUserId).displayName}</strong>;
}

/// "สมชาย, สมหญิง และอีก 3 คน รีแอ็กด้วย 👍" — ชื่อจริงจากแคชโปรไฟล์
function ReactorLine({ ids, total, emoji }: { ids: string[]; total: number; emoji: string }) {
  const count = Math.max(total, ids.length);

  if (ids.length === 0) return <span>{count} คนรีแอ็กด้วย {emoji}</span>;

  const shown = ids.slice(0, 3);
  const rest = count - shown.length;

  return (
    <span>
      {shown.map((id, index) => (
        <span key={id}>
          {index > 0 && (rest === 0 && index === shown.length - 1 ? ' และ ' : ', ')}
          <ProfileName coreUserId={id} />
        </span>
      ))}
      {rest > 0 && ` และอีก ${rest} คน`} รีแอ็กด้วย {emoji}
    </span>
  );
}
