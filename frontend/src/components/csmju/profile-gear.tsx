'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { CORE_HOME } from '@/components/csmju/profile-settings-form';
import { useNotes } from '@/components/csmju/messages-notes';
import { useSignOut } from '@/lib/csmju/session';

/// ปุ่มฟันเฟืองข้างชื่อบนโปรไฟล์ตัวเอง — กล่องตัวเลือกแบบ Instagram
///
/// มีเฉพาะที่ระบบนี้ทำได้จริง · ไม่มี "คิวอาร์โค้ด" (ต้องใช้ไลบรารีที่ whitelist
/// ของมาตรฐาน 1.0.0 ไม่อนุญาต) · "แอพและเว็บไซต์" · "บัญชีมืออาชีพ" ·
/// "การควบคุมดูแล" เพราะไม่มีฟีเจอร์รองรับ · "กิจกรรมการเข้าสู่ระบบ" เป็นของ
/// บัญชีกลาง จึงเป็นลิงก์ออกไปที่นั่น และขึ้นเฉพาะเมื่อรู้ที่อยู่ของบัญชีกลาง

const ROW =
  'flex min-h-12 w-full items-center justify-center border-t border-border px-4 text-csmju-label transition-colors first:border-t-0 hover:bg-accent';

export function ProfileGear() {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ตัวเลือก"
        aria-haspopup="dialog"
        title="ตัวเลือก"
        className="grid size-9 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
      >
        <Settings aria-hidden strokeWidth={1.9} className="size-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
          <DialogTitle className="sr-only">ตัวเลือก</DialogTitle>
          <DialogDescription className="sr-only">การแจ้งเตือน การตั้งค่า และการออกจากระบบ</DialogDescription>
          <div>
            <Link href="/settings/notifications" onClick={() => setOpen(false)} className={ROW}>
              การแจ้งเตือน
            </Link>
            <Link href="/settings" onClick={() => setOpen(false)} className={ROW}>
              การตั้งค่าและความเป็นส่วนตัว
            </Link>
            {CORE_HOME && (
              <a href={CORE_HOME} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={ROW}>
                กิจกรรมการเข้าสู่ระบบ
              </a>
            )}
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut().finally(() => setSigningOut(false));
              }}
              className={`${ROW} disabled:opacity-60`}
            >
              {signingOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={ROW}>
              ยกเลิก
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/// ฟองโน้ตมุมซ้ายบนของรูปโปรไฟล์ตัวเอง — ข้อความจาก `GET /notes` (ของฉันอยู่แรกสุด)
///
/// ยังไม่มีโน้ต = ฟองชวน "แชร์โน้ต…" แบบ Instagram · กดแล้วไปเขียนโน้ตที่หน้าข้อความ
/// (หน้าข้อความเปิดช่องเขียนโน้ตเองเมื่อเห็น `?note=1`)
export function ProfileNoteBubble() {
  const { data } = useNotes();
  // หลังบ้านกรองโน้ตที่หมดอายุออกแล้ว และ useNotes ดึงใหม่ทุก 5 นาที
  const mine = data?.find((note) => note.isMe);

  if (!data) return null;

  return (
    <Link
      href="/messages?note=1"
      aria-label={mine ? `โน้ตของคุณ: ${mine.text} — แก้ไขโน้ต` : 'แชร์โน้ต'}
      className="absolute -top-3 left-0 z-10 max-w-[120px] -translate-x-1/4 animate-in fade-in-0 zoom-in-95 md:-top-4 md:left-2 md:max-w-[150px] md:translate-x-0"
    >
      <span
        className={`relative block rounded-2xl bg-card px-3 py-1.5 text-center text-csmju-caption leading-snug shadow-[var(--elevation-sm)] ${
          mine ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        <span className="line-clamp-2 break-words">{mine ? mine.text : 'แชร์โน้ต…'}</span>
        {/* หางฟองคำพูดสองจุดแบบ Instagram */}
        <span aria-hidden className="absolute -bottom-1.5 left-4 size-2.5 rounded-full bg-card" />
        <span aria-hidden className="absolute -bottom-3 left-2.5 size-1.5 rounded-full bg-card" />
      </span>
    </Link>
  );
}
