'use client';

import { useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { useMe, useSignOut } from '@/lib/csmju/session';

/// ป้ายบอกว่ากำลังใช้งานในนามใคร + ทางออกจากระบบ
///
/// แทนที่ `IdentitySwitcher` เดิมที่ให้เลือกว่า "จะสวมบทเป็นใคร" จากรายชื่อ
/// ที่ฮาร์ดโค้ดไว้ — ของแบบนั้นทำให้ทดสอบหน้าจอหลายผู้ใช้ได้ แต่มันไม่ใช่
/// การยืนยันตัวตน และถ้าหลุดขึ้น production คือช่องโหว่ที่ร้ายแรงที่สุดเท่าที่
/// ระบบหนึ่งจะมีได้
///
/// ตอนนี้เปลี่ยนตัวตนได้ทางเดียวคือออกจากระบบแล้วล็อกอินใหม่ที่ Core Hub

const ROLE_LABEL: Record<string, string> = {
  student: 'นักศึกษา',
  alumni: 'ศิษย์เก่า',
  staff: 'บุคลากร',
  admin: 'ผู้ดูแลระบบ',
};

/// สิทธิ์ในระบบย่อยนี้ — สีบอกระดับโดยไม่ต้องอ่านคำ
const ROLE_TONE: Record<string, string> = {
  ADMIN: 'bg-primary/12 text-primary',
  EDITOR: 'bg-success/12 text-success',
  GUEST: 'bg-muted text-muted-foreground',
};

export function SessionCard() {
  const me = useMe();
  const signOut = useSignOut();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  // ตัวอักษรแรกของอีเมลใช้เป็นรูปแทนตัว ระหว่างที่ Core Hub ยังไม่เปิดให้
  // ดึงรูปโปรไฟล์จริง (คำขอ endpoint ข้อมูลโปรไฟล์ที่ยื่น PM ไว้แล้ว)
  const initial = me.email.trim().charAt(0).toUpperCase() || '?';

  const leave = async () => {
    setLeaving(true);
    setError('');

    try {
      // สำเร็จแล้วการ์ดนี้ถูกถอดออกจากหน้าจอทันที ไม่ต้องคืนสถานะปุ่ม
      await signOut();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'ออกจากระบบไม่สำเร็จ',
      );
      setLeaving(false);
    }
  };

  return (
    <div className="csmju-surface px-2.5 py-2.5 shadow-csmju-xs">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="csmju-brand grid size-8 shrink-0 place-items-center rounded-lg text-csmju-label font-semibold"
        >
          {initial}
        </span>

        <span className="min-w-0 flex-1 leading-tight">
          <span
            className="block truncate text-csmju-label font-medium"
            title={me.email}
          >
            {me.email}
          </span>
          <span className="block truncate text-csmju-caption text-muted-foreground">
            {ROLE_LABEL[me.coreRole] ?? me.coreRole}
          </span>
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-md px-1.5 py-0.5 text-csmju-caption font-medium ${
            ROLE_TONE[me.subsystemRole] ?? ROLE_TONE.GUEST
          }`}
        >
          {me.subsystemRole}
        </span>

        <button
          type="button"
          onClick={() => void leave()}
          disabled={leaving}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-csmju-caption text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
        >
          {leaving ? (
            <Loader2 aria-hidden className="size-3 animate-spin" />
          ) : (
            <LogOut aria-hidden className="size-3" />
          )}
          {leaving ? 'กำลังออก…' : 'ออกจากระบบ'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-csmju-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
