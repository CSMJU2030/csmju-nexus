/// ตรรกะล้วนของหน้า "ห้อง" แบบ Discord — แยกจากหน้าจอเพื่อให้เทสต์ได้ตรง ๆ
///
/// ทุกฟังก์ชันในนี้ไม่แตะ DOM ไม่ยิง API และไม่อ่านเวลาปัจจุบันเอง
/// (รับ `now` เข้ามา) ผลจึงเหมือนเดิมทุกครั้งที่เรียกด้วยค่าเดิม

import type { Channel, EmojiCount, Message, ReactionSummary } from '@/lib/csmju/types';

/// `seq` ของข้อความชั่วคราวที่ยังไม่มีของจริงกลับมา
///
/// ต้องมากพอให้อยู่ท้ายสุดของไทม์ไลน์เสมอ แต่ **ห้ามหลุดไปถึงหลังบ้าน**
/// เพราะมันเกินช่วงของคอลัมน์ Int (ดูที่ใช้ตอนรายงานว่าอ่านถึงไหน)
export const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

/// แทนที่ข้อความชั่วคราวด้วยของจริงที่เซิร์ฟเวอร์ส่งกลับมา
///
/// จับคู่ด้วย `clientNonce` ไม่ใช่ `id` เพราะตัวชั่วคราวยังไม่มี id จริง
/// ถ้าไม่จับคู่ ข้อความจะขึ้นสองอัน: ตัวที่เราวาดเองกับตัวที่เซิร์ฟเวอร์ส่งมา
///
/// กันซ้ำด้วย id ต่อท้ายอีกชั้น เพราะคนส่งเองจะได้ทั้ง ack และ broadcast
export function replacePending(current: Message[], incoming: Message): Message[] {
  const byNonce = current.findIndex((row) => row.clientNonce === incoming.clientNonce);

  if (byNonce !== -1) {
    const next = [...current];

    next[byNonce] = incoming;

    return next;
  }

  return current.some((row) => row.id === incoming.id) ? current : [...current, incoming];
}

/// nonce ฝั่ง client — ส่งซ้ำด้วย nonce เดิมจะได้ข้อความเดิมกลับมา ไม่ใช่สองอัน
export const newNonce = () =>
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ───────────────────────────── รายการช่อง ─────────────────────────────

/// ห้องที่อยู่ในหน้า "ห้อง" — DM กับแชทกลุ่มแบบ Instagram อยู่ที่ /messages
export const ROOM_KINDS = new Set<Channel['kind']>(['GROUP', 'COURSE', 'VOICE']);

export function isRoom(channel: Pick<Channel, 'kind'>): boolean {
  return ROOM_KINDS.has(channel.kind);
}

export interface ChannelCategory {
  /// คีย์คงที่ใช้จำว่าหมวดไหนถูกยุบไว้
  key: string;
  label: string;
  kind: 'text' | 'voice';
  channels: Channel[];
}

/// เรียงช่องแบบ Discord: ตามลำดับที่สร้าง ไม่ใช่ตามความเคลื่อนไหวล่าสุด
///
/// รายการของ /channels เรียงตามข้อความล่าสุด (เหมาะกับกล่องข้อความ) — ถ้าใช้ตรง ๆ
/// ช่องจะสลับที่กันทุกครั้งที่มีคนพิมพ์ ผู้ใช้จำตำแหน่งไม่ได้และกดพลาดบ่อย
function byCreated(a: Channel, b: Channel): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/// จัดห้องเป็นหมวดในแถบซ้าย
///
///   ช่องข้อความ        ห้องกลุ่ม + ห้องประจำวิชาที่ไม่มีรหัสวิชา
///   วิชา <รหัส>        ห้องประจำวิชาที่ติดรหัสวิชาเดียวกัน (หนึ่งหมวดต่อหนึ่งรหัส)
///   ช่องสำหรับพูด      ห้องเสียงทั้งหมด
///
/// หมวด "ช่องข้อความ" กับ "ช่องสำหรับพูด" มีเสมอแม้ว่าง เพื่อให้ผู้ใช้เห็นว่ามีสองแบบ
export function groupChannels(channels: Channel[]): ChannelCategory[] {
  const rooms = channels.filter(isRoom).sort(byCreated);
  const general: Channel[] = [];
  const byCourse = new Map<string, Channel[]>();
  const voice: Channel[] = [];

  for (const channel of rooms) {
    if (channel.kind === 'VOICE') {
      voice.push(channel);
    } else if (channel.kind === 'COURSE' && channel.courseTag) {
      const tag = channel.courseTag.toUpperCase();
      const list = byCourse.get(tag) ?? [];

      list.push(channel);
      byCourse.set(tag, list);
    } else {
      general.push(channel);
    }
  }

  const courses = [...byCourse.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, list]) => ({
      key: `course:${tag}`,
      label: `วิชา ${tag}`,
      kind: 'text' as const,
      channels: list,
    }));

  return [
    { key: 'text', label: 'ช่องข้อความ', kind: 'text', channels: general },
    ...courses,
    { key: 'voice', label: 'ช่องสำหรับพูด', kind: 'voice', channels: voice },
  ];
}

