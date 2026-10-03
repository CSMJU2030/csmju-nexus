'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  Heart,
  Image as ImageIcon,
  Loader2,
  Mic,
  Smile,
  Sticker,
  X,
} from 'lucide-react';
import {
  AttachmentButton,
  AttachmentTray,
  useAttachments,
} from '@/components/csmju/attachment-picker';
import { messagePreview } from '@/components/csmju/direct-message';
import { StickerPopover } from '@/components/csmju/direct-stickers';
import {
  canRecordVoice,
  RecordingBar,
  useVoiceRecorder,
  type VoiceClip,
} from '@/components/csmju/direct-voice';
import { EmojiPopover } from '@/components/csmju/emoji-picker';
import { useAssetUrl } from '@/lib/csmju/asset-url';
import type { Message } from '@/lib/csmju/types';

/// ช่องพิมพ์ของบทสนทนาแบบ Instagram Direct
///
///   [😊] [ช่องพิมพ์…] [🎤] [📎] [🖼] [สติกเกอร์] [♥]   ← ยังไม่พิมพ์
///   [😊] [ช่องพิมพ์…] [ส่ง]                           ← มีข้อความหรือไฟล์
///
/// แถบเหนือช่องพิมพ์ขึ้นตามสถานะ: "กำลังตอบกลับ …" / "กำลังแก้ไขข้อความ"
/// (✕ หรือ Esc ยกเลิก) · ระหว่างอัดเสียงทั้งแถบกลายเป็นแถบอัดเสียง

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

export interface ReplyTarget {
  message: Message;
  /// "ตัวคุณเอง" เมื่อตอบข้อความของตัวเอง
  name: string;
}

