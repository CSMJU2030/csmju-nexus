'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Smile, X } from 'lucide-react';
import { EmojiPopover } from '@/components/csmju/emoji-picker';
import { MenuItem, PopMenu } from '@/components/csmju/messages-menu';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Note, NoteAudience, PutNoteBody } from '@/lib/csmju/types';

/// แถว "โน้ต" เหนือรายการแชท แบบ Instagram Direct
///
/// โน้ต = ข้อความสั้น ≤ 60 ตัวอักษรที่ลอยเป็นฟองคำพูดเหนือรูปโปรไฟล์ อยู่ 24 ชั่วโมง
/// ช่องแรกเป็นของเราเสมอ (ยังไม่มีก็ขึ้นฟองว่าง "แชร์โน้ต…" ชวนให้กด) แล้วตามด้วย
/// โน้ตของคนที่เราติดตามและคนที่คุยด้วย — ทั้งหมดมาจาก `GET /notes` ไม่มีช่องตัวอย่าง

export const NOTES_KEY = ['notes'] as const;
export const NOTE_MAX = 60;

export function useNotes() {
  return useQuery({
    queryKey: NOTES_KEY,
    queryFn: () => api.get<Note[]>('/notes'),
    // โน้ตหมดอายุเองใน 24 ชั่วโมง — ดึงใหม่เป็นระยะให้ฟองที่หมดอายุหายไปเอง
    refetchInterval: 5 * 60_000,
  });
}

/// นับเป็นตัวอักษรที่คนเห็น ไม่ใช่หน่วย UTF-16 — "😂" ยาว 2 หน่วยแต่เป็นตัวเดียว
/// และสระ/วรรณยุกต์ไทยนับรวมกับพยัญชนะ ตรงกับที่ผู้ใช้นับเองด้วยตา
export function noteLength(text: string): number {
  return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].length;
}