// ───────────────────────────── รีแอ็กชัน ─────────────────────────────

/// ยอดรีแอ็กชันที่มาทาง socket (`reaction:changed`)
///
/// หลังบ้านคำนวณ `reactedByMe` จากมุมของ **คนที่กด** แล้วกระจายชุดเดียวกัน
/// ให้ทั้งห้อง ถ้าเชื่อค่านั้นตรง ๆ พอเพื่อนกด 👍 ชิปของเราจะเรืองว่า "เรากดแล้ว"
/// ทั้งที่ไม่ได้กด แล้วพอเรากดชิปนั้น หน้าจอจะสั่งถอน (ซึ่งไม่มีอะไรให้ถอน) —
/// ผลคือกดเพิ่ม +1 ตามเพื่อนไม่ได้เลย นี่คือบั๊กที่ PL เจอ
///
/// กติกา: เอา **ยอด** จาก payload เสมอ แต่ `reactedByMe` เชื่อ payload ก็ต่อเมื่อ
/// payload บอกว่าเป็นการกดของเราเอง (`actorCoreUserId`) หรือหลังบ้านส่งรายชื่อ
/// คนกดมาด้วย (`reactorCoreUserIds`) — นอกนั้นใช้ค่าเดิมที่เรารู้อยู่แล้ว
export interface ReactionBroadcast {
  targetKind: ReactionSummary['targetKind'] | string;
  targetId: string;
  totals: (EmojiCount & { reactorCoreUserIds?: string[] })[];
  totalCount: number;
  actorCoreUserId?: string | null;
}

export function mergeReactionBroadcast(
  previous: ReactionSummary | null | undefined,
  payload: ReactionBroadcast,
  meCoreUserId: string,
): ReactionSummary {
  const fromMe = payload.actorCoreUserId === meCoreUserId;
  const mineBefore = new Set(
    (previous?.totals ?? []).filter((row) => row.reactedByMe).map((row) => row.emoji),
  );

  const totals = payload.totals
    .filter((row) => row.count > 0)
    .map((row) => {
      let mine: boolean;

      if (Array.isArray(row.reactorCoreUserIds)) {
        mine = row.reactorCoreUserIds.includes(meCoreUserId);
      } else if (fromMe) {
        mine = row.reactedByMe;
      } else {
        mine = mineBefore.has(row.emoji);
      }

      return { emoji: row.emoji, count: row.count, reactedByMe: mine };
    });

  return {
    targetKind: payload.targetKind as ReactionSummary['targetKind'],
    targetId: payload.targetId,
    totals,
    totalCount: totals.reduce((sum, row) => sum + row.count, 0),
  };
}

/// คาดผลของการกดชิปล่วงหน้า — ให้ชิปเปลี่ยนทันทีแบบ Discord ไม่ต้องรอ round trip
///
/// `mine` = สถานะก่อนกด · true → ถอน (−1) · false → เพิ่ม (+1)
/// ยอดที่ถึง 0 หายออกจากแถว อิโมจิใหม่ต่อท้าย (Discord เรียงตามลำดับที่มีคนกดก่อน)
export function toggleReactionLocally(
  summary: ReactionSummary | null | undefined,
  target: { targetKind: ReactionSummary['targetKind']; targetId: string },
  emoji: string,
  mine: boolean,
): ReactionSummary {
  const totals = [...(summary?.totals ?? [])];
  const index = totals.findIndex((row) => row.emoji === emoji);

  if (mine) {
    if (index !== -1) {
      const row = totals[index];
      const count = Math.max(0, row.count - 1);

      if (count === 0) totals.splice(index, 1);
      else totals[index] = { ...row, count, reactedByMe: false };
    }
  } else if (index === -1) {
    totals.push({ emoji, count: 1, reactedByMe: true });
  } else if (!totals[index].reactedByMe) {
    totals[index] = { ...totals[index], count: totals[index].count + 1, reactedByMe: true };
  }

  return {
    targetKind: summary?.targetKind ?? target.targetKind,
    targetId: summary?.targetId ?? target.targetId,
    totals,
    totalCount: totals.reduce((sum, row) => sum + row.count, 0),
  };
}