export function Composer({
  dock,
  attachments,
  error,
  status,
  editing,
  reply,
  onTyping,
  onSend,
  onSendVoice,
  onSendGif,
  onSaveEdit,
  onCancelEdit,
  onCancelReply,
}: {
  dock: boolean;
  attachments: ReturnType<typeof useAttachments>;
  error: string | null;
  status: ConnectionStatus;
  /// ข้อความที่กำลังแก้ — ช่องพิมพ์ถูกเติมด้วยข้อความเดิม และปุ่มส่งกลายเป็น ✓
  editing: Message | null;
  reply: ReplyTarget | null;
  onTyping: () => void;
  onSend: (content: string) => Promise<boolean>;
  onSendVoice: (clip: VoiceClip) => Promise<boolean>;
  onSendGif: (file: File) => Promise<boolean>;
  onSaveEdit: (content: string) => Promise<boolean>;
  onCancelEdit: () => void;
  onCancelReply: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // เบราว์เซอร์ที่อัดเสียงไม่ได้ (หรือไม่มี getUserMedia เพราะไม่ใช่ https) = ไม่มีปุ่มไมค์
  const [voiceSupported] = useState(canRecordVoice);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiRef = useRef<HTMLButtonElement | null>(null);
  const stickerRef = useRef<HTMLButtonElement | null>(null);
  /// ตำแหน่งเคอร์เซอร์ล่าสุด — แผงอิโมจิมีช่องค้นหาของมันเอง พอโฟกัสย้ายไปที่นั่น
  /// selectionStart ของช่องพิมพ์ยังอยู่ แต่อ่านตอนนั้นไม่ได้แน่นอนทุกเบราว์เซอร์ จึงจำไว้เอง
  const selectionRef = useRef({ start: 0, end: 0 });
  // หน้าข้อความกับหน้าต่างแชทลอยเปิดพร้อมกันได้ — id ตายตัวจะชนกัน
  const inputId = useId();

  // เริ่มแก้ข้อความ → เติมข้อความเดิมลงช่อง (ปรับ state ระหว่างวาดเมื่อ prop
  // เปลี่ยน ตามแบบที่ React แนะนำ ไม่ใช่ effect ที่ทำให้จอกะพริบหนึ่งเฟรม)
  const [editingId, setEditingId] = useState<string | null>(null);

  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    setDraft(editing ? (editing.content ?? '') : '');
  }

  // ตอบกลับ/แก้ไข = ผู้ใช้กำลังจะพิมพ์ → โฟกัสช่องพิมพ์ให้เลย แล้วยืดตามข้อความเดิม
  useEffect(() => {
    if (!editing && !reply) return;

    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;

      if (!input) return;

      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      fit();
    });

    return () => cancelAnimationFrame(frame);
  }, [editing, reply]);

  const hasContent = draft.trim() !== '' || (!editing && attachments.assets.length > 0);

  async function deliverVoice(clip: VoiceClip | null) {
    if (!clip) return;

    setBusy('กำลังส่งข้อความเสียง…');
    await onSendVoice(clip);
    setBusy(null);
  }

  const recorder = useVoiceRecorder((clip) => void deliverVoice(clip));

  /// ช่องพิมพ์ยืดตามจำนวนบรรทัด (สูงสุดราวห้าบรรทัด) แล้วค่อยเลื่อนในตัว
  function fit() {
    const input = inputRef.current;

    if (!input) return;

    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function remember() {
    const input = inputRef.current;

    if (input) {
      selectionRef.current = { start: input.selectionStart, end: input.selectionEnd };
    }
  }

  async function submit(text = draft.trim()) {
    if (editing) {
      // ลบข้อความทั้งหมดตอนแก้ ≠ ลบข้อความ — ให้ใช้ "ยกเลิกการส่ง" แทน
      if (!text || text === editing.content?.trim()) {
        if (!text) return;

        onCancelEdit();

        return;
      }

      const ok = await onSaveEdit(text);

      if (ok) setDraft('');

      return;
    }

    if (!text && attachments.assets.length === 0) return;

    setDraft('');
    setEmojiOpen(false);
    selectionRef.current = { start: 0, end: 0 };
    requestAnimationFrame(fit);

    const ok = await onSend(text);

    // ส่งไม่สำเร็จ → คืนร่างเดิม ผู้ใช้ไม่ต้องพิมพ์ใหม่
    if (!ok && text) {
      setDraft(text);
      requestAnimationFrame(fit);
    }
  }

  function insertEmoji(emoji: string) {
    const { start, end } = selectionRef.current;
    const safeStart = Math.min(start, draft.length);
    const safeEnd = Math.min(Math.max(end, safeStart), draft.length);

    setDraft(draft.slice(0, safeStart) + emoji + draft.slice(safeEnd));
    // เลือกหลายตัวติดกันต้องต่อท้ายกันไป ไม่ใช่แทรกที่เดิมซ้ำ
    selectionRef.current = { start: safeStart + emoji.length, end: safeStart + emoji.length };
    requestAnimationFrame(fit);
  }

  /// ไมค์: กดค้าง = อัดจนปล่อยแล้วส่ง · แตะ = อัดค้างไว้ให้กด "ส่ง"/"ยกเลิก" เอง
  function startVoice() {
    const pressedAt = Date.now();

    const release = () => {
      // ค้างเกิน 0.4 วินาที = ตั้งใจกดค้าง → ปล่อยแล้วส่ง
      if (Date.now() - pressedAt > 400) {
        void recorder.stop(true).then(deliverVoice);
      }
    };

    window.addEventListener('pointerup', release, { once: true });
    void recorder.start();
  }

  const padding = dock ? 'px-3 pb-3 pt-1' : 'px-4 pb-5 pt-2';

  if (recorder.recording || busy) {
    return (
      <div className={`shrink-0 ${padding}`}>
        <div className="flex min-h-11 items-center rounded-[22px] border border-border px-2 py-[3px]">
          {busy ? (
            <p className="flex h-9 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {busy}
            </p>
          ) : (
            <RecordingBar
              elapsed={recorder.elapsed}
              levels={recorder.levels}
              onCancel={() => void recorder.stop(false)}
              onSend={() => void recorder.stop(true).then(deliverVoice)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`shrink-0 ${padding}`}>
      {(error || recorder.error) && (
        <p role="alert" className="mb-1.5 px-2 text-xs text-destructive">
          {error ?? recorder.error}
        </p>
      )}

      {status === 'offline' && !error && (
        <p className="mb-1.5 px-2 text-[11px] text-muted-foreground">
          ไม่ได้เชื่อมต่อสด — ข้อความยังส่งได้ แต่ข้อความใหม่จะเข้ามาเมื่อเปิดใหม่
        </p>
      )}

      {editing && (
        <ContextBar label="กำลังแก้ไขข้อความ" onCancel={onCancelEdit} cancelLabel="ยกเลิกการแก้ไข" />
      )}

      {!editing && reply && (
        <ContextBar
          label={`กำลังตอบกลับ ${reply.name}`}
          preview={messagePreview(reply.message)}
          thumbnailId={
            reply.message.attachments.find((file) => file.kind === 'IMAGE')?.id ?? null
          }
          onCancel={onCancelReply}
          cancelLabel="ยกเลิกการตอบกลับ"
        />
      )}

      {!editing && <AttachmentTray attachments={attachments} />}

      <div className="relative flex min-h-11 items-end gap-1 rounded-[22px] border border-border px-2 py-[3px]">
        <button
          ref={emojiRef}
          type="button"
          onClick={() => {
            remember();
            setEmojiOpen((open) => !open);
          }}
          aria-label="ใส่อิโมจิ"
          aria-expanded={emojiOpen}
          aria-haspopup="dialog"
          className="grid size-9 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
        >
          <Smile className="size-6" strokeWidth={1.9} />
        </button>

        <EmojiPopover
          anchorRef={emojiRef}
          open={emojiOpen}
          variant="composer"
          onClose={() => {
            setEmojiOpen(false);
            requestAnimationFrame(() => {
              const input = inputRef.current;

              input?.focus();
              input?.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
            });
          }}
          onPick={insertEmoji}
        />

        <label htmlFor={inputId} className="sr-only">
          พิมพ์ข้อความ
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            fit();
            remember();

            if (event.target.value && !editing) onTyping();
          }}
          onSelect={remember}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && (editing || reply)) {
              event.preventDefault();
              if (editing) onCancelEdit();
              else onCancelReply();

              return;
            }

            // Enter ส่ง · Shift+Enter ขึ้นบรรทัด · ระหว่างเลือกคำของ IME
            // (พิมพ์ไทย/ญี่ปุ่นบางแป้น) ห้ามส่ง ไม่งั้นส่งคำที่ยังเลือกไม่เสร็จ
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="ส่งข้อความ…"
          className="max-h-[120px] min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 text-[15px] leading-5 outline-none placeholder:text-muted-foreground"
        />

        {editing ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim()}
            aria-label="บันทึกการแก้ไข"
            title="บันทึกการแก้ไข"
            className="my-1 grid size-7 shrink-0 place-items-center rounded-full bg-link text-white transition-opacity disabled:opacity-40"
          >
            <Check aria-hidden className="size-4" strokeWidth={3} />
          </button>
        ) : hasContent ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={attachments.uploading}
            className="h-9 shrink-0 px-2 text-[15px] font-semibold text-link transition-opacity hover:text-foreground disabled:opacity-40"
          >
            ส่ง
          </button>
        ) : (
          <span className="flex shrink-0 items-center">
            {voiceSupported && (
              <button
                type="button"
                onPointerDown={(event) => {
                  if (event.button === 0) startVoice();
                }}
                onKeyDown={(event) => {
                  // คีย์บอร์ด: Enter/Space = แตะ (อัดค้างไว้ แล้วกด "ส่ง" เอง)
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void recorder.start();
                  }
                }}
                aria-label="อัดข้อความเสียง"
                title="แตะเพื่ออัด หรือกดค้างแล้วปล่อยเพื่อส่ง (สูงสุด 60 วินาที)"
                className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
              >
                <Mic className="size-6" strokeWidth={1.9} />
              </button>
            )}

            {/* ปุ่มคลิปของตัวเลือกไฟล์กลาง (รับทุกชนิดไฟล์ที่หลังบ้านรับ)
                ขยายไอคอนให้เท่าไอคอนอื่นในแถบ แทนการเขียนตัวเลือกไฟล์ใหม่ */}
            <span className="[&_button]:size-9 [&_button]:rounded-full [&_button]:text-foreground [&_svg]:size-6 [&_svg]:stroke-[1.9]">
              <AttachmentButton attachments={attachments} />
            </span>

            <ImagePicker attachments={attachments} />

            <button
              ref={stickerRef}
              type="button"
              onClick={() => setStickersOpen((open) => !open)}
              aria-label="สติกเกอร์และ GIF"
              aria-expanded={stickersOpen}
              aria-haspopup="dialog"
              className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
            >
              <Sticker className="size-6" strokeWidth={1.9} />
            </button>

            {/* หัวใจของ IG — กดทีเดียวส่ง ❤️ เลย ไม่ต้องพิมพ์ */}
            {!dock && (
              <button
                type="button"
                onClick={() => void submit('❤️')}
                aria-label="ส่งหัวใจ"
                className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
              >
                <Heart className="size-6" strokeWidth={1.9} />
              </button>
            )}
          </span>
        )}

        <StickerPopover
          anchorRef={stickerRef}
          open={stickersOpen}
          onClose={() => setStickersOpen(false)}
          onSticker={(emoji) => void onSend(emoji)}
          onGif={(file) => {
            setBusy('กำลังส่ง GIF…');
            void onSendGif(file).finally(() => setBusy(null));
          }}
        />
      </div>
    </div>
  );
}

