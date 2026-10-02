'use client';

import { useId, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { useMe, useSignOut } from '@/lib/csmju/session';

/// กล่องที่เด้งจากเมนู ≡ และจากชื่อบัญชีในหน้าข้อความ แบบ Instagram
///
/// **สลับบัญชีไม่มีช่องรหัสผ่าน** ต่างจาก Instagram โดยตั้งใจ — ระบบย่อยของ
/// CSMJU2030 ห้ามรับรหัสผ่านเอง (auth-contract.md ข้อห้าม 9.1–9.2) ทางเดียวที่
/// ถูกต้องคือออกจากระบบแล้วไปเข้าสู่ระบบที่ Core Hub ด้วยบัญชีอื่น
///
/// standards 1.7.0: `signOut()` ส่งฟอร์ม POST ไป /auth/logout ซึ่งพาไปหน้า
/// /logout ของ Core Hub — ออกจาก Core Hub แล้วผู้ใช้เข้าสู่ระบบด้วยบัญชีอื่นที่นั่นได้เลย

export function SwitchAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const profile = useProfile(me.id);
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchAccount() {
    setBusy(true);
    setError(null);

    try {
      // เปลี่ยนทั้งหน้าไป /auth/logout → /logout ของ Core Hub (ปุ่มค้างสถานะกำลังทำจนหน้าเปลี่ยน)
      await signOut();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'สลับบัญชีไม่สำเร็จ');
      setBusy(false);
    }
  }

  const name = profile.displayName === me.id ? me.email.split('@')[0] : profile.displayName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[25rem]">
        <DialogHeader>
          <DialogTitle className="border-b border-border px-6 py-4 text-center text-base">
            สลับบัญชี
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="sr-only">
          ออกจากบัญชีนี้แล้วเข้าสู่ระบบด้วยบัญชีอื่นที่ศูนย์กลาง CSMJU2030
        </DialogDescription>

        <div className="flex items-center gap-3 px-6 py-4">
          <Avatar coreUserId={me.id} size={56} showOnline={false} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-semibold">{name}</span>
            <span className="block truncate text-sm text-muted-foreground">{me.email}</span>
          </span>
          <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check aria-hidden className="size-4" strokeWidth={3} />
          </span>
        </div>

        {error && (
          <p role="alert" className="mx-6 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => void switchAccount()}
            disabled={busy}
            className="flex h-12 w-full items-center justify-center gap-2 text-sm font-semibold text-link transition-colors hover:bg-accent disabled:opacity-60"
          >
            {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
            เข้าสู่ระบบด้วยบัญชีอื่น
          </button>
        </div>

        <p className="px-6 pb-5 text-center text-xs leading-relaxed text-muted-foreground">
          รหัสผ่านและบัญชีทั้งหมดอยู่ที่ศูนย์กลาง CSMJU2030 — ระบบนี้ไม่ได้เก็บรหัสผ่านของคุณ
        </p>
      </DialogContent>
    </Dialog>
  );
}

/// รายงานปัญหาของระบบ — ส่งเข้าคิวรายงานเดียวกับที่ผู้ดูแลตรวจอยู่แล้ว
export function ReportProblemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = text.trim().length >= 10;

  async function send() {
    if (!valid) return;

    setBusy(true);
    setError(null);

    try {
      await api.post('/reports', {
        targetKind: 'SYSTEM',
        targetId: 'app',
        reason: `${text.trim()}\n\n— หน้า: ${window.location.pathname} · ${navigator.userAgent}`,
      });
      setDone(true);
      setText('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งรายงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setDone(false);
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-[33rem]">
        <DialogHeader>
          <DialogTitle className="border-b border-border px-6 py-4 text-center text-base">
            รายงานปัญหา
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="px-6 py-8 text-center">
            <p className="font-semibold">ขอบคุณที่แจ้งให้เราทราบ</p>
            <p className="mt-1 text-sm text-muted-foreground">
              ผู้ดูแลระบบจะเห็นรายงานนี้ในแผงผู้ดูแล
            </p>
          </div>
        ) : (
          <form
            className="space-y-3 px-6 pb-6 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <DialogDescription className="text-sm text-muted-foreground">
              อธิบายสิ่งที่เกิดขึ้น และสิ่งที่คุณคาดว่าควรเกิด — ระบบแนบหน้าที่เปิดอยู่และเบราว์เซอร์ให้เอง
            </DialogDescription>

            <label htmlFor={`${id}-text`} className="sr-only">
              รายละเอียดปัญหา
            </label>
            <textarea
              id={`${id}-text`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="โปรดใส่รายละเอียดให้ได้มากที่สุด…"
              className="w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!valid || busy}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
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
