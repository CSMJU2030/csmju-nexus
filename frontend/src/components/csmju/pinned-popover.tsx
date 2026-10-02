'use client';

import { Pin, X } from 'lucide-react';
import { AttachmentList } from '@/components/csmju/attachment-list';
import { RoomPopover, type PopoverAnchor } from '@/components/csmju/room-popover';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { stampLabel } from '@/app/(app)/chat/chat-logic';
import type { Message } from '@/lib/csmju/types';

/// "ข้อความที่ปักหมุด" แบบ Discord — ป๊อปอัพจากไอคอนหมุดบนหัวห้อง
///
/// รายการมาจากหน้าห้อง (ซึ่งฟัง `message:pinned` อยู่แล้ว) จึงอัปเดตสดโดยไม่ต้องยิงซ้ำ
export function PinnedPopover({
  open,
  onClose,
  anchor,
  pinned,
  loading,
  canPin,
  onJump,
  onUnpin,
}: {
  open: boolean;
  onClose: () => void;
  anchor: PopoverAnchor;
  pinned: Message[];
  loading: boolean;
  canPin: boolean;
  onJump: (message: Message) => void;
  onUnpin: (message: Message) => void;
}) {
  const now = new Date();

  return (
    <RoomPopover open={open} onClose={onClose} anchor={anchor} width={420} label="ข้อความที่ปักหมุด">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Pin className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">ข้อความที่ปักหมุด</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : pinned.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <span className="mb-3 grid size-16 place-items-center rounded-full bg-muted">
              <Pin className="size-7 text-muted-foreground" aria-hidden />
            </span>
            <p className="text-sm">ช่องนี้ยังไม่มีข้อความปักไว้เลย</p>
            <p className="mt-4 rounded-md bg-muted/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-success">เคล็ดลับ:</strong>{' '}
              {canPin
                ? 'ชี้ที่ข้อความ กด ⋯ แล้วเลือก “ปักหมุดข้อความ” เพื่อเก็บข้อความสำคัญไว้ที่นี่'
                : 'ผู้ดูแลห้องปักหมุดข้อความสำคัญไว้ที่นี่ ให้ทุกคนกลับมาอ่านได้ง่าย'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2 p-3">
            {pinned.map((message) => (
              <li key={message.id}>
                <PinnedCard
                  message={message}
                  now={now}
                  canPin={canPin}
                  onJump={() => {
                    onJump(message);
                    onClose();
                  }}
                  onUnpin={() => onUnpin(message)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </RoomPopover>
  );
}

function PinnedCard({
  message,
  now,
  canPin,
  onJump,
  onUnpin,
}: {
  message: Message;
  now: Date;
  canPin: boolean;
  onJump: () => void;
  onUnpin: () => void;
}) {
  const author = useProfile(message.authorCoreUserId);

  return (
    <div className="group/pin relative rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-2.5">
        <Avatar coreUserId={message.authorCoreUserId} size={32} showOnline={false} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold">{author.displayName}</span>
            <span className="text-[11px] text-muted-foreground">{stampLabel(message.createdAt, now)}</span>
          </p>
          {message.content && (
            <p className="whitespace-pre-wrap break-words text-sm leading-snug">{message.content}</p>
          )}
          <AttachmentList attachments={message.attachments} />
        </div>
      </div>

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/pin:opacity-100">
        <button
          type="button"
          onClick={onJump}
          className="rounded bg-muted px-2 py-0.5 text-xs font-medium hover:bg-accent"
        >
          ไปที่ข้อความ
        </button>
        {canPin && (
          <button
            type="button"
            onClick={onUnpin}
            aria-label="ถอนหมุด"
            className="grid size-6 place-items-center rounded bg-muted text-muted-foreground hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
