'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  Loader2,
  Link2,
  MoreHorizontal,
  UserPlus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { VerifiedBadge } from '@/components/csmju/user-badge';
import { Avatar } from '@/components/csmju/user-name';
import { ProfileAvatar } from '@/components/csmju/profile-avatar';
import { ProfileGear, ProfileNoteBubble } from '@/components/csmju/profile-gear';
import type { FollowListKind } from '@/components/csmju/profile-follow-list';
import { api } from '@/lib/csmju/api';
import type { Channel, MyProfile, ProfileDetail } from '@/lib/csmju/types';

/// หัวโปรไฟล์แบบ Instagram บนเว็บ
///
///   จอกว้าง  รูป 150px ซ้าย · ขวาเป็นชื่อ → รหัสผู้ใช้ → สถิติในบรรทัดเดียว
///            → คำแนะนำตัว → แถวปุ่ม
///   มือถือ   รูป 77px ซ้าย · ขวาเป็นชื่อกับสถิติสามคอลัมน์ (เลขบน ป้ายล่าง)
///            แล้วคำแนะนำตัวกับปุ่มเต็มความกว้างอยู่ใต้ทั้งหมด
///
/// **DOM ชุดเดียวสำหรับทั้งสองขนาด** — มือถือเป็น grid ที่ระบุแถว/คอลัมน์ของลูก
/// ทุกตัวไว้ตรง ๆ ส่วนคอลัมน์ขวาเป็น `display: contents` เพื่อให้ลูกของมัน
/// กลายเป็นลูกของ grid ได้ · จอกว้างสลับเป็น flex แล้วคอลัมน์ขวากลับเป็นกล่อง
/// ปกติ ทำแบบนี้แทนการวาดสองชุดแล้วซ่อนชุดหนึ่ง ซึ่งจะมีปุ่ม "ติดตาม" สองปุ่ม
/// ในหน้าเดียว — โปรแกรมอ่านหน้าจออ่านซ้ำ และเทสต์หาปุ่มไม่เจอว่าตัวไหน

/// ระยะขอบแยกจากฐานของปุ่ม — ปุ่มสี่เหลี่ยมจัตุรัสต้องไม่มี px-4 ติดมา
/// (`px-0` ต่อท้ายชนะ `px-4` ไม่ได้ เพราะ Tailwind เรียงตามลำดับใน CSS
/// ไม่ใช่ลำดับในสตริง — ไอคอนเคยถูกบีบเหลือจุดเดียว)
const BASE =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-csmju-label font-semibold transition-colors disabled:opacity-60';
const BUTTON = `${BASE} px-4`;
const MUTED_BUTTON = `${BUTTON} bg-muted text-foreground hover:bg-accent`;
const PRIMARY_BUTTON = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;

const BADGE_CAPTION = {
  ADMIN: 'ผู้ดูแลระบบ',
  STAFF: 'อาจารย์ / บุคลากรของสาขา',
} as const;

