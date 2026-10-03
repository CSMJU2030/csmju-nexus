'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, UserPlus, X } from 'lucide-react';
import { channelMembersKey, useChannelMembers } from '@/components/csmju/member-list';
import { showToast } from '@/components/csmju/messages-toast';
import { useMyFollowing } from '@/components/csmju/profile-follow-list';
import { useSuggestions } from '@/components/csmju/profile-suggestions';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, SearchHit } from '@/lib/csmju/types';

/// หลังบ้านรับครั้งละไม่เกิน 50 คน (AddMembersDto)
export const MAX_INVITES = 50;

/// ปุ่ม "เชิญสมาชิก" + กล่องค้นหาคนแบบเลือกได้หลายคน
///
///   เชิญเข้า # ทั่วไป
///   [ชิป ×] [ค้นหา…]
///   แนะนำ / ผลค้นหา   ○ ●     ← คนที่อยู่ในห้องแล้วกดไม่ได้
///   [ เพิ่ม 3 คน ]
///
/// ค้นจาก `/search?kind=people` (เฉพาะคนที่เคยใช้ระบบนี้ — Core Hub ยังไม่เปิด
/// endpoint ค้นคนให้ระบบย่อย) · เพิ่มด้วย `POST /channels/:id/members`
/// แล้วแผงสมาชิกโหลดใหม่เอง (หลังบ้านกระจาย channel:members ให้คนอื่นในห้องด้วย)
export function InviteMembersButton({
  channel,
  className = 'grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground',
  iconClassName = 'size-5',
  children,
}: {
  channel: Channel;
  className?: string;
  iconClassName?: string;
  /// ข้อความข้างไอคอน — ไม่ส่ง = ปุ่มไอคอนล้วน
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="เชิญสมาชิก"
        title="เชิญสมาชิก"
        className={className}
      >
        <UserPlus aria-hidden className={iconClassName} />
        {children}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]" showCloseButton={false}>
          {/* ถอดเนื้อในออกตอนปิด — เปิดใหม่ได้กล่องว่าง */}
          {open && <InvitePanel channel={channel} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvitePanel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const me = useMe();
  const id = useId();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const following = useMyFollowing();
  const suggestions = useSuggestions(me.id);
  const members = useChannelMembers(channel.id);

  /// ผลค้นหาพร้อมคำค้นที่ใช้หามัน — แบบเดียวกับกล่อง "ข้อความใหม่" (messages-compose.tsx)
  const [results, setResults] = useState<{ term: string; items: string[] } | null>(null);
  const term = q.trim();
  const longEnough = term.length >= 2;

  // โฟกัสช่องค้นหาหลังกล่องเปิดเสร็จ — showModal() แย่งโฟกัสในเฟรมแรก
  useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!longEnough) return;

    const timer = setTimeout(() => {
      void api
        .list<SearchHit>(`/search${qs({ q: term, kind: 'people', limit: 20 })}`)
        .then((page) => {
          setError(null);
          setResults({ term, items: page.items.map((hit) => hit.id).filter((hit) => hit !== me.id) });
        })
        .catch(() => {
          setError('ค้นหาไม่สำเร็จ');
          setResults({ term, items: [] });
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [longEnough, term, me.id]);

  /// คนที่อยู่ในห้องแล้ว — แสดงให้เห็นแต่กดเลือกไม่ได้
  const inRoom = useMemo(
    () =>
      new Set([
        ...(members.data?.online ?? []).map((row) => row.coreUserId),
        ...(members.data?.offline ?? []).map((row) => row.coreUserId),
      ]),
    [members.data],
  );

  const suggested = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const person of [
      ...(following.data ? [...following.data] : []),
      ...suggestions.people.map((row) => row.coreUserId),
    ]) {
      if (person !== me.id && !seen.has(person) && !inRoom.has(person)) {
        seen.add(person);
        out.push(person);
      }
    }

    return out.slice(0, 30);
  }, [following.data, suggestions.people, me.id, inRoom]);

  const fresh = results?.term === term;
  const searching = longEnough && !fresh;
  const people = longEnough ? (fresh ? results.items : []) : suggested;
  const loadingSuggestions =
    !longEnough && people.length === 0 && (following.isPending || suggestions.isPending);

  function toggle(person: string) {
    setError(null);

    if (inRoom.has(person)) return;

    if (!picked.includes(person) && picked.length >= MAX_INVITES) {
      setError(`เชิญได้ครั้งละไม่เกิน ${MAX_INVITES} คน`);

      return;
    }

    setPicked((current) =>
      current.includes(person) ? current.filter((row) => row !== person) : [...current, person],
    );
  }

  async function invite() {
    if (picked.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      const result = await api.post<{ added: number }>(`/channels/${channel.id}/members`, {
        coreUserIds: picked,
      });

      // แผงสมาชิกของเราโหลดใหม่ทันที (ของคนอื่นโหลดจาก socket channel:members)
      await queryClient.invalidateQueries({ queryKey: channelMembersKey(channel.id) });
      void queryClient.invalidateQueries({ queryKey: ['channels', 'mine'] });

      showToast(
        result.added > 0 ? `เพิ่ม ${result.added} คนเข้าห้องแล้ว` : 'ทุกคนที่เลือกอยู่ในห้องนี้แล้ว',
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'เพิ่มสมาชิกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const roomName = channel.name ?? 'ห้องนี้';

  return (
    <div className="flex h-[min(600px,calc(100dvh-2rem))] flex-col">
      <div className="relative flex h-[51px] shrink-0 items-center justify-center border-b border-border px-12">
        <DialogTitle className="truncate text-base font-bold">เชิญเข้า {roomName}</DialogTitle>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="absolute right-2 grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
        >
          <X className="size-6" strokeWidth={1.9} />
        </button>
      </div>

      <DialogDescription className="sr-only">
        ค้นหาและเลือกคนที่ต้องการเพิ่มเข้าห้อง เลือกได้หลายคน
      </DialogDescription>

      <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-2">
        <label htmlFor={`${id}-q`} className="pt-1 text-base font-semibold">
          เพิ่ม:
        </label>
        <div className="flex max-h-24 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto">
          {picked.map((person) => (
            <Chip key={person} coreUserId={person} onRemove={() => toggle(person)} />
          ))}
          <input
            id={`${id}-q`}
            ref={searchRef}
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && q === '' && picked.length > 0) {
                setPicked((current) => current.slice(0, -1));
              }
            }}
            placeholder="ค้นหาชื่อ…"
            autoComplete="off"
            aria-label="ค้นหาคน"
            className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {!longEnough && people.length > 0 && (
          <p className="px-6 pb-1 pt-2 text-sm font-semibold">แนะนำ</p>
        )}

        {error && (
          <p role="alert" className="px-6 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {(searching || loadingSuggestions) && (
          <p className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {searching ? 'กำลังค้นหา…' : 'กำลังโหลด…'}
          </p>
        )}

        {!searching && !loadingSuggestions && people.length === 0 && (
          <p className="px-6 py-4 text-sm leading-6 text-muted-foreground">
            {longEnough
              ? 'ไม่พบบัญชี — ค้นได้เฉพาะคนที่เคยใช้งานระบบนี้แล้ว'
              : 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาคน'}
          </p>
        )}

        <ul aria-label={longEnough ? 'ผลการค้นหา' : 'แนะนำ'}>
          {people.map((person) => (
            <li key={person}>
              <PersonRow
                coreUserId={person}
                member={inRoom.has(person)}
                selected={picked.includes(person)}
                onToggle={() => toggle(person)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={() => void invite()}
          disabled={picked.length === 0 || busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {picked.length > 0 ? `เพิ่ม ${picked.length} คน` : 'เพิ่ม'}
        </button>
      </div>
    </div>
  );
}

function Chip({ coreUserId, onRemove }: { coreUserId: string; onRemove: () => void }) {
  const profile = useProfile(coreUserId);

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-link/15 py-0.5 pl-3 pr-1 text-sm font-semibold text-link">
      {profile.displayName}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`เอา ${profile.displayName} ออก`}
        className="grid size-5 place-items-center rounded-full hover:bg-link/20"
      >
        <X aria-hidden className="size-3.5" strokeWidth={2.6} />
      </button>
    </span>
  );
}

function PersonRow({
  coreUserId,
  member,
  selected,
  onToggle,
}: {
  coreUserId: string;
  member: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const profile = useProfile(coreUserId);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={member}
      aria-pressed={member ? undefined : selected}
      className="flex w-full items-center gap-3 px-6 py-2 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <span className="inline-flex shrink-0 rounded-full [&_[data-slot=avatar]>span]:bg-background [&_[data-slot=avatar]]:bg-background">
        <Avatar coreUserId={coreUserId} size={40} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{profile.displayName}</span>
        {member && <span className="block truncate text-xs text-muted-foreground">อยู่ในห้องแล้ว</span>}
      </span>

      {!member && (
        <span
          aria-hidden
          className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${
            selected ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground'
          }`}
        >
          {selected && <Check className="size-4" strokeWidth={3} />}
        </span>
      )}
    </button>
  );
}
