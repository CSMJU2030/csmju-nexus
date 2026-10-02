'use client';

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { FeedModal, SheetButton, SheetLink } from '@/components/csmju/feed-modal';
import { toast } from '@/components/csmju/feed-toast';
import { copyShareLink } from '@/components/csmju/share-sheet';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import type { ProfileDetail } from '@/lib/csmju/types';

/// เมนู ⋯ ของโพสต์แบบ Instagram (action sheet) — สลับเนื้อหาในกล่องเดียว
///
///   รายงาน (แดง) · ไปยังโพสต์ · แชร์ไปยัง… · คัดลอกลิงก์ · เกี่ยวกับบัญชีนี้ · ยกเลิก
///   เจ้าของ/ผู้ดูแลได้ "ลบ" (แดง ยืนยันก่อน) แทน "รายงาน"
///
/// **ไม่มี "โค้ดสำหรับใช้ฝัง"** ระบบไม่มีหน้าสาธารณะให้ฝัง และข้อมูลภายในของ
/// มหาวิทยาลัยไม่ควรไปโผล่บนเว็บภายนอก

type Mode = 'menu' | 'report' | 'about' | 'confirm';

export function PostMenu({
  open,
  onClose,
  postId,
  authorCoreUserId,
  canDelete,
  isOwner,
  onDelete,
  onShareTo,
  showGoToPost = true,
}: {
  open: boolean;
  onClose: () => void;
  postId: string;
  authorCoreUserId: string;
  canDelete: boolean;
  isOwner: boolean;
  onDelete: () => Promise<void>;
  /// เปิดแผ่นแชร์ — เมนูปิดก่อน (เปิดทีละชั้น)
  onShareTo: () => void;
  /// อยู่ที่หน้าโพสต์แล้ว ไม่ต้องมี "ไปยังโพสต์"
  showGoToPost?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;

    setMode('menu');
    setError(null);
    onClose();
  }

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      await onDelete();
      setBusy(false);
      setMode('menu');
      onClose();
      toast('ลบโพสต์แล้ว');
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof ApiError ? caught.message : 'ลบโพสต์ไม่สำเร็จ');
    }
  }

  return (
    <FeedModal open={open} onClose={close} label="ตัวเลือกของโพสต์" className="max-w-100">
      {mode === 'menu' && (
        <>
          {canDelete ? (
            <SheetButton tone="danger" onClick={() => setMode('confirm')}>
              ลบ
            </SheetButton>
          ) : null}
          {!isOwner && (
            <SheetButton tone="danger" onClick={() => setMode('report')}>
              รายงาน
            </SheetButton>
          )}
          {showGoToPost && (
            <SheetLink href={`/p/${encodeURIComponent(postId)}`} onClick={close}>
              ไปยังโพสต์
            </SheetLink>
          )}
          <SheetButton
            onClick={() => {
              close();
              onShareTo();
            }}
          >
            แชร์ไปยัง…
          </SheetButton>
          <SheetButton
            onClick={() => {
              void copyShareLink({ kind: 'POST', id: postId });
              close();
            }}
          >
            คัดลอกลิงก์
          </SheetButton>
          <SheetButton onClick={() => setMode('about')}>เกี่ยวกับบัญชีนี้</SheetButton>
          <SheetButton onClick={close}>ยกเลิก</SheetButton>
        </>
      )}

      {mode === 'confirm' && (
        <>
          <div className="px-6 pb-4 pt-7 text-center">
            <h2 className="text-csmju-body font-semibold">ลบโพสต์ใช่ไหม</h2>
            <p className="mt-1.5 text-csmju-label text-muted-foreground">
              ความคิดเห็นและรีแอ็กชันของโพสต์นี้จะหายไปด้วย และกู้คืนไม่ได้
            </p>
            {error && (
              <p role="alert" className="mt-2 text-csmju-caption text-destructive">
                {error}
              </p>
            )}
          </div>
          <SheetButton tone="danger" onClick={() => void remove()} disabled={busy}>
            ลบ
          </SheetButton>
          <SheetButton onClick={() => setMode('menu')} disabled={busy}>
            ยกเลิก
          </SheetButton>
        </>
      )}

      {mode === 'report' && (
        <ReportForm
          targetKind="POST"
          targetId={postId}
          subject="โพสต์นี้"
          onCancel={() => setMode('menu')}
          onDone={close}
        />
      )}

      {mode === 'about' && <AboutAccount coreUserId={authorCoreUserId} onClose={close} />}
    </FeedModal>
  );
}

