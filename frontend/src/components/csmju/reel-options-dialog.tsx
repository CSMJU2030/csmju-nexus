'use client';

import { useState } from 'react';
import { FeedModal, SheetButton, SheetLink } from '@/components/csmju/feed-modal';
import { ApiError } from '@/lib/csmju/api';

/// เมนู "…" ของคลิป — รายการปุ่มเต็มความกว้างคั่นเส้นแบบ Instagram
///
/// **ปุ่มลบมีเฉพาะเจ้าของคลิปหรือ admin ระดับองค์กร** ตรงกับที่หลังบ้านยอม
/// (`ReelsService.remove`) — staff ลบคลิปคนอื่นไม่ได้ ถ้าโชว์ปุ่มให้ staff
/// เขาจะกดแล้วเจอ 403 ซึ่งแย่กว่าไม่เห็นปุ่มเลย
///
/// ลบต้องกดสองครั้ง เพราะกู้คืนไม่ได้ และปุ่มอยู่บนสุดของรายการพอดี
export function ReelOptionsDialog({
  open,
  onOpenChange,
  authorCoreUserId,
  canDelete,
  onDelete,
  onCopyLink,
  onShareTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authorCoreUserId: string;
  canDelete: boolean;
  onDelete: () => Promise<void>;
  onCopyLink: () => void;
  /// "แชร์ไปยัง…" — ปิดเมนูก่อนแล้วผู้เรียกเปิดแผ่นแชร์ (เปิดทีละชั้น)
  onShareTo: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;

    setConfirming(false);
    setError(null);
    onOpenChange(false);
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);

      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onDelete();
      setBusy(false);
      setConfirming(false);
      onOpenChange(false);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof ApiError ? caught.message : 'ลบคลิปไม่สำเร็จ');
    }
  }

  return (
    <FeedModal open={open} onClose={close} label="ตัวเลือกคลิป" className="max-w-sm">
      {canDelete && (
        <SheetButton tone="danger" onClick={() => void remove()} disabled={busy}>
          {confirming ? 'ยืนยันลบคลิป — กู้คืนไม่ได้' : 'ลบ'}
        </SheetButton>
      )}

      {error && (
        <p role="alert" className="px-4 pb-3 text-center text-csmju-caption text-destructive">
          {error}
        </p>
      )}

      <SheetLink href={`/profile/${encodeURIComponent(authorCoreUserId)}`} onClick={close}>
        ไปที่บัญชี
      </SheetLink>
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
          onCopyLink();
          close();
        }}
      >
        คัดลอกลิงก์
      </SheetButton>
      <SheetButton onClick={close}>ยกเลิก</SheetButton>
    </FeedModal>
  );
}
