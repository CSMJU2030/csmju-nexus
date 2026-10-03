'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search, X } from 'lucide-react';
import {
  CHANNELS_KEY,
  ConversationAvatar,
  ConversationName,
  inFolder,
  othersOf,
} from '@/components/csmju/inbox-list';
import { showToast } from '@/components/csmju/messages-toast';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, DeliveryResult, Message, SearchHit } from '@/lib/csmju/types';

/// กล่อง "ส่งต่อ" แบบ Instagram — เลือกแชทหรือคน (วงกลมด้านขวา) แล้วกด "ส่ง"
///
///   ส่งต่อ                                   ✕
///   ถึง: [ค้นหา…]
///   แชทล่าสุด / ผลค้นหา  ○ ●
///   [ ส่ง ]   ← กดไม่ได้จนกว่าจะเลือกอย่างน้อยหนึ่ง
///
/// ส่งผ่าน `POST /channels/:id/messages/:messageId/forwards` ครั้งเดียว
/// (หลังบ้านรับรวม 1-20 ปลายทาง · คนที่ยังไม่มีห้องด้วย หลังบ้านเปิด DM ให้เอง)

export const MAX_FORWARD_TARGETS = 20;

type Target = { kind: 'channel'; id: string } | { kind: 'person'; id: string };

const keyOf = (target: Target) => `${target.kind}:${target.id}`;

