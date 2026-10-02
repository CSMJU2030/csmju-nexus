'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/csmju/api';
import type { ReelComment } from '@/lib/csmju/types';

/// เมนู ⋯ ของความคิดเห็น — "ลบ" แล้วต้องยืนยันอีกครั้ง
///
/// ใช้ Dialog ที่เป็น `<dialog>` ของเบราว์เซอร์ จึงได้ top layer (ลอยเหนือแผง
/// ความคิดเห็นที่เป็น portal), กัก Tab, Esc ปิด และคืนโฟกัสปุ่ม ⋯ ให้ฟรี
///
/// ต้นเรื่องที่มีคำตอบต้องบอกก่อนว่าคำตอบจะหายไปด้วย — หลังบ้านลบให้พร้อมกัน
export function ReelCommentMenu({
  comment,
  onClose,
  onDelete,
}: {
  comment: ReelComment | null;
  onClose: () => void;
  onDelete: (comment: ReelComment) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;

    setConfirming(false);
    setError(null);
    onClose();
  }

  async function remove() {
    if (!comment) return;

    setBusy(true);
    setError(null);

    try {
      await onDelete(comment);
      setBusy(false);
      setConfirming(false);
      onClose();
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof ApiError ? caught.message : 'ลบความคิดเห็นไม่สำเร็จ');
    }
  }

  const row =
    'block w-full border-t border-border px-4 py-3.5 text-center text-csmju-label transition-colors hover:bg-accent disabled:opacity-50';

  return (
    <Dialog open={comment !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="max-w-sm rounded-xl">
        {confirming ? (
          <>
            <div className="px-6 pb-4 pt-7 text-center">
              <DialogTitle className="text-csmju-body font-semibold">ลบความคิดเห็นใช่ไหม</DialogTitle>
              <p className="mt-1.5 text-csmju-label text-muted-foreground">
                {comment && comment.replyCount > 0
                  ? `ข้อความตอบกลับ ${comment.replyCount} รายการจะถูกลบไปด้วย และกู้คืนไม่ได้`
                  : 'ลบแล้วกู้คืนไม่ได้'}
              </p>
            </div>
            {error && (
              <p role="alert" className="px-4 pb-3 text-center text-csmju-caption text-destructive">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className={`${row} font-bold text-destructive`}
            >
              ลบ
            </button>
            <button type="button" onClick={close} disabled={busy} className={row}>
              ยกเลิก
            </button>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">ตัวเลือกความคิดเห็น</DialogTitle>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={`${row} border-t-0 font-bold text-destructive`}
            >
              ลบ
            </button>
            <button type="button" onClick={close} className={row}>
              ยกเลิก
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
