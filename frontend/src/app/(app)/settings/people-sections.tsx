'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Loader2, Search, Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, shownName, useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import type { FollowEdge, ProfileSummary } from '@/lib/csmju/types';
import { SettingsHeading } from './settings-shell';
import type { PersonEdge } from './settings-types';
import { errorText, SettingsError, SettingsLoading } from './settings-ui';

/// เพื่อนสนิท · ถูกบล็อก — สองรายการคนที่จัดการได้จากหน้าตั้งค่า
///
/// เพื่อนสนิทเลือกได้จาก "คนที่ฉันติดตาม" เท่านั้น แบบ Instagram · ค้นหาด้วยชื่อ
/// ที่แสดงหรือรหัสผู้ใช้ — ชื่อแปลงเป็นชุดเดียวด้วย `GET /profiles?coreUserIds=`
/// แทนการยิงทีละคน

export const CLOSE_FRIENDS_KEY = ['close-friends'] as const;
export const BLOCKS_KEY = ['blocks'] as const;

/// หลังบ้านส่ง `coreUserId` (camelCase ตาม api-conventions.md ข้อ 3)
async function listIds(path: string) {
  return (await api.list<PersonEdge>(path)).items.map((row) => row.coreUserId);
}

function useSummaries(ids: string[]) {
  return useQuery({
    queryKey: ['profile-summaries', ids],
    enabled: ids.length > 0,
    queryFn: () =>
      api.get<ProfileSummary[]>(`/profiles?coreUserIds=${ids.slice(0, 100).map(encodeURIComponent).join(',')}`),
  });
}