export function ForwardDialog({
  message,
  onClose,
}: {
  /// ข้อความที่จะส่งต่อ · null = ปิดกล่อง
  message: Message | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={message !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[548px]" showCloseButton={false}>
        {message && <ForwardBody message={message} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ForwardBody({ message, onClose }: { message: Message; onClose: () => void }) {
  const me = useMe();
  const id = useId();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // แคชรายการห้องก้อนเดียวกับกล่องข้อความ — ไม่ยิงซ้ำถ้ามีอยู่แล้ว
  const { data: channels = [] } = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: async () => (await api.list<Channel>('/channels?limit=50')).items,
  });

  // โฟกัสช่อง "ถึง:" หลัง showModal() ทำงานเสร็จ (มันแย่งโฟกัสไปปุ่มแรกก่อน)
  useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);

  /// ผลค้นหาพร้อมคำที่ใช้ค้น — รู้ได้ว่าผลตรงกับที่พิมพ์อยู่หรือยัง โดยไม่ต้อง
  /// setState ในตัว effect (React Compiler ห้าม)
  const [results, setResults] = useState<{ term: string; items: string[] } | null>(null);
  const term = q.trim();
  const longEnough = term.length >= 2;

  useEffect(() => {
    if (!longEnough) return;

    const timer = setTimeout(() => {
      void api
        .list<SearchHit>(`/search${qs({ q: term, kind: 'people', limit: 20 })}`)
        .then((page) =>
          setResults({ term, items: page.items.map((hit) => hit.id).filter((hit) => hit !== me.id) }),
        )
        .catch(() => setResults({ term, items: [] }));
    }, 300);

    return () => clearTimeout(timer);
  }, [longEnough, term, me.id]);

  const recent = useMemo(
    () =>
      channels.filter(
        (row) => inFolder(row, 'PRIMARY') || inFolder(row, 'GENERAL'),
      ),
    [channels],
  );

  const fresh = results?.term === term;
  const searching = longEnough && !fresh;
  const people = longEnough && fresh ? results.items : [];
  const isPicked = (target: Target) => picked.some((row) => keyOf(row) === keyOf(target));

  function toggle(target: Target) {
    setError(null);

    if (!isPicked(target) && picked.length >= MAX_FORWARD_TARGETS) {
      setError(`ส่งต่อได้ครั้งละไม่เกิน ${MAX_FORWARD_TARGETS} ปลายทาง`);

      return;
    }

    // updater — กดสองแถวติดกันก่อนวาดใหม่ต้องได้ทั้งสอง
    setPicked((current) =>
      current.some((row) => keyOf(row) === keyOf(target))
        ? current.filter((row) => keyOf(row) !== keyOf(target))
        : [...current, target],
    );
  }

  async function send() {
    setBusy(true);
    setError(null);

    const channelIds = picked.filter((row) => row.kind === 'channel').map((row) => row.id);
    const peerIds = picked.filter((row) => row.kind === 'person').map((row) => row.id);

    try {
      const result = await api.post<DeliveryResult>(
        `/channels/${message.channelId}/messages/${message.id}/forwards`,
        {
          ...(channelIds.length ? { channelIds: channelIds } : {}),
          ...(peerIds.length ? { peerCoreUserIds: peerIds } : {}),
        },
      );

      showToast(result.channelIds.length > 1 ? `ส่งต่อแล้ว ${result.channelIds.length} แชท` : 'ส่งต่อแล้ว');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งต่อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[min(600px,calc(100dvh-2rem))] flex-col">
      <div className="relative flex h-[51px] shrink-0 items-center justify-center border-b border-border">
        <DialogTitle className="text-base font-bold">ส่งต่อ</DialogTitle>
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
        เลือกแชทหรือคนที่จะส่งข้อความนี้ไปให้ แล้วกดส่ง
      </DialogDescription>

      <label htmlFor={`${id}-to`} className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <span className="text-base font-semibold">ถึง:</span>
        <Search aria-hidden className="size-4 text-muted-foreground" />
        <input
          id={`${id}-to`}
          ref={searchRef}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="ค้นหา…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {error && (
          <p role="alert" className="px-6 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {longEnough ? (
          <>
            {searching && (
              <p className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                กำลังค้นหา…
              </p>
            )}
            {!searching && people.length === 0 && (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                ไม่พบบัญชี — ค้นได้เฉพาะคนที่เคยใช้งานระบบนี้แล้ว
              </p>
            )}
            <ul aria-label="ผลการค้นหา">
              {people.map((person) => (
                <li key={person}>
                  <PersonOption
                    coreUserId={person}
                    selected={isPicked({ kind: 'person', id: person })}
                    onToggle={() => toggle({ kind: 'person', id: person })}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="px-6 pb-1 pt-2 text-sm font-semibold">แชทล่าสุด</p>
            {recent.length === 0 && (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                ยังไม่มีแชท — พิมพ์ชื่อเพื่อค้นหาคน
              </p>
            )}
            <ul aria-label="แชทล่าสุด">
              {recent.map((channel) => (
                <li key={channel.id}>
                  <Option
                    selected={isPicked({ kind: 'channel', id: channel.id })}
                    onToggle={() => toggle({ kind: 'channel', id: channel.id })}
                    avatar={<ConversationAvatar channel={channel} size={44} showOnline={false} />}
                    title={<ConversationName channel={channel} />}
                    subtitle={
                      channel.kind === 'GROUP_DM'
                        ? `${channel.memberCoreUserIds?.length ?? channel.memberCount} คน`
                        : (othersOf(channel, me.id)[0] ?? '')
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={() => void send()}
          disabled={picked.length === 0 || busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          ส่ง
        </button>
      </div>
    </div>
  );
}

function PersonOption({
  coreUserId,
  selected,
  onToggle,
}: {
  coreUserId: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const profile = useProfile(coreUserId);

  return (
    <Option
      selected={selected}
      onToggle={onToggle}
      avatar={<Avatar coreUserId={coreUserId} size={44} showOnline={false} />}
      title={profile.displayName}
    />
  );
}

function Option({
  selected,
  onToggle,
  avatar,
  title,
  subtitle,
}: {
  selected: boolean;
  onToggle: () => void;
  avatar: ReactNode;
  title: ReactNode;
  /// ไม่ส่ง = บรรทัดเดียว (คนไม่มีบรรทัดรอง — ห้ามใช้ coreUserId แทน)
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 px-6 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="inline-flex shrink-0 rounded-full [&_[data-slot=avatar]>span]:bg-background [&_[data-slot=avatar]]:bg-background">
        {avatar}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {subtitle && <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>}
      </span>
      <span
        aria-hidden
        className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${
          selected ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground'
        }`}
      >
        {selected && <Check className="size-4" strokeWidth={3} />}
      </span>
    </button>
  );
}
