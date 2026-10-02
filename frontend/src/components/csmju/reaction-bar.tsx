'use client';

import { useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { EMOJI_FONT, EmojiPopover } from '@/components/csmju/emoji-picker';
import { api, qs } from '@/lib/csmju/api';
import type { ReactionSummary, ReactionTarget } from '@/lib/csmju/types';

/// แถบอิโมจิ — ใช้ได้ทั้งกระทู้ คลิป และข้อความแชท
///
/// ปุ่ม + เปิดแผงอิโมจิชุดเต็มแบบ Instagram (เริ่มที่ "ได้รับความนิยมสูงสุด")
/// หลังบ้านรับอิโมจิมาตรฐานได้ทุกตัว (RGI) จึงไม่ต้องจำกัดรายการที่หน้าบ้านอีก
///
/// อัปเดตแบบ optimistic ไม่ทำ เพราะยอดที่หลังบ้านคืนมาเป็นชุดสมบูรณ์อยู่แล้ว
/// (รวมทั้งของคนอื่นที่กดพร้อมกัน) การเดาเองแล้วค่อยแก้จะทำให้เลขกระพริบ
/// ชื่อของแต่ละอิโมจิสำหรับโปรแกรมอ่านหน้าจอ
///
/// ปุ่มที่มีแต่ `<span aria-hidden>{emoji}</span>` ข้างใน = ปุ่มที่ไม่มีชื่อเลย
/// โปรแกรมอ่านหน้าจอจะอ่านว่า "ปุ่ม" เฉย ๆ ทั้งแถว ผู้ใช้จึงเลือกไม่ถูกว่า
/// อันไหนคืออันไหน
const EMOJI_LABEL: Record<string, string> = {
  '👍': 'ถูกใจ',
  '❤️': 'หัวใจ',
  '😂': 'ขำ',
  '😮': 'ประหลาดใจ',
  '😢': 'เศร้า',
  '😠': 'ไม่พอใจ',
  '🎉': 'ยินดี',
  '🔥': 'เจ๋ง',
  '🙏': 'ขอบคุณ',
  '✅': 'เรียบร้อย',
  '❓': 'สงสัย',
  '💡': 'ไอเดีย',
};

function emojiLabel(emoji: string): string {
  return EMOJI_LABEL[emoji] ?? emoji;
}

export function ReactionBar({
  targetKind,
  targetId,
  summary,
  onChange,
}: {
  targetKind: ReactionTarget;
  targetId: string;
  summary: ReactionSummary | null;
  onChange: (next: ReactionSummary) => void;
  /// เดิมมี `compact` ไว้สั่งให้แผงอิโมจิพลิกขึ้นบน — ไม่ต้องแล้ว
  /// เพราะตอนนี้ดูที่ว่างจริงบนหน้าจอเอง
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  async function toggle(emoji: string, mine: boolean) {
    setBusy(true);
    setError(null);

    try {
      const query = qs({
        targetKind: targetKind,
        targetId: targetId,
        emoji,
      });

      const next = mine
        ? await api.del<ReactionSummary>(`/reactions${query}`)
        : await api.post<ReactionSummary>('/reactions', {
            targetKind: targetKind,
            targetId: targetId,
            emoji,
          });

      onChange(next);
      setPicking(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'กดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const totals = summary?.totals ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {totals.map((row) => (
        <button
          key={row.emoji}
          type="button"
          disabled={busy}
          onClick={() => void toggle(row.emoji, row.reactedByMe)}
          title={row.reactedByMe ? 'กดอีกครั้งเพื่อถอน' : 'กดเพื่อรีแอ็กชัน'}
          className={`relative flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
            row.reactedByMe
              ? 'border-primary bg-secondary text-secondary-foreground'
              : 'border-border hover:bg-accent'
          }`}
        >
          <span aria-hidden style={{ fontFamily: EMOJI_FONT }}>
            {row.emoji}
          </span>
          <span className="font-medium tabular-nums">{row.count}</span>
          <span className="sr-only">
            {emojiLabel(row.emoji)} {row.count} คน
            {row.reactedByMe ? ' · คุณกดแล้ว' : ''}
          </span>
        </button>
      ))}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPicking((open) => !open)}
        aria-expanded={picking}
        className="grid size-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent"
        aria-label="เพิ่มรีแอ็กชัน"
      >
        <SmilePlus className="size-3.5" />
      </button>

      {/* แผงชุดเต็มลอยผ่าน portal — พ้นกรอบเลื่อนของห้องแชท พลิกขึ้น/ลงตามที่ว่างจริง */}
      <EmojiPopover
        anchorRef={triggerRef}
        open={picking}
        onClose={() => setPicking(false)}
        variant="reaction"
        closeOnPick
        onPick={(emoji) =>
          void toggle(emoji, totals.find((t) => t.emoji === emoji)?.reactedByMe ?? false)
        }
      />

      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