export function ProfileHeader({
  profile,
  mine,
  isMe,
  handle,
  busy,
  suggestionsOpen,
  hasSuggestions,
  onToggleFollow,
  onToggleSuggestions,
  onOpenList,
}: {
  profile: ProfileDetail;
  mine: MyProfile | null;
  isMe: boolean;
  /// บรรทัดรองใต้ชื่อ — coreUserId (และอีเมลเมื่อเป็นของตัวเอง)
  handle: string;
  busy: boolean;
  suggestionsOpen: boolean;
  hasSuggestions: boolean;
  onToggleFollow: () => void;
  onToggleSuggestions: () => void;
  onOpenList: (kind: FollowListKind) => void;
}) {
  // ของตัวเองใช้ค่าจาก /profiles/me ซึ่งอัปเดตทันทีหลังบันทึกในหน้าตั้งค่า
  const source = mine?.bio ?? profile.bio;
  const bio = source?.trim() ? source : null;
  const website = (mine as { website?: string | null } | null)?.website ?? profile.website ?? null;
  const stats = profile.stats;

  return (
    <header className="grid grid-cols-[77px_minmax(0,1fr)] gap-x-6 gap-y-3 px-4 md:flex md:items-start md:gap-0 md:px-0">
      <div className="col-start-1 row-span-2 row-start-1 self-center md:mr-8 md:self-start lg:mr-[30px] lg:flex lg:w-[291px] lg:shrink-0 lg:justify-center">
        <div className="relative">
          {isMe && <ProfileNoteBubble />}
          <ProfileAvatar coreUserId={profile.coreUserId} displayName={profile.displayName} />
        </div>
      </div>

      <div className="contents md:block md:min-w-0 md:flex-1 md:pt-1">
        {/* ─── ชื่อ + ปุ่มตั้งค่า / ปุ่มเพิ่มเติม ─── */}
        <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-2 self-end md:gap-3">
          <h1 className="flex min-w-0 items-center gap-1.5 text-lg leading-tight md:text-xl">
            <span className="truncate">{profile.displayName}</span>
            <VerifiedBadge badge={profile.badge} className="size-4.5" />
          </h1>

          {isMe ? (
            <ProfileGear />
          ) : (
            <MoreMenu profile={profile} />
          )}
        </div>

        {/* ─── บรรทัดรอง ─── */}
        <p className="col-span-2 row-start-3 -mb-2 truncate text-csmju-label text-muted-foreground md:mb-0 md:mt-1">
          {handle}
        </p>

        {/* ─── สถิติ ─── */}
        <ul
          aria-label="สถิติ"
          className="col-start-2 row-start-2 grid grid-cols-3 gap-2 self-start md:mt-5 md:flex md:gap-10"
        >
          <li className="flex flex-col text-csmju-label md:flex-row md:gap-1 md:text-base">
            <b className="font-semibold tabular-nums">{count(stats.postCount + stats.reelCount)}</b>
            <span>โพสต์</span>
          </li>

          <StatButton
            label="ผู้ติดตาม"
            value={stats.followerCount}
            onClick={() => onOpenList('followers')}
          />

          <StatButton
            label="กำลังติดตาม"
            value={stats.followingCount}
            onClick={() => onOpenList('following')}
          />
        </ul>

        {/* ─── ประเภทบัญชี + คำแนะนำตัว ─── */}
        {(profile.badge || bio || website) && (
          <div className="col-span-2 row-start-4 md:mt-4">
            {profile.badge && (
              <p className="text-csmju-label text-muted-foreground">
                {BADGE_CAPTION[profile.badge]}
              </p>
            )}
            {bio && (
              <p className="whitespace-pre-wrap break-words text-csmju-label leading-relaxed">
                {bio}
              </p>
            )}
            {website && <WebsiteLink href={website} />}
          </div>
        )}

        {profile.syncedAt === null && (
          <p className="col-span-2 row-start-5 text-csmju-caption text-muted-foreground md:mt-2">
            ยังไม่เคยซิงก์ชื่อจริงจากระบบกลาง — แสดงรหัสผู้ใช้ไปก่อน
          </p>
        )}

        {/* ─── แถวปุ่ม ─── */}
        <div className="col-span-2 row-start-6 flex gap-2 md:mt-5 md:max-w-[520px]">
          {isMe ? (
            <>
              <Link href="/settings/edit" className={`${MUTED_BUTTON} flex-1`}>
                แก้ไขโปรไฟล์
              </Link>
              <Link href="/archive" className={`${MUTED_BUTTON} flex-1`}>
                ดูคลัง
              </Link>
            </>
          ) : (
            <>
              {profile.relation.following ? (
                <FollowingMenu profile={profile} busy={busy} onUnfollow={onToggleFollow} />
              ) : (
                <button
                  type="button"
                  onClick={onToggleFollow}
                  disabled={busy}
                  className={`${PRIMARY_BUTTON} flex-1`}
                >
                  {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  {profile.relation.followedBy ? 'ติดตามกลับ' : 'ติดตาม'}
                </button>
              )}

              <MessageButton peer={profile.coreUserId} />

              {hasSuggestions && (
                <button
                  type="button"
                  onClick={onToggleSuggestions}
                  aria-expanded={suggestionsOpen}
                  aria-label={suggestionsOpen ? 'ซ่อนคนที่แนะนำ' : 'ดูคนที่แนะนำ'}
                  title="คนที่แนะนำ"
                  className={`${BASE} w-9 shrink-0 bg-muted text-foreground hover:bg-accent`}
                >
                  <UserPlus aria-hidden strokeWidth={1.9} className="size-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/// ลิงก์เว็บไซต์ใต้คำแนะนำตัว — แสดงแค่โดเมนกับ path แบบ Instagram
///
/// หลังบ้านรับเฉพาะ http/https อยู่แล้ว · `rel="noopener noreferrer nofollow"` เพราะ
/// เป็นลิงก์ที่ผู้ใช้กรอกเอง ไม่ควรรู้ว่ามาจากหน้าไหน และไม่ควรได้คะแนนลิงก์จากเรา
function WebsiteLink({ href }: { href: string }) {
  let label = href;

  try {
    const url = new URL(href);

    label = `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return null;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-0.5 inline-flex max-w-full items-center gap-1 text-csmju-label font-semibold text-link hover:underline"
    >
      <Link2 aria-hidden strokeWidth={2} className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}

function count(value: number) {
  return value.toLocaleString('th-TH');
}

/// ผู้ติดตาม **n** คน — จอกว้างเรียง "ป้าย เลข คน" ในบรรทัดเดียว มือถือเรียง
/// เลขไว้บนป้าย ใช้ `order` สลับลำดับแทนการเขียนข้อความสองชุด
function StatButton({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} ${count(value)} คน — ดูรายชื่อ`}
        className="flex flex-col text-left text-csmju-label hover:opacity-80 md:flex-row md:gap-1 md:text-base"
      >
        <b className="font-semibold tabular-nums md:order-2">{count(value)}</b>
        <span className="md:order-1">{label}</span>
        <span className="hidden md:order-3 md:inline">คน</span>
      </button>
    </li>
  );
}

/// ปุ่ม "กำลังติดตาม ▾" — กดแล้วเปิดกล่องตัวเลือกกลางจอแบบ Instagram
/// ไม่เลิกติดตามทันทีที่กด เพราะปุ่มนี้อยู่ตำแหน่งเดียวกับปุ่ม "ติดตาม"
/// ที่คนเพิ่งกดไป กดซ้ำเผลอ ๆ แล้วหายไปเงียบ ๆ ไม่ควรเกิด
function FollowingMenu({
  profile,
  busy,
  onUnfollow,
}: {
  profile: ProfileDetail;
  busy: boolean;
  onUnfollow: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-haspopup="dialog"
        className={`${MUTED_BUTTON} flex-1`}
      >
        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
        กำลังติดตาม
        <ChevronDown aria-hidden strokeWidth={2.2} className="size-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
          <div className="flex flex-col items-center gap-3 px-4 pb-4 pt-6 [&_[data-slot=avatar]>span]:!bg-background">
            <Avatar coreUserId={profile.coreUserId} size={56} showOnline={false} />
            <DialogTitle className="text-csmju-label font-semibold">
              {profile.displayName}
            </DialogTitle>
            <DialogDescription className="text-csmju-caption">
              {profile.relation.mutual
                ? 'คุณกับเขาติดตามกันและกัน'
                : 'คุณกำลังติดตามคนนี้'}
            </DialogDescription>
          </div>

          <MenuButton
            onClick={() => {
              setOpen(false);
              onUnfollow();
            }}
          >
            เลิกติดตาม
          </MenuButton>
          <MenuButton onClick={() => setOpen(false)}>ยกเลิก</MenuButton>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MenuButton({
  children,
  onClick,
  tone = 'normal',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'normal' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-12 w-full items-center justify-center border-t border-border px-4 text-csmju-label transition-colors hover:bg-accent disabled:opacity-60 ${
        tone === 'danger' ? 'font-bold text-destructive' : ''
      }`}
    >
      {children}
    </button>
  );
}

/// ปุ่ม "ข้อความ" — หลังบ้านหาห้องส่วนตัวเดิมก่อนสร้างใหม่ กดซ้ำจึงไม่ได้ห้องซ้ำ
function MessageButton({ peer }: { peer: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);

    try {
      const channel = await api.post<Channel>('/direct-channels', {
        peerCoreUserId: peer,
      });

      router.push(`/messages?channel=${encodeURIComponent(channel.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เปิดแชทไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      title={error ?? undefined}
      aria-describedby={error ? `${peer}-dm-error` : undefined}
      className={`${MUTED_BUTTON} flex-1`}
    >
      {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
      ข้อความ
      {error && (
        <span id={`${peer}-dm-error`} role="alert" className="sr-only">
          {error}
        </span>
      )}
    </button>
  );
}

/// ปุ่ม "…" บนโปรไฟล์คนอื่น — มีแค่สิ่งที่หลังบ้านทำได้จริง
/// (รายงานผู้ใช้ผ่าน `POST /reports` และคัดลอกลิงก์) ไม่มี "บล็อก" หรือ
/// "จำกัด" ของ Instagram เพราะระบบเรายังไม่มีสองอย่างนั้น
function MoreMenu({ profile }: { profile: ProfileDetail }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'report' | 'done'>('menu');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setMode('menu');
    setReason('');
    setMessage(null);
  }

  async function copyLink() {
    const url = `${window.location.origin}/profile/${encodeURIComponent(profile.coreUserId)}`;

    try {
      await navigator.clipboard.writeText(url);
      setMessage('คัดลอกลิงก์แล้ว');
    } catch {
      // เบราว์เซอร์ไม่ให้เขียนคลิปบอร์ด (เช่นไม่ใช่ https) — แสดงลิงก์ให้คัดลอกเอง
      setMessage(url);
    }

    setMode('done');
  }

  async function report() {
    setBusy(true);
    setMessage(null);

    try {
      await api.post('/reports', {
        targetKind: 'USER',
        targetId: profile.coreUserId,
        reason: reason.trim(),
      });
      setMessage('ส่งรายงานแล้ว — ผู้ดูแลระบบจะตรวจสอบ และคุณดูสถานะได้ภายหลัง');
      setMode('done');
    } catch (caught) {
      // เช่น "รายงานเรื่องนี้ไว้แล้ว" (409) — บอกตามจริง
      setMessage(caught instanceof Error ? caught.message : 'ส่งรายงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length >= 10;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ตัวเลือกเพิ่มเติม"
        aria-haspopup="dialog"
        className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-accent"
      >
        <MoreHorizontal aria-hidden strokeWidth={1.9} className="size-6" />
      </button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
          <DialogTitle className="sr-only">ตัวเลือกสำหรับ {profile.displayName}</DialogTitle>
          <DialogDescription className="sr-only">
            รายงานผู้ใช้หรือคัดลอกลิงก์โปรไฟล์
          </DialogDescription>

          {mode === 'menu' && (
            <div className="[&>button:first-child]:border-t-0">
              <MenuButton tone="danger" onClick={() => setMode('report')}>
                รายงาน
              </MenuButton>
              <MenuButton onClick={() => void copyLink()}>คัดลอกลิงก์โปรไฟล์</MenuButton>
              <MenuButton onClick={close}>ยกเลิก</MenuButton>
            </div>
          )}

          {mode === 'report' && (
            <form
              className="p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (reasonOk) void report();
              }}
            >
              <label htmlFor={`${id}-reason`} className="text-base font-bold">
                รายงาน {profile.displayName}
              </label>
              <p className="mt-1 text-csmju-caption text-muted-foreground">
                เล่าว่าเกิดอะไรขึ้น อย่างน้อย 10 ตัวอักษร เพื่อให้ผู้ดูแลตัดสินได้
              </p>
              <textarea
                id={`${id}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={4}
                className="mt-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-csmju-label outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {message && (
                <p role="alert" className="mt-2 text-csmju-caption text-destructive">
                  {message}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={close} className={MUTED_BUTTON}>
                  ยกเลิก
                </button>
                <button type="submit" disabled={!reasonOk || busy} className={PRIMARY_BUTTON}>
                  {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  ส่งรายงาน
                </button>
              </div>
            </form>
          )}

          {mode === 'done' && (
            <div>
              <p role="status" className="break-all px-4 py-6 text-center text-csmju-label">
                {message}
              </p>
              <MenuButton onClick={close}>ปิด</MenuButton>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
