/// ชนิดข้อมูลของหน้า "ห้อง" แบบ Discord ที่ยังไม่อยู่ใน lib/csmju/types.ts
///
/// รูปร่างตามสัญญาของหลังบ้าน (backend/src/modules/voice/dto/voice.dto.ts ·
/// channels/dto/channel.dto.ts) — ตัวแปลงด้านล่างรับได้ทั้งชื่อใหม่ (`coreUserId`)
/// และชื่อเดิม (`coreUserId`) เพราะหลังบ้านยังใช้ปนกันอยู่

import type { VoiceOccupant, VoiceOccupants } from '@/lib/csmju/types';

export type { VoiceOccupant };
/// socket `voice:occupants`
export type VoiceOccupantsPayload = VoiceOccupants;

/// สมาชิกของห้อง (`GET /channels/:id/members` · ChannelMemberRow ส่วนที่หน้าจอใช้)
export interface ChannelMember {
  coreUserId: string;
  role: 'MEMBER' | 'MODERATOR';
  nickname: string | null;
  online: boolean;
}

function idOf(row: Record<string, unknown>): string | null {
  const value = row.coreUserId ?? row.coreUserId;

  return typeof value === 'string' && value ? value : null;
}

/// แปลงผลของ `GET /channels/:id/members` — อาเรย์ล้วนหรือแบบแบ่งหน้าก็ได้
export function parseMembers(data: unknown): ChannelMember[] {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];

  const members: ChannelMember[] = [];

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;

    const row = raw as Record<string, unknown>;
    const id = idOf(row);

    if (!id) continue;

    members.push({
      coreUserId: id,
      role: row.role === 'MODERATOR' ? 'MODERATOR' : 'MEMBER',
      nickname: typeof row.nickname === 'string' && row.nickname ? row.nickname : null,
      online: row.online === true,
    });
  }

  return members;
}

export function parseOccupants(data: unknown): VoiceOccupant[] {
  if (!Array.isArray(data)) return [];

  const list: VoiceOccupant[] = [];

  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;

    const row = raw as Record<string, unknown>;
    const id = idOf(row);

    if (!id) continue;

    list.push({
      coreUserId: id,
      muted: row.muted === true,
      deafened: row.deafened === true,
      video: row.video === true,
      sharing: row.sharing === true,
    });
  }

  return list;
}
