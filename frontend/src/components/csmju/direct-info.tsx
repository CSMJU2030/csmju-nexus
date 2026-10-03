'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, Loader2, X } from 'lucide-react';
import {
  ConversationAvatar,
  ConversationName,
  othersOf,
  useInboxActions,
} from '@/components/csmju/inbox-list';
import { ConfirmDialog } from '@/components/csmju/messages-menu';
import { useFollowToggle, useMyFollowing } from '@/components/csmju/profile-follow-list';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel } from '@/lib/csmju/types';

/// แผงรายละเอียดของบทสนทนา (ปุ่ม ⓘ) แบบ Instagram Direct
///
/// จอกว้าง = คอลัมน์ขวา 340px · จอแคบและหน้าต่างแชทลอย = เต็มพื้นที่ทับบทสนทนา
///
/// ลำดับแบบ IG: ปิดเสียงข้อความ · สมาชิก (ติดตาม/ดูโปรไฟล์) · ชื่อเล่น · บล็อก ·
/// รายงาน · ลบแชท · ออกจากแชท (กลุ่ม) — ทุกปุ่มยิง endpoint จริงของหลังบ้าน
/// แชทกลุ่มไม่มี "บล็อก" เพราะหลังบ้านให้บล็อกมีผลเฉพาะแชทสองคน

/// คนที่ฉันบล็อกไว้ — หลังบ้านคืนได้ครั้งละ 100 คน ซึ่งเกินพอสำหรับบัญชีนักศึกษา
export const BLOCKS_KEY = ['blocks', 'mine'] as const;

export function useMyBlocks() {
  return useQuery({
    queryKey: BLOCKS_KEY,
    queryFn: async () =>
      new Set(
        (await api.list<{ coreUserId: string }>('/blocks?limit=100')).items
          .map((row) => row.coreUserId)
          .filter(Boolean),
      ),
    staleTime: 60_000,
  });
}

/// บล็อก/เลิกบล็อก แล้วแก้แคชทันที — ช่องพิมพ์ของแชทนี้สลับเป็นแถบ "บล็อกแล้ว" เอง
export function useBlockToggle() {
  const queryClient = useQueryClient();

  return async function toggle(coreUserId: string, blocked: boolean) {
    if (blocked) await api.del(`/blocks/${encodeURIComponent(coreUserId)}`);
    else await api.post('/blocks', { coreUserId: coreUserId });

    queryClient.setQueryData<Set<string>>(BLOCKS_KEY, (current) => {
      const next = new Set(current ?? []);

      if (blocked) next.delete(coreUserId);
      else next.add(coreUserId);

      return next;
    });
    // บล็อก = เลิกติดตามกันทั้งคู่ (หลังบ้านทำให้) — ปุ่มติดตามต้องอ่านค่าใหม่
    void queryClient.invalidateQueries({ queryKey: ['my-following'] });
  };
}

/// แทนที่ช่องพิมพ์ของแชทที่เราบล็อกไว้ แบบ IG
export function BlockedBar({ coreUserId }: { coreUserId: string }) {
  const toggle = useBlockToggle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="shrink-0 border-t border-border px-4 py-4 text-center animate-in fade-in-0 duration-150">
      <p className="text-sm font-semibold">คุณบล็อกบัญชีนี้แล้ว</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        คุณส่งข้อความในแชทนี้ไม่ได้จนกว่าจะเลิกบล็อก
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          toggle(coreUserId, true)
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : 'เลิกบล็อกไม่สำเร็จ'),
            )
            .finally(() => setBusy(false));
        }}
        className="mt-3 h-8 rounded-lg bg-muted px-4 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"
      >
        เลิกบล็อก
      </button>
    </div>
  );
}

