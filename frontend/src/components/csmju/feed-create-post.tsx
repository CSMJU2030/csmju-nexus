'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Images, Loader2, Smile } from 'lucide-react';
import { EmojiPopover } from '@/components/csmju/emoji-picker';
import { FeedModal, SheetButton } from '@/components/csmju/feed-modal';
import { CarouselDots, type PostView } from '@/components/csmju/feed-post-media';
import { toast } from '@/components/csmju/feed-toast';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { formatBytes, uploadFile } from '@/lib/csmju/upload';
import { cn } from '@/lib/utils';

/// "สร้างโพสต์ใหม่" แบบ Instagram — เลือก/ลากไฟล์ → ดูตัวอย่าง → เขียนคำบรรยาย → แชร์
///
/// ไฟล์ขึ้น storage ตอนกด "แชร์" เท่านั้น ไม่ใช่ตอนเลือก — เลือกแล้วเปลี่ยนใจกด
/// ปิด จะไม่เหลือไฟล์ค้างในโควตาของผู้ใช้ (ไฟล์ที่ commit แล้วนับโควตาทันที)
///
/// กระทู้ข้อความล้วน (ถามตอบ/ประกาศ) ยังเป็นส่วนหลักของระบบนี้ จึงมีทางลัด
/// "เขียนข้อความอย่างเดียว" ข้ามไปขั้นเขียนได้เลย ไม่บังคับต้องมีรูปแบบ IG

/// หลังบ้านรับได้ไม่เกิน 10 ชิ้นต่อโพสต์ (ภาพหมุนของ Instagram ก็ 10 เหมือนกัน)
export const MAX_POST_MEDIA = 10;
/// เพดานต่อไฟล์เดียวกับหลังบ้าน (MAX_FILE_BYTES ใน asset.dto.ts)
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT = 8000;
const MAX_TITLE = 200;
const COURSE_TAG = /^[A-Z]{2,4}[0-9]{3}$/;

type Step = 'pick' | 'preview' | 'caption' | 'discard';

interface Picked {
  key: string;
  file: File;
  url: string;
  kind: 'IMAGE' | 'VIDEO';
}

/// ตรวจไฟล์ก่อนรับ — บอกเหตุผลเป็นรายไฟล์ ไม่เงียบทิ้ง
export function pickProblem(file: { name: string; type: string; size: number }): string | null {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    return `${file.name}: รับเฉพาะรูปภาพและวิดีโอ`;
  }

  if (file.size > MAX_FILE_BYTES) {
    return `${file.name}: ใหญ่ ${formatBytes(file.size)} เกินเพดาน ${formatBytes(MAX_FILE_BYTES)}`;
  }

  return null;
}