/// รายงานเข้าคิวเดียวกับที่ผู้ดูแลตรวจ (POST /reports) — เหตุผลอย่างน้อย 10 ตัวอักษร
/// ตามที่หลังบ้านบังคับ เพื่อให้ผู้ดูแลตัดสินได้
export function ReportForm({
  targetKind,
  targetId,
  subject,
  onCancel,
  onDone,
}: {
  targetKind: 'POST' | 'REEL' | 'USER' | 'COMMENT';
  targetId: string;
  subject: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 10;

  async function send() {
    setBusy(true);
    setError(null);

    try {
      await api.post('/reports', { targetKind: targetKind, targetId: targetId, reason: reason.trim() });
      toast('ส่งรายงานแล้ว — ผู้ดูแลระบบจะตรวจสอบ');
      onDone();
    } catch (caught) {
      // เช่น "รายงานเรื่องนี้ไว้แล้ว" (409) — บอกตามจริง
      setError(caught instanceof ApiError ? caught.message : 'ส่งรายงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok && !busy) void send();
      }}
    >
      <label htmlFor={`${id}-reason`} className="text-csmju-body font-bold">
        รายงาน{subject}
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
      {error && (
        <p role="alert" className="mt-2 text-csmju-caption text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-csmju-label hover:bg-accent">
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={!ok || busy}
          className="flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-csmju-label font-semibold text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          ส่งรายงาน
        </button>
      </div>
    </form>
  );
}

/// "เกี่ยวกับบัญชีนี้" — ข้อมูลจริงจาก GET /profiles/:id เท่าที่ระบบมี
/// (Instagram บอกประเทศและชื่อเดิมด้วย ระบบนี้ไม่เก็บสองอย่างนั้น จึงไม่แสดง)
export function AboutAccount({
  coreUserId,
  onClose,
}: {
  coreUserId: string;
  onClose: () => void;
}) {
  const profile = useProfile(coreUserId);
  const { data, isPending, isError } = useQuery({
    queryKey: ['profile-about', coreUserId],
    queryFn: () => api.get<ProfileDetail>(`/profiles/${encodeURIComponent(coreUserId)}`),
    staleTime: 60_000,
  });

  const joined = data?.joinedAt
    ? new Date(data.joinedAt).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      <header className="border-b border-border px-4 py-3 text-center">
        <h2 className="text-csmju-body font-bold">เกี่ยวกับบัญชีนี้</h2>
      </header>
      <div className="flex flex-col items-center gap-2 px-6 pb-5 pt-6 text-center">
        <Avatar coreUserId={coreUserId} size={80} showOnline={false} />
        <p className="mt-1 text-csmju-body font-semibold">{profile.displayName}</p>

        {isPending && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="กำลังโหลด" />}
        {isError && <p className="text-csmju-label text-destructive">โหลดข้อมูลบัญชีไม่สำเร็จ</p>}

        {data && (
          <dl className="mt-2 w-full space-y-3 text-left text-csmju-label">
            {joined && (
              <div>
                <dt className="font-semibold">วันที่เข้าร่วม</dt>
                <dd className="text-muted-foreground">เข้าร่วมเมื่อ {joined}</dd>
              </div>
            )}
            <div>
              <dt className="font-semibold">ผู้ติดตาม</dt>
              <dd className="text-muted-foreground">
                ผู้ติดตาม {data.stats.followerCount.toLocaleString('th-TH')} คน · กำลังติดตาม{' '}
                {data.stats.followingCount.toLocaleString('th-TH')} คน
              </dd>
            </div>
          </dl>
        )}
      </div>
      <SheetButton onClick={onClose}>ปิด</SheetButton>
    </>
  );
}