export function NotesRow({
  onOpenChat,
  onEditMine,
}: {
  onOpenChat?: (coreUserId: string) => void;
  /// เปิดหน้า "โน้ตใหม่" (คอลัมน์ขวาของหน้าข้อความ)
  onEditMine: () => void;
}) {
  const me = useMe();
  const { data: notes = [] } = useNotes();

  const mine = notes.find((note) => note.isMe) ?? null;
  const others = notes.filter((note) => !note.isMe);

  return (
    <ul aria-label="โน้ต" className="flex gap-1 overflow-x-auto px-4 pb-2 pt-9 [scrollbar-width:none]">
      <li>
        <NoteBubble
          coreUserId={me.id}
          label="โน้ตของคุณ"
          text={mine?.text ?? null}
          placeholder="แชร์โน้ต…"
          onClick={onEditMine}
          actionLabel={mine ? 'แก้ไขหรือลบโน้ตของคุณ' : 'แชร์โน้ต'}
        />
      </li>

      {others.map((note) => (
        <li key={note.coreUserId}>
          <OtherNote
            note={note}
            onClick={onOpenChat ? () => onOpenChat(note.coreUserId) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

function OtherNote({ note, onClick }: { note: Note; onClick?: () => void }) {
  const profile = useProfile(note.coreUserId);

  return (
    <NoteBubble
      coreUserId={note.coreUserId}
      label={profile.displayName}
      text={note.text}
      onClick={onClick}
      actionLabel={`โน้ตของ ${profile.displayName}: ${note.text} — กดเพื่อส่งข้อความ`}
    />
  );
}

function NoteBubble({
  coreUserId,
  label,
  text,
  placeholder,
  onClick,
  actionLabel,
}: {
  coreUserId: string;
  label: string;
  text: string | null;
  placeholder?: string;
  onClick?: () => void;
  actionLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={actionLabel}
      className="flex w-[88px] flex-col items-center gap-1 rounded-xl py-1 text-center transition-opacity hover:opacity-90 disabled:cursor-default"
    >
      <span className="relative">
        <Avatar coreUserId={coreUserId} size={74} showOnline={false} />

        {/* ฟองคำพูดลอยเหนือหัว — จุดสองจุดข้างล่างคือหางของฟองแบบ IG */}
        <span className="absolute -top-8 left-1/2 w-max max-w-[96px] -translate-x-1/2">
          <span
            className={`block rounded-2xl bg-[var(--bubble-theirs)] px-2.5 py-1.5 text-[11px] leading-tight shadow-md line-clamp-2 ${
              text ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {text ?? placeholder}
          </span>
          <span aria-hidden className="absolute -bottom-1 left-4 size-2 rounded-full bg-[var(--bubble-theirs)]" />
          <span aria-hidden className="absolute -bottom-2.5 left-3 size-1 rounded-full bg-[var(--bubble-theirs)]" />
        </span>
      </span>

      <span className="block w-full truncate text-xs text-muted-foreground">{label}</span>
    </button>
  );
}

const AUDIENCE_LABEL: Record<NoteAudience, string> = {
  MUTUAL_FOLLOWERS: 'ผู้ติดตามที่คุณติดตามกลับ',
  CLOSE_FRIENDS: 'เพื่อนสนิท',
};

/// หน้า "โน้ตใหม่" แบบ IG — เต็มคอลัมน์ขวาบนจอกว้าง เต็มจอบนมือถือ
///
///   ✕                โน้ตใหม่                 แชร์
///                 ( แชร์ความคิด… )   ← ฟองความคิด พิมพ์ได้ 60 ตัว
///                       [รูปใหญ่]
///                          😊
///   แชร์กับผู้ติดตามที่คุณติดตามกลับ ⌄           ← ใครเห็นได้
///                        ลบโน้ต                ← ถ้ามีโน้ตอยู่แล้ว
export function NoteComposer({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const id = useId();
  const queryClient = useQueryClient();
  const { data: notes = [], isPending } = useNotes();
  const current = notes.find((note) => note.isMe) ?? null;

  if (isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 aria-label="กำลังโหลด" className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // key = โน้ตปัจจุบัน: ร่างเริ่มจากโน้ตที่มีอยู่ทุกครั้งที่เปิด
  return (
    <NoteForm
      key={current?.createdAt ?? 'new'}
      id={id}
      me={me.id}
      current={current}
      onClose={onClose}
      onSaved={(saved) =>
        queryClient.setQueryData<Note[]>(NOTES_KEY, (prev = []) =>
          saved
            ? [{ ...saved, isMe: true }, ...prev.filter((note) => !note.isMe)]
            : prev.filter((note) => !note.isMe),
        )
      }
    />
  );
}

function NoteForm({
  id,
  me,
  current,
  onClose,
  onSaved,
}: {
  id: string;
  me: string;
  current: Note | null;
  onClose: () => void;
  onSaved: (note: Note | null) => void;
}) {
  const [text, setText] = useState(current?.text ?? '');
  const [audience, setAudience] = useState<NoteAudience>(current?.audience ?? 'MUTUAL_FOLLOWERS');
  const [busy, setBusy] = useState<'share' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiRef = useRef<HTMLButtonElement | null>(null);
  const audienceRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);

  const trimmed = text.trim();
  const length = noteLength(trimmed);
  const valid = length >= 1 && length <= NOTE_MAX;

  async function share() {
    if (!valid) return;

    setBusy('share');
    setError(null);

    try {
      onSaved(
        await api.put<Note>('/notes/me', { text: trimmed, audience } satisfies PutNoteBody),
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'แชร์โน้ตไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);

    try {
      await api.del('/notes/me');
      onSaved(null);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบโน้ตไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void share();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !emojiOpen && !audienceOpen) onClose();
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col animate-in fade-in-0 duration-150"
    >
      <div className="relative flex h-[75px] shrink-0 items-center justify-center border-b border-border px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="absolute left-3 grid size-10 place-items-center rounded-full transition-colors hover:bg-accent"
        >
          <X aria-hidden className="size-6" strokeWidth={1.9} />
        </button>
        <h2 id={`${id}-title`} className="text-base font-bold">
          โน้ตใหม่
        </h2>
        <button
          type="submit"
          disabled={!valid || busy !== null}
          className="absolute right-4 flex items-center gap-1.5 text-sm font-semibold text-link disabled:opacity-40"
        >
          {busy === 'share' && <Loader2 aria-hidden className="size-4 animate-spin" />}
          แชร์
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-6 pt-32">
        <span className="relative">
          <Avatar coreUserId={me} size={150} showOnline={false} />

          {/* ฟองความคิดแบบ IG: ฟองใหญ่ + จุดเล็กสองจุดลงมาหาหัว */}
          <span className="absolute -top-24 left-1/2 w-[240px] -translate-x-1/2">
            <label htmlFor={`${id}-text`} className="sr-only">
              โน้ตของคุณ
            </label>
            <textarea
              id={`${id}-text`}
              ref={inputRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="แชร์ความคิด…"
              rows={2}
              className="block w-full resize-none rounded-3xl bg-[var(--bubble-theirs)] px-4 py-3 text-center text-[15px] leading-snug shadow-lg outline-none placeholder:text-muted-foreground"
            />
            <span aria-hidden className="absolute -bottom-2 left-[42%] size-4 rounded-full bg-[var(--bubble-theirs)] shadow" />
            <span aria-hidden className="absolute -bottom-5 left-[38%] size-2 rounded-full bg-[var(--bubble-theirs)]" />
          </span>
        </span>

        <p
          aria-live="polite"
          className={`mt-4 text-xs tabular-nums ${length > NOTE_MAX ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {length}/{NOTE_MAX}
        </p>

        <button
          ref={emojiRef}
          type="button"
          onClick={() => setEmojiOpen((open) => !open)}
          aria-label="ใส่อิโมจิ"
          aria-expanded={emojiOpen}
          className="mt-2 grid size-10 place-items-center rounded-full transition-colors hover:bg-accent"
        >
          <Smile aria-hidden className="size-6" strokeWidth={1.9} />
        </button>

        <EmojiPopover
          anchorRef={emojiRef}
          open={emojiOpen}
          variant="composer"
          onClose={() => {
            setEmojiOpen(false);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          onPick={(emoji) => setText((value) => value + emoji)}
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-auto flex flex-col items-center gap-4 pt-10">
          <button
            ref={audienceRef}
            type="button"
            onClick={() => setAudienceOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={audienceOpen}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            แชร์กับ{AUDIENCE_LABEL[audience]}
            <ChevronDown aria-hidden className="size-4" />
          </button>

          <PopMenu
            anchorRef={audienceRef}
            open={audienceOpen}
            onClose={() => setAudienceOpen(false)}
            label="ใครเห็นโน้ตนี้ได้"
            width={260}
          >
            {(Object.keys(AUDIENCE_LABEL) as NoteAudience[]).map((value) => (
              <MenuItem
                key={value}
                trailing
                icon={audience === value ? <Check className="size-4" strokeWidth={3} /> : undefined}
                onSelect={() => {
                  setAudience(value);
                  setAudienceOpen(false);
                }}
              >
                {AUDIENCE_LABEL[value]}
              </MenuItem>
            ))}
          </PopMenu>

          {current && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
              className="flex items-center gap-1.5 text-sm font-semibold text-destructive disabled:opacity-50"
            >
              {busy === 'delete' && <Loader2 aria-hidden className="size-4 animate-spin" />}
              ลบโน้ต
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