/// คงลำดับชิปเดิมไว้เมื่อยอดใหม่มาถึง — หลังบ้านเรียงตามยอดมากไปน้อย ถ้าเชื่อ
/// ลำดับนั้น ชิปจะกระโดดสลับที่ใต้นิ้วผู้ใช้ทุกครั้งที่ยอดแซงกัน แล้วกดผิดตัว
export function keepChipOrder(
  previous: ReactionSummary | null | undefined,
  next: ReactionSummary,
): ReactionSummary {
  if (!previous || previous.totals.length === 0) return next;

  const order = new Map(previous.totals.map((row, index) => [row.emoji, index]));
  const totals = [...next.totals].sort((a, b) => {
    const left = order.get(a.emoji) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b.emoji) ?? Number.MAX_SAFE_INTEGER;

    return left - right;
  });

  return { ...next, totals };
}

/// ข้อความใต้ชิปตอนชี้ — "สมชาย, สมหญิง และอีก 3 คน รีแอ็กด้วย 👍"
export function reactorsLabel(names: string[], total: number, emoji: string): string {
  if (total <= 0) return `ยังไม่มีใครรีแอ็กด้วย ${emoji}`;
  if (names.length === 0) return `${total} คนรีแอ็กด้วย ${emoji}`;

  const shown = names.slice(0, 3);
  const rest = Math.max(0, total - shown.length);

  if (rest === 0) {
    if (shown.length === 1) return `${shown[0]} รีแอ็กด้วย ${emoji}`;

    return `${shown.slice(0, -1).join(', ')} และ ${shown.at(-1)} รีแอ็กด้วย ${emoji}`;
  }

  return `${shown.join(', ')} และอีก ${rest} คน รีแอ็กด้วย ${emoji}`;
}

// ───────────────────────────── ไทม์ไลน์ ─────────────────────────────

/// "18 สิงหาคม 2569" — ปฏิทินพุทธตามค่าเริ่มต้นของ th-TH
export function thaiDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

/// วันตามเวลากรุงเทพฯ — ใช้ตัดสินว่าต้องมีเส้นคั่นวันไหม
function bangkokDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

/// "วันนี้ เวลา 14:05" / "เมื่อวาน เวลา 09:12" / "18/08/2569 14:05" แบบหัวข้อความ Discord
export function stampLabel(iso: string, now: Date): string {
  const day = bangkokDay(iso);
  const today = bangkokDay(now.toISOString());
  const yesterday = bangkokDay(new Date(now.getTime() - 86_400_000).toISOString());

  if (day === today) return `วันนี้ เวลา ${timeLabel(iso)}`;
  if (day === yesterday) return `เมื่อวาน เวลา ${timeLabel(iso)}`;

  const date = new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });

  return `${date} ${timeLabel(iso)}`;
}

/// ข้อความแรกที่ยังไม่ได้อ่านตอนเปิดห้อง — จุดวางเส้นแดง "ใหม่"
///
/// `unreadCount` ของหลังบ้านนับข้อความไทม์ไลน์หลัก (ไม่นับเธรด ไม่นับที่ลบ)
/// ที่ seq มากกว่าหมุดอ่าน จึงนับถอยจากท้ายไทม์ไลน์ได้ตรงตัว
export function firstUnreadId(timeline: Message[], unreadCount: number): string | null {
  if (unreadCount <= 0) return null;

  const real = timeline.filter((row) => row.seq !== PENDING_SEQ);

  if (real.length === 0) return null;

  // ยังไม่ได้อ่านมากกว่าที่โหลดมา → เส้นอยู่บนสุดของที่เห็น
  const index = Math.max(0, real.length - unreadCount);

  return real[index]?.id ?? null;
}

export type TimelineRow =
  | { type: 'date'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: Message; grouped: boolean };

/// ข้อความต่อเนื่องจากคนเดิมภายในเวลานี้ = ยุบหัว (ไม่ซ้ำรูปและชื่อ) แบบ Discord
const GROUP_WINDOW_MS = 7 * 60_000;

/// แปลงไทม์ไลน์เป็นแถวที่จะวาด: เส้นคั่นวัน · เส้น "ใหม่" · ข้อความ
export function buildTimelineRows(timeline: Message[], unreadId: string | null): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let previous: Message | null = null;

  for (const message of timeline) {
    const day = bangkokDay(message.createdAt);
    const newDay = !previous || bangkokDay(previous.createdAt) !== day;

    if (newDay) {
      rows.push({ type: 'date', key: `date:${day}`, label: thaiDateLabel(message.createdAt) });
    }

    const isUnread = message.id === unreadId;

    if (isUnread) {
      rows.push({ type: 'unread', key: 'unread' });
    }

    const grouped =
      !newDay &&
      !isUnread &&
      previous !== null &&
      previous.authorCoreUserId === message.authorCoreUserId &&
      !message.replyTo &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
        GROUP_WINDOW_MS;

    rows.push({ type: 'message', key: message.id, message, grouped });
    previous = message;
  }

  return rows;
}

/// "1:05:09" / "04:32" — เวลาที่อยู่ในช่องเสียงมาแล้ว
export function elapsedLabel(fromIso: string, now: Date): string {
  const total = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