export function InfoPanel({
  channel,
  layout,
  onClose,
  onGone,
}: {
  channel: Channel;
  /// side = คอลัมน์ขวาของหน้าเต็ม (จอแคบกลายเป็นเต็มจอเอง) · overlay = ทับในกรอบแม่ (หน้าต่างลอย)
  layout: 'side' | 'overlay';
  onClose: () => void;
  /// ห้องหายจากกล่องข้อความแล้ว (ลบแชท/ออกจากแชท) — ผู้เรียกพากลับไปรายการ
  onGone?: () => void;
}) {
  const me = useMe();
  const inbox = useInboxActions();
  const group = channel.kind === 'GROUP_DM';
  const others = othersOf(channel, me.id);
  const members = group ? (channel.memberCoreUserIds ?? [me.id, ...others]) : [...others, me.id];
  const peer = group ? null : (others[0] ?? null);

  const blocks = useMyBlocks();
  const toggleBlock = useBlockToggle();
  const peerProfile = useProfile(peer ?? me.id);
  const blocked = peer !== null && (blocks.data?.has(peer) ?? false);

  const [muteBusy, setMuteBusy] = useState(false);
  const [confirm, setConfirm] = useState<'clear' | 'leave' | 'block' | null>(null);
  const [nicknaming, setNicknaming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleMute() {
    setMuteBusy(true);
    setError(null);

    try {
      await inbox.update(channel, { muted: !channel.muted });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เปลี่ยนการแจ้งเตือนไม่สำเร็จ');
    } finally {
      setMuteBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;

    setBusy(true);
    setError(null);

    try {
      if (confirm === 'block') {
        if (peer) await toggleBlock(peer, false);

        setConfirm(null);

        return;
      }

      if (confirm === 'clear') await inbox.clear(channel);
      else await inbox.leave(channel);

      setConfirm(null);
      onGone?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const shell =
    layout === 'overlay'
      ? 'absolute inset-0 z-20 bg-card animate-in fade-in-0 zoom-in-95 duration-150'
      : // จอแคบ: ทับทั้งจอแบบหน้าใหม่ของ IG มือถือ · จอกว้าง: คอลัมน์ขวา
        // z เหนือแถบล่างของมือถือ (z-60) ไม่งั้นปุ่มล่างสุด (ลบแชท) จมอยู่ใต้แถบ
        'max-lg:fixed max-lg:inset-0 max-lg:z-[65] max-lg:bg-background max-lg:animate-in max-lg:fade-in-0 max-lg:zoom-in-95 lg:w-[340px] lg:shrink-0 lg:border-l lg:border-border';

  return (
    <aside aria-label="รายละเอียดบทสนทนา" className={`flex flex-col overflow-y-auto ${shell}`}>
      <div className="flex h-[75px] shrink-0 items-center gap-2 border-b border-border px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดรายละเอียด"
          className="grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
        >
          {layout === 'overlay' ? (
            <ChevronLeft aria-hidden className="size-6" strokeWidth={1.9} />
          ) : (
            <>
              <ChevronLeft aria-hidden className="size-6 lg:hidden" strokeWidth={1.9} />
              <X aria-hidden className="size-5 max-lg:hidden" strokeWidth={1.9} />
            </>
          )}
        </button>
        <h2 className="text-xl font-semibold">รายละเอียด</h2>
      </div>

      {group && (
        <div className="flex flex-col items-center gap-2 border-b border-border px-6 py-5 text-center">
          <ConversationAvatar channel={channel} size={64} />
          <p className="text-base font-semibold">
            <ConversationName channel={channel} />
          </p>
          <p className="text-xs text-muted-foreground">{members.length} คน</p>
        </div>
      )}

      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <span id={`mute-${channel.id}`} className="text-sm">
            ปิดเสียงข้อความ
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={channel.muted}
            aria-labelledby={`mute-${channel.id}`}
            disabled={muteBusy}
            onClick={() => void toggleMute()}
            className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
              channel.muted ? 'bg-foreground' : 'bg-muted-foreground/40'
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 size-5 rounded-full bg-background shadow transition-[left] ${
                channel.muted ? 'left-[1.125rem]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          ไม่มีการแจ้งเตือนจากแชทนี้ แต่ยังนับข้อความที่ยังไม่อ่านตามปกติ
        </p>
      </div>

      <div className="px-6 pt-4">
        <h3 className="text-base font-semibold">สมาชิก</h3>
      </div>

      <ul className="py-2">
        {members.map((id) => (
          <li key={id}>
            <MemberRow coreUserId={id} isMe={id === me.id} />
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="px-6 pb-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-auto border-t border-border py-2">
        <ActionRow onClick={() => setNicknaming(true)}>ชื่อเล่น</ActionRow>
        {peer && (
          <ActionRow
            onClick={() => {
              if (blocked) {
                setError(null);
                void toggleBlock(peer, true).catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : 'เลิกบล็อกไม่สำเร็จ'),
                );
              } else {
                setConfirm('block');
              }
            }}
          >
            {blocked ? 'เลิกบล็อก' : 'บล็อก'}
          </ActionRow>
        )}
        {peer && (
          <ActionRow tone="danger" onClick={() => setReporting(true)}>
            รายงาน
          </ActionRow>
        )}
        {group && (
          <ActionRow tone="danger" onClick={() => setConfirm('leave')}>
            ออกจากแชท
          </ActionRow>
        )}
        <ActionRow tone="danger" onClick={() => setConfirm('clear')}>
          ลบแชท
        </ActionRow>
      </div>

      <NicknameDialog
        open={nicknaming}
        channel={channel}
        members={[me.id, ...members.filter((id) => id !== me.id)]}
        onClose={() => setNicknaming(false)}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'block'
            ? `บล็อก ${peerProfile.displayName} ไหม`
            : confirm === 'leave'
              ? 'ออกจากแชทนี้ไหม'
              : 'ลบแชทนี้ไหม'
        }
        description={
          confirm === 'block'
            ? 'เขาจะส่งข้อความหาคุณ ดูโปรไฟล์ โพสต์ และสตอรี่ของคุณไม่ได้ และคุณทั้งสองจะเลิกติดตามกัน · เขาจะไม่ได้รับแจ้งว่าคุณบล็อก'
            : confirm === 'leave'
              ? 'คุณจะไม่ได้รับข้อความจากกลุ่มนี้อีก จนกว่าจะมีคนเพิ่มคุณกลับเข้ามา'
              : 'ข้อความทั้งหมดจะหายจากฝั่งคุณเท่านั้น คนอื่นในแชทยังเห็นอยู่ แชทจะกลับมาเมื่อมีข้อความใหม่'
        }
        confirmLabel={confirm === 'block' ? 'บล็อก' : confirm === 'leave' ? 'ออก' : 'ลบ'}
        busy={busy}
        error={error}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
      />

      {peer && (
        <ReportUserDialog
          coreUserId={peer}
          open={reporting}
          onClose={() => setReporting(false)}
        />
      )}
    </aside>
  );
}

function ActionRow({
  onClick,
  tone = 'default',
  children,
}: {
  onClick: () => void;
  tone?: 'default' | 'danger';
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-6 py-3 text-left text-sm transition-colors hover:bg-accent ${
        tone === 'danger' ? 'font-semibold text-destructive' : ''
      }`}
    >
      {children}
    </button>
  );
}

function MemberRow({ coreUserId, isMe }: { coreUserId: string; isMe: boolean }) {
  const profile = useProfile(coreUserId);
  const following = useMyFollowing();
  const toggleFollow = useFollowToggle();
  const [busy, setBusy] = useState(false);
  const isFollowing = following.data?.has(coreUserId) ?? false;
  const href = `/profile/${encodeURIComponent(coreUserId)}`;

  return (
    <div className="flex items-center gap-3 px-6 py-2">
      <Link href={href} className="shrink-0" aria-label={`ดูโปรไฟล์ของ ${profile.displayName}`}>
        <Avatar coreUserId={coreUserId} size={44} />
      </Link>

      <Link href={href} className="min-w-0 flex-1 hover:underline">
        <span className="block truncate text-sm font-semibold">
          {profile.displayName}
          {isMe ? ' (คุณ)' : ''}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{coreUserId}</span>
      </Link>

      {!isMe && following.data && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void toggleFollow(coreUserId, isFollowing)
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
          className={`h-8 shrink-0 rounded-lg px-4 text-sm font-semibold transition-opacity disabled:opacity-50 ${
            isFollowing ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground'
          }`}
        >
          {isFollowing ? 'กำลังติดตาม' : 'ติดตาม'}
        </button>
      )}
    </div>
  );
}

/// รายงานผู้ใช้ — คิวรายงานเดียวกับปุ่ม "รายงาน" บนหน้าโปรไฟล์ (targetKind USER)
export function ReportUserDialog({
  coreUserId,
  open,
  onClose,
}: {
  coreUserId: string;
  open: boolean;
  onClose: () => void;
}) {
  const profile = useProfile(coreUserId);
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 10;

  function close() {
    onClose();
    setReason('');
    setDone(null);
    setError(null);
  }

  async function send() {
    setBusy(true);
    setError(null);

    try {
      await api.post('/reports', {
        targetKind: 'USER',
        targetId: coreUserId,
        reason: reason.trim(),
      });
      setDone('ส่งรายงานแล้ว — ผู้ดูแลระบบจะตรวจสอบ');
    } catch (caught) {
      // เช่น "รายงานเรื่องนี้ไว้แล้ว" (409) — บอกตามจริง
      setError(caught instanceof Error ? caught.message : 'ส่งรายงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-[400px] rounded-xl">
        <DialogTitle className="border-b border-border px-6 py-4 text-center text-base">
          รายงาน {profile.displayName}
        </DialogTitle>

        {done ? (
          <div className="px-6 py-8 text-center">
            <DialogDescription className="text-sm text-foreground">{done}</DialogDescription>
          </div>
        ) : (
          <form
            className="space-y-3 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) void send();
            }}
          >
            <DialogDescription className="text-xs text-muted-foreground">
              เล่าว่าเกิดอะไรขึ้น อย่างน้อย 10 ตัวอักษร เพื่อให้ผู้ดูแลตัดสินได้ — อีกฝ่ายจะไม่รู้ว่าใครรายงาน
            </DialogDescription>
            <label htmlFor={id} className="sr-only">
              เหตุผลที่รายงาน
            </label>
            <textarea
              id={id}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!valid || busy}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-destructive text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              ส่งรายงาน
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/// ชื่อเล่นในแชทนี้แบบ IG — กดคนไหนแถวนั้นกลายเป็นช่องพิมพ์ "ป้อนชื่อเล่น…" + ✓
///
/// สมาชิกทุกคนตั้งให้ใครในห้องก็ได้ (รวมตัวเอง) และทุกคนในห้องเห็นเหมือนกัน
/// เว้นว่างแล้วกด ✓ = ลบชื่อเล่น · หลังบ้านกระจาย channel:updated ให้คนอื่นด้วย
export const NICKNAME_MAX = 40;

function NicknameDialog({
  open,
  channel,
  members,
  onClose,
}: {
  open: boolean;
  channel: Channel;
  members: string[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-[400px] rounded-xl">
        <DialogTitle className="border-b border-border px-6 py-4 text-center text-base">
          ชื่อเล่น
        </DialogTitle>
        <DialogDescription className="sr-only">
          ตั้งชื่อเล่นให้สมาชิกในแชทนี้ กดที่ชื่อเพื่อแก้
        </DialogDescription>

        <ul className="max-h-[60dvh] overflow-y-auto py-2">
          {members.map((id) => (
            <li key={id}>
              <NicknameRow channel={channel} coreUserId={id} />
            </li>
          ))}
        </ul>

        <p className="border-t border-border px-6 py-3 text-center text-xs text-muted-foreground">
          ชื่อเล่นจะปรากฏในแชทนี้เท่านั้น
        </p>
      </DialogContent>
    </Dialog>
  );
}

function NicknameRow({ channel, coreUserId }: { channel: Channel; coreUserId: string }) {
  const profile = useProfile(coreUserId);
  const inbox = useInboxActions();
  const current = channel.nicknames?.[coreUserId] ?? '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save() {
    setBusy(true);
    setError(null);

    try {
      const updated = await api.put<Channel>(
        `/channels/${channel.id}/members/${encodeURIComponent(coreUserId)}/nickname`,
        { nickname: value.trim() || null },
      );

      inbox.replace(updated);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ตั้งชื่อเล่นไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form
        className="flex items-center gap-3 px-6 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Avatar coreUserId={coreUserId} size={44} showOnline={false} />
        <span className="min-w-0 flex-1">
          <label className="sr-only" htmlFor={`nick-${coreUserId}`}>
            ชื่อเล่นของ {profile.displayName}
          </label>
          <input
            id={`nick-${coreUserId}`}
            ref={inputRef}
            value={value}
            maxLength={NICKNAME_MAX}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // ปิดแค่ช่องนี้ ไม่ปิดทั้งกล่อง
                event.preventDefault();
                event.stopPropagation();
                setValue(current);
                setEditing(false);
              }
            }}
            placeholder="ป้อนชื่อเล่น…"
            className="w-full border-b border-border bg-transparent py-1 text-sm outline-none focus:border-foreground"
          />
          {error && (
            <span role="alert" className="mt-1 block text-xs text-destructive">
              {error}
            </span>
          )}
        </span>
        <button
          type="submit"
          disabled={busy}
          aria-label="บันทึกชื่อเล่น"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-link text-white disabled:opacity-50"
        >
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" strokeWidth={3} />}
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(current);
        setEditing(true);
      }}
      className="flex w-full items-center gap-3 px-6 py-2 text-left transition-colors hover:bg-accent"
    >
      <Avatar coreUserId={coreUserId} size={44} showOnline={false} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{current || profile.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {coreUserId}
          {current ? ` · ${profile.displayName}` : ' · ตั้งชื่อเล่น'}
        </span>
      </span>
    </button>
  );
}