function SearchPill({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <label className="mb-3 flex h-10 items-center gap-2 rounded-lg bg-muted px-4">
      <Search aria-hidden strokeWidth={1.9} className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">ค้นหา</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="ค้นหา"
        className="min-w-0 flex-1 bg-transparent text-csmju-label outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

function PersonLine({ coreUserId, action }: { coreUserId: string; action: React.ReactNode }) {
  const profile = useProfile(coreUserId);

  return (
    <li className="flex items-center gap-3 py-2">
      <Link href={`/profile/${encodeURIComponent(coreUserId)}`} tabIndex={-1} aria-hidden className="shrink-0">
        <Avatar coreUserId={coreUserId} size={44} showOnline={false} />
      </Link>
      <span className="min-w-0 flex-1 leading-tight">
        <Link
          href={`/profile/${encodeURIComponent(coreUserId)}`}
          className="block truncate text-csmju-label font-semibold hover:underline"
        >
          {profile.displayName}
        </Link>
      </span>
      {action}
    </li>
  );
}

export function CloseFriendsSection() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const following = useQuery({
    queryKey: ['close-friends-candidates'],
    queryFn: async () => (await api.list<FollowEdge>('/follows/following?limit=100')).items.map((row) => row.coreUserId),
  });
  const friends = useQuery({ queryKey: CLOSE_FRIENDS_KEY, queryFn: () => listIds('/close-friends?limit=100') });

  const ids = following.data ?? [];
  const chosen = new Set(friends.data ?? []);
  const names = useSummaries(ids);
  const term = query.trim().toLowerCase();
  const visible = ids.filter((id) => {
    if (!term) return true;

    const name = names.data?.find((row) => row.coreUserId === id)?.displayName ?? '';

    return id.toLowerCase().includes(term) || name.toLowerCase().includes(term);
  });

  async function toggle(coreUserId: string) {
    const on = chosen.has(coreUserId);

    setBusy(coreUserId);
    setError(null);
    // แตะแล้วติ๊กทันที — ถ้าหลังบ้านปฏิเสธค่อยย้อนกลับ
    queryClient.setQueryData<string[]>(CLOSE_FRIENDS_KEY, (current = []) =>
      on ? current.filter((id) => id !== coreUserId) : [...current, coreUserId],
    );

    try {
      if (on) await api.del(`/close-friends/${encodeURIComponent(coreUserId)}`);
      else await api.put(`/close-friends/${encodeURIComponent(coreUserId)}`);
    } catch (caught) {
      setError(errorText(caught, 'บันทึกเพื่อนสนิทไม่สำเร็จ'));
      void queryClient.invalidateQueries({ queryKey: CLOSE_FRIENDS_KEY });
    } finally {
      setBusy(null);
    }
  }

  const loadError = following.error ?? friends.error;

  return (
    <>
      <SettingsHeading>เพื่อนสนิท</SettingsHeading>

      <div className="mb-5 flex flex-col items-center text-center">
        <span className="grid size-16 place-items-center rounded-full bg-success text-background">
          <Star aria-hidden className="size-8 fill-current" />
        </span>
        <p className="mt-3 max-w-sm text-csmju-label text-muted-foreground">
          เราจะไม่ส่งการแจ้งเตือนเมื่อคุณแก้ไขรายชื่อเพื่อนสนิท · เลือกได้จากคนที่คุณติดตามอยู่
          {chosen.size > 0 && ` · ตอนนี้มี ${chosen.size.toLocaleString('th-TH')} คน`}
        </p>
      </div>

      {loadError ? (
        <SettingsError>{errorText(loadError, 'โหลดรายชื่อไม่สำเร็จ')}</SettingsError>
      ) : following.isPending || friends.isPending ? (
        <SettingsLoading />
      ) : ids.length === 0 ? (
        <p className="py-10 text-center text-csmju-label text-muted-foreground">
          คุณยังไม่ได้ติดตามใคร — ติดตามคนอื่นก่อนแล้วค่อยเพิ่มเป็นเพื่อนสนิท
        </p>
      ) : (
        <>
          {error && <SettingsError>{error}</SettingsError>}
          <SearchPill value={query} onChange={setQuery} />
          <ul aria-label="คนที่คุณติดตาม">
            {visible.map((id) => {
              const on = chosen.has(id);

              return (
                <PersonLine
                  key={id}
                  coreUserId={id}
                  action={
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`เพื่อนสนิท: ${shownName(id, names.data?.find((row) => row.coreUserId === id)?.displayName)}`}
                      disabled={busy === id}
                      onClick={() => void toggle(id)}
                      className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors disabled:opacity-60 ${
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/60'
                      }`}
                    >
                      {on && <Check aria-hidden strokeWidth={3} className="size-3.5" />}
                    </button>
                  }
                />
              );
            })}
          </ul>
          {visible.length === 0 && (
            <p className="py-8 text-center text-csmju-label text-muted-foreground">ไม่พบคนที่ตรงกับ “{query.trim()}”</p>
          )}
        </>
      )}
    </>
  );
}

export function BlockedSection() {
  const queryClient = useQueryClient();
  const blocks = useQuery({ queryKey: BLOCKS_KEY, queryFn: () => listIds('/blocks?limit=100') });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unblock(coreUserId: string) {
    setBusy(true);
    setError(null);

    try {
      await api.del(`/blocks/${encodeURIComponent(coreUserId)}`);
      queryClient.setQueryData<string[]>(BLOCKS_KEY, (current = []) => current.filter((id) => id !== coreUserId));
      setConfirming(null);
    } catch (caught) {
      setError(errorText(caught, 'เลิกบล็อกไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  const ids = blocks.data ?? [];

  return (
    <>
      <SettingsHeading>ถูกบล็อก</SettingsHeading>

      {blocks.error ? (
        <SettingsError>{errorText(blocks.error, 'โหลดรายชื่อไม่สำเร็จ')}</SettingsError>
      ) : blocks.isPending ? (
        <SettingsLoading />
      ) : ids.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <span className="grid size-[62px] place-items-center rounded-full border-2 border-foreground">
            <Ban aria-hidden strokeWidth={1.2} className="size-8" />
          </span>
          <h3 className="mt-4 text-xl font-bold">ยังไม่มีบัญชีที่ถูกบล็อก</h3>
          <p className="mt-1 max-w-xs text-csmju-label text-muted-foreground">
            เมื่อคุณบล็อกใคร เขาจะส่งข้อความหรือเห็นเนื้อหาของคุณไม่ได้ และรายชื่อจะแสดงที่นี่
          </p>
        </div>
      ) : (
        <ul aria-label="บัญชีที่ถูกบล็อก">
          {ids.map((id) => (
            <PersonLine
              key={id}
              coreUserId={id}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setConfirming(id);
                  }}
                  className="h-8 shrink-0 rounded-lg bg-muted px-4 text-csmju-label font-semibold hover:bg-accent"
                >
                  เลิกบล็อก
                </button>
              }
            />
          ))}
        </ul>
      )}

      {confirming && (
        <UnblockConfirm
          coreUserId={confirming}
          busy={busy}
          error={error}
          onConfirm={() => void unblock(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}

function UnblockConfirm({
  coreUserId,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  coreUserId: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const profile = useProfile(coreUserId);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
        <div className="px-6 pb-4 pt-7 text-center">
          <DialogTitle className="text-lg font-semibold leading-snug">เลิกบล็อก {profile.displayName} ใช่ไหม</DialogTitle>
          <DialogDescription className="mt-1.5">
            เขาจะเห็นโพสต์และติดตามคุณได้อีกครั้ง โดยจะไม่ได้รับการแจ้งเตือนว่าคุณเลิกบล็อกแล้ว
          </DialogDescription>
          {error && (
            <p role="alert" className="mt-2 text-csmju-caption text-destructive">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="flex min-h-12 w-full items-center justify-center gap-1.5 border-t border-border text-csmju-label font-bold text-link hover:bg-accent disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          เลิกบล็อก
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label hover:bg-accent disabled:opacity-60"
        >
          ยกเลิก
        </button>
      </DialogContent>
    </Dialog>
  );
}
