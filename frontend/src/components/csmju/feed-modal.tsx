'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { cn } from '@/lib/utils';

/// กล่องลอยแบบ Instagram ของฟีด/คลิป/สตอรี่ — วาดผ่าน portal ที่ body
///
/// ทำไมไม่ใช้ `<Dialog>` (`<dialog>` ของเบราว์เซอร์): กล่องพวกนี้ถูกเปิดจากใน
/// ตัวเล่นสตอรี่และแผงความคิดเห็นที่กักโฟกัสเองอยู่แล้ว `<dialog>` ขึ้นไปอยู่
/// top layer นอก DOM ของตัวเปิด ตัวกักโฟกัสเดิมจะดึงโฟกัสกลับทุกครั้งที่กด Tab
/// — ที่นี่จึงใช้ portal + useModalFocus (Esc ปิด · กัก Tab · คืนโฟกัสตอนปิด)
///
/// **เปิดทีละชั้น** ผู้เรียกสลับเนื้อหาในกล่องเดียว (เมนู → ยืนยัน → เกี่ยวกับบัญชี)
/// แทนการซ้อนกล่อง เพราะ useModalFocus ทุกชั้นฟัง Esc พร้อมกัน ซ้อนแล้วปิดหมด
export function FeedModal({
  open,
  onClose,
  label,
  children,
  className,
  sheetOnMobile = false,
}: {
  open: boolean;
  onClose: () => void;
  /// ชื่อกล่องสำหรับโปรแกรมอ่านหน้าจอ
  label: string;
  children: ReactNode;
  className?: string;
  /// มือถือ: เลื่อนขึ้นจากล่างแบบแผ่น (แผ่นแชร์) แทนการ์ดกลางจอ
  sheetOnMobile?: boolean;
}) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <ModalBody onClose={onClose} label={label} className={className} sheetOnMobile={sheetOnMobile}>
      {children}
    </ModalBody>,
    document.body,
  );
}

function ModalBody({
  onClose,
  label,
  children,
  className,
  sheetOnMobile,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  sheetOnMobile: boolean;
}) {
  const ref = useModalFocus<HTMLDivElement>(true, onClose);

  return (
    <div
      className={cn(
        'fixed inset-0 z-100 flex justify-center bg-black/60 animate-in fade-in-0',
        sheetOnMobile ? 'items-end sm:items-center sm:p-4' : 'items-center p-4',
      )}
      // คลิกฉากหลัง (ไม่ใช่ตัวกล่อง) = ปิด
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh-2rem)] w-full max-w-100 flex-col overflow-hidden bg-card text-card-foreground shadow-xl outline-none',
          'animate-in fade-in-0 zoom-in-95 duration-150',
          sheetOnMobile
            ? 'max-sm:max-h-[85dvh] max-sm:max-w-none max-sm:rounded-t-2xl max-sm:slide-in-from-bottom-8 sm:rounded-xl'
            : 'rounded-xl',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/// แถวปุ่มเต็มความกว้างคั่นเส้นของเมนูแบบ Instagram (รายงาน · ไปยังโพสต์ · ยกเลิก)
export function SheetButton({
  children,
  onClick,
  tone,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'danger' | 'strong';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'block w-full border-t border-border px-4 py-3.5 text-center text-csmju-label transition-colors first:border-t-0 hover:bg-accent disabled:opacity-50',
        tone === 'danger' && 'font-bold text-destructive',
        tone === 'strong' && 'font-bold',
      )}
    >
      {children}
    </button>
  );
}

/// แถวแบบเดียวกับ SheetButton แต่เป็นลิงก์จริง (ไปยังโพสต์ · ไปที่บัญชี) —
/// เปิดแท็บใหม่/คัดลอกลิงก์ด้วยคลิกขวาได้ แบบลิงก์ทั่วไป
export function SheetLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block w-full border-t border-border px-4 py-3.5 text-center text-csmju-label transition-colors first:border-t-0 hover:bg-accent"
    >
      {children}
    </Link>
  );
}