/// แถบบอกสถานะเหนือช่องพิมพ์ (กำลังตอบกลับ / กำลังแก้ไข) พร้อม ✕
function ContextBar({
  label,
  preview,
  thumbnailId,
  onCancel,
  cancelLabel,
}: {
  label: string;
  preview?: string;
  thumbnailId?: string | null;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const { url } = useAssetUrl(thumbnailId ?? null);

  return (
    <div className="mb-2 flex items-center gap-3 border-t border-border px-2 pt-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {preview && (
          <span className="block truncate text-xs text-muted-foreground">{preview}</span>
        )}
      </span>

      {thumbnailId && (
        <span className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL อายุสั้น ใช้ next/image ไม่ได้
            <img src={url} alt="" className="size-full object-cover" />
          )}
        </span>
      )}

      <button
        type="button"
        onClick={onCancel}
        aria-label={cancelLabel}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X aria-hidden className="size-5" strokeWidth={1.9} />
      </button>
    </div>
  );
}

/// ปุ่มรูปภาพ — ตัวเลือกไฟล์ที่กรองเฉพาะรูปและวิดีโอ แต่ส่งเข้าคิวอัปโหลดชุดเดียวกัน
///
/// ใช้ `pick` ของ useAttachments ตัวเดียวกับปุ่มคลิป ไฟล์จึงขึ้นแถวเดียวกันและ
/// นับเพดานสิบไฟล์ร่วมกัน · ล้างค่าช่องเองหลังส่งให้ pick เพราะ ref ของ hook
/// ผูกอยู่กับช่องของปุ่มคลิป — pick คัดลอกรายชื่อไฟล์ก่อน await แรก จึงล้างได้ทันที
function ImagePicker({ attachments }: { attachments: ReturnType<typeof useAttachments> }) {
  const ref = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
        className="sr-only"
        tabIndex={-1}
        aria-label="เลือกรูปหรือวิดีโอ"
        onChange={(event) => {
          void attachments.pick(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={attachments.full}
        aria-label="แนบรูปภาพ"
        title={attachments.full ? `แนบได้สูงสุด ${attachments.max} ไฟล์` : 'แนบรูปภาพ'}
        className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-accent disabled:opacity-40"
      >
        <ImageIcon className="size-6" strokeWidth={1.9} />
      </button>
    </>
  );
}