export function CreatePostModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (post: PostView) => void;
}) {
  const me = useMe();
  const profile = useProfile(me.id);
  const [step, setStep] = useState<Step>('pick');
  const [back, setBack] = useState<Step>('pick');
  const [files, setFiles] = useState<Picked[]>([]);
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tag, setTag] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiRef = useRef<HTMLButtonElement | null>(null);
  const urls = useRef<string[]>([]);
  const emojiOpenRef = useRef(false);

  useEffect(() => {
    emojiOpenRef.current = emojiOpen;
  }, [emojiOpen]);

  // ตัวอย่างถือหน่วยความจำเท่าขนาดไฟล์ — คืนทุกครั้งที่ออกจากกล่อง
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  function reset() {
    // คืนหน่วยความจำหลัง <video>/<img> ถอดออกไปแล้ว — revoke ทันทีระหว่างที่
    // element ยังโหลดอยู่ เบราว์เซอร์จะฟ้อง ERR_FILE_NOT_FOUND ใน console
    const stale = urls.current;

    urls.current = [];
    setTimeout(() => {
      for (const url of stale) URL.revokeObjectURL(url);
    }, 1000);
    setFiles([]);
    setIndex(0);
    setStep('pick');
    setTitle('');
    setContent('');
    setTag('');
    setProblem(null);
    setError(null);
  }

  const dirty = files.length > 0 || content.trim() !== '' || title.trim() !== '';

  /// ปิดกล่อง — มีของค้างอยู่ถามก่อนแบบ IG ("ละทิ้งโพสต์ใช่ไหม")
  function requestClose() {
    // Esc ครั้งแรกระหว่างแผงอิโมจิเปิด = ปิดแค่แผงอิโมจิ (แผงจัดการเอง)
    if (emojiOpenRef.current || busy) return;

    if (dirty && step !== 'discard') {
      setBack(step);
      setStep('discard');

      return;
    }

    reset();
    onClose();
  }

  function add(list: FileList | File[]) {
    const incoming = [...list];
    const problems: string[] = [];
    const accepted: Picked[] = [];

    for (const file of incoming) {
      const why = pickProblem(file);

      if (why) {
        problems.push(why);
        continue;
      }

      if (files.length + accepted.length >= MAX_POST_MEDIA) {
        problems.push(`เลือกได้ไม่เกิน ${MAX_POST_MEDIA} ชิ้นต่อโพสต์`);
        break;
      }

      const url = URL.createObjectURL(file);

      urls.current.push(url);
      accepted.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${accepted.length}`,
        file,
        url,
        kind: file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      });
    }

    setProblem(problems.length ? problems.join(' · ') : null);

    if (accepted.length) {
      setFiles((prev) => [...prev, ...accepted]);
      setStep('preview');
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);

    if (event.dataTransfer.files.length) add(event.dataTransfer.files);
  }

  function insertEmoji(emoji: string) {
    const area = textRef.current;
    const start = area?.selectionStart ?? content.length;
    const end = area?.selectionEnd ?? content.length;
    const next = (content.slice(0, start) + emoji + content.slice(end)).slice(0, MAX_CONTENT);
    const caret = start + emoji.length;

    setContent(next);
    requestAnimationFrame(() => textRef.current?.setSelectionRange(caret, caret));
  }

  const tagValue = tag.trim().toUpperCase();
  const tagOk = !tagValue || COURSE_TAG.test(tagValue);
  // ข้อความล้วนต้องมีหัวข้อและเนื้อหา (กระทู้) · มีสื่อแล้วคำบรรยายไม่บังคับ แบบ IG
  const canShare =
    tagOk && (files.length > 0 ? true : title.trim() !== '' && content.trim() !== '');

  async function share() {
    if (!canShare || busy) return;

    setError(null);

    try {
      const assetIds: string[] = [];

      for (const [position, item] of files.entries()) {
        setBusy(`กำลังอัปโหลด ${position + 1}/${files.length}…`);
        assetIds.push((await uploadFile(item.file, 'attachments')).assetId);
      }

      setBusy('กำลังแชร์…');

      const post = await api.post<PostView>('/posts', {
        // ส่งเฉพาะที่กรอก — ValidationPipe ปฏิเสธ field ที่เป็นค่าว่าง
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(content.trim() ? { content: content.trim() } : {}),
        ...(tagValue ? { courseTag: tagValue } : {}),
        ...(assetIds.length ? { assetIds: assetIds } : {}),
      });

      onCreated(post);
      toast('แชร์โพสต์แล้ว');
      setBusy(null);
      reset();
      onClose();
    } catch (caught) {
      setBusy(null);
      // ข้อความจากหลังบ้านอ่านรู้เรื่องแล้ว เช่น "แท็กวิชาต้องอยู่ในรูปแบบเช่น CS201"
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'แชร์ไม่สำเร็จ');
    }
  }

  const current = files[index];
  const wide = step === 'caption';

  return (
    <FeedModal
      open={open}
      onClose={requestClose}
      label="สร้างโพสต์ใหม่"
      className={cn(
        'transition-[max-width] duration-200',
        step === 'discard' ? 'max-w-100' : wide ? 'max-w-220' : 'max-w-140',
      )}
    >
      {step === 'discard' ? (
        <>
          <div className="px-6 pb-4 pt-7 text-center">
            <h2 className="text-csmju-body font-semibold">ละทิ้งโพสต์ใช่ไหม</h2>
            <p className="mt-1.5 text-csmju-label text-muted-foreground">
              หากออกตอนนี้ การแก้ไขของคุณจะไม่ถูกบันทึก
            </p>
          </div>
          <SheetButton
            tone="danger"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            ละทิ้ง
          </SheetButton>
          <SheetButton onClick={() => setStep(back)}>ยกเลิก</SheetButton>
        </>
      ) : (
        <>
          <header className="relative flex h-11 shrink-0 items-center justify-center border-b border-border px-12">
            {step !== 'pick' && (
              <button
                type="button"
                onClick={() => setStep(step === 'caption' && files.length ? 'preview' : 'pick')}
                disabled={busy !== null}
                aria-label="ย้อนกลับ"
                className="absolute left-2 grid size-8 place-items-center rounded-full hover:bg-accent"
              >
                <ArrowLeft className="size-5" strokeWidth={1.9} />
              </button>
            )}
            <h2 className="text-csmju-body font-semibold">
              {step === 'preview' ? 'ตัวอย่าง' : 'สร้างโพสต์ใหม่'}
            </h2>
            {step === 'preview' && (
              <button
                type="button"
                onClick={() => setStep('caption')}
                className="absolute right-4 text-csmju-label font-semibold text-link hover:opacity-70"
              >
                ถัดไป
              </button>
            )}
            {step === 'caption' && (
              <button
                type="button"
                onClick={() => void share()}
                disabled={!canShare || busy !== null}
                className="absolute right-4 text-csmju-label font-semibold text-link hover:opacity-70 disabled:opacity-40"
              >
                แชร์
              </button>
            )}
          </header>

          {step === 'pick' && (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex min-h-105 flex-col items-center justify-center gap-4 px-6 py-10 text-center transition-colors',
                dragging && 'bg-accent',
              )}
            >
              <Images aria-hidden className="size-20" strokeWidth={1} />
              <p className="text-csmju-title font-normal">ลากรูปภาพและวิดีโอมาที่นี่</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                aria-label="เลือกรูปภาพหรือวิดีโอ"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) add(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-lg bg-primary px-4 py-2 text-csmju-label font-semibold text-primary-foreground hover:opacity-90"
              >
                เลือกจากคอมพิวเตอร์
              </button>
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setStep('caption');
                }}
                className="text-csmju-label font-semibold text-link hover:opacity-70"
              >
                เขียนข้อความอย่างเดียว
              </button>
              <p className="text-csmju-caption text-muted-foreground">
                สูงสุด {MAX_POST_MEDIA} ชิ้น · ไฟล์ละไม่เกิน {formatBytes(MAX_FILE_BYTES)}
              </p>
              {problem && (
                <p role="alert" className="text-csmju-caption text-destructive">
                  {problem}
                </p>
              )}
            </div>
          )}

          {step !== 'pick' && (
            <div className={cn('flex min-h-0', wide ? 'flex-col md:flex-row' : 'flex-col')}>
              {current && (
                <div
                  className={cn(
                    'relative shrink-0 bg-black',
                    wide ? 'aspect-square w-full md:w-[60%]' : 'aspect-square w-full',
                  )}
                >
                  {current.kind === 'VIDEO' ? (
                    <video
                      key={current.key}
                      src={current.url}
                      muted
                      loop
                      autoPlay
                      playsInline
                      aria-label={`ตัวอย่างชิ้นที่ ${index + 1}`}
                      className="size-full object-contain"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- object URL ในเครื่อง ไม่ใช่รูปจากเซิร์ฟเวอร์
                    <img
                      src={current.url}
                      alt={`ตัวอย่างชิ้นที่ ${index + 1}`}
                      className="size-full object-contain"
                    />
                  )}
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => setIndex(index - 1)}
                      aria-label="ชิ้นก่อนหน้า"
                      className="absolute left-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"
                    >
                      <ChevronLeft className="size-5" />
                    </button>
                  )}
                  {index < files.length - 1 && (
                    <button
                      type="button"
                      onClick={() => setIndex(index + 1)}
                      aria-label="ชิ้นถัดไป"
                      className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"
                    >
                      <ChevronRight className="size-5" />
                    </button>
                  )}
                  {files.length > 1 && (
                    <CarouselDots count={files.length} index={index} className="absolute inset-x-0 bottom-3" />
                  )}
                  {step === 'preview' && files.length < MAX_POST_MEDIA && (
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1.5 text-csmju-caption font-semibold text-white"
                    >
                      + เพิ่ม ({files.length}/{MAX_POST_MEDIA})
                    </button>
                  )}
                  <input
                    ref={step === 'preview' ? inputRef : undefined}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(event) => {
                      if (event.target.files) add(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </div>
              )}

              {step === 'caption' && (
                <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
                  <div className="flex items-center gap-3 px-4 pt-4">
                    <Avatar coreUserId={me.id} size={28} showOnline={false} />
                    <span className="text-csmju-label font-semibold">{profile.displayName}</span>
                  </div>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value.slice(0, MAX_TITLE))}
                    placeholder={files.length ? 'หัวข้อ (ไม่บังคับ)' : 'หัวข้อ เช่น ถามเรื่อง pointer ใน C'}
                    aria-label="หัวข้อ"
                    className="mx-4 mt-3 bg-transparent text-csmju-label font-semibold outline-none placeholder:text-muted-foreground"
                  />
                  <textarea
                    ref={textRef}
                    value={content}
                    onChange={(event) => setContent(event.target.value.slice(0, MAX_CONTENT))}
                    placeholder="เขียนคำบรรยาย… พิมพ์ @ชื่อผู้ใช้ เพื่อเรียกถึงใครได้"
                    aria-label="คำบรรยาย"
                    rows={7}
                    className="mx-4 mt-2 min-h-32 flex-1 resize-none bg-transparent text-csmju-label outline-none placeholder:text-muted-foreground"
                  />
                  <div className="flex items-center justify-between px-3 pb-2">
                    <button
                      ref={emojiRef}
                      type="button"
                      onClick={() => setEmojiOpen((value) => !value)}
                      aria-label="แทรกอีโมจิ"
                      aria-expanded={emojiOpen}
                      className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <Smile className="size-5" strokeWidth={1.9} />
                    </button>
                    <span className="text-csmju-caption tabular-nums text-muted-foreground">
                      {content.length.toLocaleString('th-TH')}/{MAX_CONTENT.toLocaleString('th-TH')}
                    </span>
                  </div>
                  <label className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-csmju-label">
                    แท็กวิชา
                    <input
                      value={tag}
                      onChange={(event) => setTag(event.target.value.toUpperCase().slice(0, 7))}
                      placeholder="CS201"
                      aria-invalid={!tagOk}
                      className={cn(
                        'w-24 rounded-md bg-muted px-2 py-1 text-right font-mono text-csmju-label outline-none',
                        !tagOk && 'ring-1 ring-destructive',
                      )}
                    />
                  </label>
                  {!tagOk && (
                    <p className="px-4 text-csmju-caption text-destructive">แท็กวิชาต้องอยู่ในรูปแบบเช่น CS201</p>
                  )}
                  {busy && (
                    <p role="status" className="flex items-center gap-2 px-4 py-2 text-csmju-caption text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      {busy}
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="px-4 py-2 text-csmju-caption text-destructive">
                      {error}
                    </p>
                  )}
                  <EmojiPopover
                    anchorRef={emojiRef}
                    open={emojiOpen}
                    onClose={() => setEmojiOpen(false)}
                    onPick={insertEmoji}
                    variant="composer"
                  />
                </div>
              )}
            </div>
          )}

          {step === 'preview' && problem && (
            <p role="alert" className="px-4 py-2 text-csmju-caption text-destructive">
              {problem}
            </p>
          )}
        </>
      )}
    </FeedModal>
  );
}
