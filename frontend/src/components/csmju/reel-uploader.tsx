'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Film, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/csmju/api';
import { formatBytes } from '@/lib/csmju/upload';
import type { Reel } from '@/lib/csmju/types';

/// เพดานเดียวกับหลังบ้าน (reel.dto.ts · asset.dto.ts) — ตรวจก่อนอัปโหลด
/// ผู้ใช้จะได้รู้ภายในวินาทีแรก ไม่ใช่รออัป 40 MB เสร็จแล้วค่อยโดนปฏิเสธ
export const REEL_MAX_MS = 60_000;
export const REEL_MAX_BYTES = 50 * 1024 * 1024;

/// ชนิดที่หลังบ้านรับ (common/util/file-type.ts)
///
/// **ต้องมี `.mov` และ `video/quicktime`** — คลิปจาก iPhone และมือถือหลายรุ่น
/// เป็น .mov เดิมช่องนี้รับแค่ mp4/webm ไฟล์จากมือถือจึงถูกซ่อนในหน้าต่าง
/// เลือกไฟล์ตั้งแต่แรก ผู้ใช้เห็นว่า "ลงคลิปไม่ได้" โดยไม่มีข้อความบอกอะไรเลย
export const REEL_ACCEPT =
  'video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v';

const formatClock = (ms: number) => {
  const total = Math.round(ms / 1000);

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/// ตัดสินว่าไฟล์นี้ลงเป็นคลิปสั้นได้ไหม — คืนข้อความที่บอกวิธีแก้ หรือ null ถ้าผ่าน
///
/// แยกเป็นฟังก์ชันล้วนเพื่อทดสอบได้โดยไม่ต้องมีไฟล์วิดีโอจริง
export function reelFileProblem(
  file: { size: number },
  durationMs: number | null,
): string | null {
  if (file.size > REEL_MAX_BYTES) {
    return `ไฟล์ใหญ่ ${formatBytes(file.size)} เกินเพดาน ${formatBytes(REEL_MAX_BYTES)} — ลดความละเอียดหรือตัดให้สั้นลงก่อน`;
  }

  if (durationMs === null) {
    // เบราว์เซอร์อ่านไฟล์ไม่ออก = เพื่อนก็เปิดดูไม่ได้เหมือนกัน
    // มักเป็น .mov ที่บีบอัดด้วย HEVC ซึ่ง Chrome บน Windows เล่นไม่ได้
    return 'เบราว์เซอร์เปิดคลิปนี้ไม่ได้ (มักเป็นไฟล์ HEVC จาก iPhone) — แปลงเป็น MP4 (H.264) ก่อน หรือตั้งกล้องเป็น "ใช้ได้กับทุกเครื่องมากที่สุด"';
  }

  if (durationMs > REEL_MAX_MS) {
    return `คลิปยาว ${formatClock(durationMs)} นาที เกิน 1:00 — ตัดให้เหลือไม่เกิน 60 วินาทีก่อน`;
  }

  return null;
}

/// ความยาวจริงจากตัวไฟล์ — **ไม่ปัดทิ้ง ไม่เดา**
///
/// เดิมปัดคลิปยาวให้เหลือ 60 วินาทีเงียบ ๆ แล้วคืน 1 วินาทีเมื่ออ่านไม่ออก
/// คลิป 90 วินาทีจึงขึ้นป้าย "60 วินาที" และผ่านเพดานของหลังบ้านไปได้
/// ตอนนี้คืน null เมื่ออ่านไม่ออก แล้วให้ `reelFileProblem` บอกผู้ใช้ตรง ๆ
function readDurationMs(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const ms = Math.round(video.duration * 1000);

      done(Number.isFinite(ms) && ms > 0 ? ms : null);
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

export function ReelUploader({
  onCreated,
  defaultOpen = false,
}: {
  onCreated: (reel: Reel) => void;
  /// เปิดกล่องทันที — เมนู "สร้าง → ลงคลิปสั้น" ในแถบซ้ายพามาด้วย ?create=1
  defaultOpen?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [file, setFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ตัวอย่างคลิปถือหน่วยความจำเท่าขนาดไฟล์ — ต้องคืนทุกครั้งที่เปลี่ยนไฟล์
  // ปิดกล่อง หรือออกจากหน้า ไม่งั้นเลือกคลิป 40 MB ห้าครั้งคือค้างไว้ 200 MB
  const previewRef = useRef<string | null>(null);

  function showPreview(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);

    previewRef.current = next ? URL.createObjectURL(next) : null;
    setPreview(previewRef.current);
  }

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  function reset() {
    setFile(null);
    showPreview(null);
    setDurationMs(null);
    setProblem(null);
    setTitle('');
    setCaption('');
    setError(null);
  }

  async function choose(next: File | null) {
    setError(null);
    setProblem(null);
    setDurationMs(null);
    setFile(next);
    showPreview(next);

    if (!next) return;

    setChecking(true);

    const ms = await readDurationMs(next);

    setChecking(false);
    setDurationMs(ms);
    setProblem(reelFileProblem(next, ms));

    // ชื่อไฟล์เป็นหัวข้อตั้งต้นที่ดีกว่าช่องว่าง — แก้ทีหลังได้
    if (!title.trim()) {
      setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 120));
    }
  }

  async function upload() {
    if (!file || durationMs === null || problem || !title.trim()) return;

    setError(null);

    try {
      setStep('กำลังขอสิทธิ์อัปโหลด…');

      const intent = await api.post<{
        assetId: string;
        uploadUrl: string;
        uploadMethod: string;
        uploadHeaders: Record<string, string>;
      }>('/assets/upload-intents', {
        fileName: file.name,
        sizeBytes: file.size,
        bucket: 'reels',
      });

      setStep(`กำลังอัปโหลด ${formatBytes(file.size)}…`);

      // ใช้ method และ header ที่หลังบ้านสั่งมา ไม่ hardcode
      // ตอนย้ายไปที่เก็บไฟล์อื่น ค่าพวกนี้จะเปลี่ยนโดยหน้าบ้านไม่ต้องแก้
      const put = await fetch(intent.uploadUrl, {
        method: intent.uploadMethod || 'PUT',
        headers: intent.uploadHeaders ?? {},
        body: file,
      });

      if (!put.ok) {
        throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (HTTP ${put.status}) — ลองใหม่อีกครั้ง`);
      }

      setStep('กำลังตรวจไฟล์…');

      // จังหวะนี้ตรวจ magic bytes — ไฟล์ปลอมนามสกุลถูกปฏิเสธที่นี่
      await api.post(`/assets/${intent.assetId}/commit`);

      setStep('กำลังลงคลิป…');

      const reel = await api.post<Reel>('/reels', {
        title: title.trim(),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        assetId: intent.assetId,
        durationMs: durationMs,
      });

      onCreated(reel);
      setOpen(false);
      reset();
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น "พื้นที่เก็บไฟล์ไม่พอ"
      setError(caught instanceof Error ? caught.message : 'ลงคลิปไม่สำเร็จ');
    } finally {
      setStep(null);
    }
  }

  const ready = Boolean(file) && !checking && !problem && durationMs !== null && title.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // ห้ามปิดกลางคันระหว่างอัปโหลด — ไฟล์จะค้างเป็น PENDING
        if (!next && step) return;

        setOpen(next);
        if (!next) reset();
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-csmju-xs transition-opacity hover:opacity-90"
      >
        <Upload aria-hidden className="size-4" />
        ลงคลิป
      </button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="border-b border-border px-6 py-4 text-base">
            ลงคลิปสั้น
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="px-6 pt-3 text-csmju-caption text-muted-foreground">
          MP4 · WebM · MOV ยาวไม่เกิน 60 วินาที ขนาดไม่เกิน {formatBytes(REEL_MAX_BYTES)}
        </DialogDescription>

        <form
          className="space-y-4 px-6 pb-6 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <label
            htmlFor={`${id}-file`}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed px-4 text-center transition-colors ${
              problem ? 'border-destructive/60 bg-destructive/5' : 'border-border hover:border-primary hover:bg-secondary/40'
            } ${preview ? 'py-0' : 'py-6'}`}
          >
            {preview && !problem ? (
              <video
                src={preview}
                muted
                playsInline
                loop
                autoPlay
                className="max-h-64 w-full bg-black object-contain"
              />
            ) : (
              <>
                <Film aria-hidden className="size-7 text-primary" />
                <span className="text-csmju-label font-medium">
                  {file ? 'เลือกไฟล์อื่น' : 'เลือกคลิปจากเครื่อง'}
                </span>
                <span className="text-csmju-caption text-muted-foreground">
                  คลิปแนวตั้ง 9:16 แสดงผลได้ดีที่สุด
                </span>
              </>
            )}
            <input
              id={`${id}-file`}
              type="file"
              accept={REEL_ACCEPT}
              className="sr-only"
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            />
          </label>

          {file && (
            <p className="flex items-center justify-between gap-2 text-csmju-caption text-muted-foreground">
              <span className="min-w-0 truncate" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 tabular-nums">
                {checking ? (
                  <Loader2 aria-label="กำลังอ่านไฟล์" className="inline size-3 animate-spin" />
                ) : durationMs !== null ? (
                  `${formatClock(durationMs)} · ${formatBytes(file.size)}`
                ) : (
                  formatBytes(file.size)
                )}
              </span>
            </p>
          )}

          {problem && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-csmju-caption leading-relaxed text-destructive">
              {problem}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor={`${id}-title`}>หัวข้อคลิป</Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="เช่น สรุป Big-O ใน 60 วินาที"
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${id}-caption`}>คำบรรยาย (ไม่บังคับ)</Label>
            <Textarea
              id={`${id}-caption`}
              value={caption}
              maxLength={2000}
              rows={2}
              onChange={(event) => setCaption(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-csmju-caption text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={step !== null}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={!ready || step !== null}>
              {step && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {step ?? 'ลงคลิป'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
