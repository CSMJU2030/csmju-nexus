'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Download, Images, Loader2, SwitchCamera, X } from 'lucide-react';
import { toast } from '@/components/csmju/feed-toast';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { api, ApiError } from '@/lib/csmju/api';
import { applyFilter, CAMERA_FILTERS, coverCrop, filterCss } from '@/lib/csmju/camera-filters';
import { uploadFile } from '@/lib/csmju/upload';
import { cn } from '@/lib/utils';

/// กล้องแบบ Instagram — ปัดขวาจากฟีด (มือถือ) หรือ "สร้าง → ถ่ายรูป"
///
///   ถ่าย     กล้องหน้า/หลัง (ปุ่มสลับ หรือแตะสองครั้งที่ภาพ) · ปัดซ้าย-ขวาที่ภาพเพื่อเปลี่ยนฟิลเตอร์
///   ตรวจ     ดูภาพที่ได้ → ลงสตอรี่ · แชร์เป็นโพสต์ · บันทึกลงเครื่อง · ถ่ายใหม่
///   ไม่มีกล้อง/ไม่อนุญาต → เลือกรูปจากคลังแล้วใส่ฟิลเตอร์ได้เหมือนกัน
///
/// ภาพที่ถ่ายใส่ฟิลเตอร์ทีละพิกเซล (lib/csmju/camera-filters) จึงได้ผลเดียวกับพรีวิวทุกเบราว์เซอร์
/// ไฟล์เป็น JPEG ≤ 1080×1920 (~1 MB) — ต่ำกว่าเพดาน 10 MB ของการอัปโหลดมาก

type Facing = 'user' | 'environment';
type Phase = 'live' | 'review' | 'sending';

const STORY_ASPECT = 9 / 16;
const MAX_EDGE = 1920;
const SWIPE_PX = 50;

export function StoryCamera({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(<CameraBody onClose={onClose} />, document.body);
}

function CameraBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const panelRef = useModalFocus<HTMLDivElement>(true, onClose);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [cameraCount, setCameraCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [filterIndex, setFilterIndex] = useState(0);
  const [gallery, setGallery] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('live');
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const gesture = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastTap = useRef(0);

  const filter = CAMERA_FILTERS[filterIndex] ?? CAMERA_FILTERS[0]!;
  const mirrored = facing === 'user' && !gallery;
  const wantsCamera = phase === 'live' && !gallery;

  // เปิดกล้องตามด้านที่เลือก · ปิดทุกครั้งที่ออกจากโหมดถ่ายหรือสลับด้าน (คืนไฟกล้องให้เครื่อง)
  useEffect(() => {
    if (!wantsCamera) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setCameraError('เบราว์เซอร์นี้เปิดกล้องบนหน้านี้ไม่ได้ — เลือกรูปจากคลังแทน'));
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then(async (fresh) => {
        if (cancelled) {
          fresh.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = fresh;
        setCameraError(null);

        const video = videoRef.current;

        if (video) {
          video.srcObject = fresh;
          await video.play().catch(() => undefined);
        }

        setReady(true);

        // ชื่ออุปกรณ์ได้หลังอนุญาตแล้วเท่านั้น — มีกล้องเดียว (โน้ตบุ๊กส่วนใหญ่) = ไม่มีปุ่มสลับ
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);

        if (!cancelled) setCameraCount(devices.filter((device) => device.kind === 'videoinput').length);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;

        const name = caught instanceof DOMException ? caught.name : '';

        setCameraError(
          name === 'NotAllowedError'
            ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง — อนุญาตที่ไอคอนกุญแจข้างแถบที่อยู่ หรือเลือกรูปจากคลังแทน'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'ไม่พบกล้องในเครื่องนี้ — เลือกรูปจากคลังแทน'
              : 'เปิดกล้องไม่สำเร็จ — กล้องอาจถูกโปรแกรมอื่นใช้อยู่',
        );
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      setReady(false);
    };
  }, [wantsCamera, facing]);

  // คืนหน่วยความจำของรูปที่เปิดไว้
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  useEffect(() => () => {
    if (gallery) {
      URL.revokeObjectURL(gallery.url);
      gallery.bitmap.close();
    }
  }, [gallery]);

  function flip() {
    setFacing((current) => (current === 'user' ? 'environment' : 'user'));
  }

  function shiftFilter(delta: number) {
    setFilterIndex((current) => Math.min(CAMERA_FILTERS.length - 1, Math.max(0, current + delta)));
  }

  function onPointerDown(event: ReactPointerEvent) {
    gesture.current = { x: event.clientX, y: event.clientY, at: Date.now() };
  }

  function onPointerUp(event: ReactPointerEvent) {
    const start = gesture.current;

    gesture.current = null;

    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      // ปัดซ้าย = ฟิลเตอร์ถัดไป แบบ Instagram
      shiftFilter(dx < 0 ? 1 : -1);
      return;
    }

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - start.at < 300) {
      const now = Date.now();

      // แตะสองครั้ง = สลับกล้องหน้า-หลัง
      if (now - lastTap.current < 320 && !gallery && cameraCount > 1) flip();
      lastTap.current = now;
    }
  }

  async function pickGallery(file: File) {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('เลือกได้เฉพาะไฟล์รูปภาพ');
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);

      setGallery({ bitmap, url: URL.createObjectURL(file) });
    } catch {
      setError('เปิดรูปนี้ไม่ได้ — ลองไฟล์ JPG หรือ PNG');
    }
  }

  async function capture() {
    setError(null);

    let canvas: HTMLCanvasElement;

    if (gallery) {
      const { bitmap } = gallery;
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

      canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } else {
      const video = videoRef.current;

      if (!video || !video.videoWidth) return;

      const crop = coverCrop(video.videoWidth, video.videoHeight, STORY_ASPECT);
      const scale = Math.min(1, MAX_EDGE / crop.sh);

      canvas = document.createElement('canvas');
      canvas.width = Math.round(crop.sw * scale);
      canvas.height = Math.round(crop.sh * scale);

      const context = canvas.getContext('2d');

      if (!context) return;

      // กล้องหน้าบันทึกแบบกระจกเหมือนที่เห็นในพรีวิว (แบบเดียวกับสตอรี่ของ Instagram)
      if (mirrored) {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }

      context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 160);
    }

    const context = canvas.getContext('2d');

    if (!context) return;

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);

    applyFilter(pixels.data, filter);
    context.putImageData(pixels, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));

    if (!blob) {
      setError('บันทึกภาพไม่สำเร็จ — ลองอีกครั้ง');
      return;
    }

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const file = new File([blob], `nexus-${stamp}.jpg`, { type: 'image/jpeg' });

    setShot({ file, url: URL.createObjectURL(blob) });
    setPhase('review');
  }

  function retake() {
    setShot(null);
    setError(null);
    setPhase('live');
  }

  async function share(target: 'story' | 'post') {
    if (!shot) return;

    setPhase('sending');
    setError(null);

    try {
      const asset = await uploadFile(shot.file, 'attachments', setStep);

      setStep(target === 'story' ? 'กำลังลงสตอรี่…' : 'กำลังแชร์โพสต์…');

      if (target === 'story') {
        await api.post('/stories', { assetId: asset.assetId });
        await queryClient.invalidateQueries({ queryKey: ['stories'] });
        toast('ลงสตอรี่แล้ว');
      } else {
        await api.post('/posts', {
          assetIds: [asset.assetId],
          ...(caption.trim() ? { content: caption.trim() } : {}),
        });
        await queryClient.invalidateQueries({ queryKey: ['feed'] });
        toast('แชร์โพสต์แล้ว');
      }

      onClose();
    } catch (caught) {
      setPhase('review');
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'แชร์ไม่สำเร็จ');
    } finally {
      setStep(null);
    }
  }

  const css = filterCss(filter);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="กล้อง"
      className="fixed inset-0 z-100 flex flex-col bg-black text-white animate-in fade-in-0 slide-in-from-left-8 duration-200"
    >
      <input
        ref={galleryRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) void pickGallery(file);
          event.target.value = '';
        }}
      />

      {/* แถบบน */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        {phase === 'live' ? (
          <button
            type="button"
            onClick={gallery ? () => setGallery(null) : onClose}
            aria-label={gallery ? 'กลับไปใช้กล้อง' : 'ปิดกล้อง'}
            className="grid size-10 place-items-center rounded-full hover:bg-white/10"
          >
            {gallery ? <ChevronLeft aria-hidden className="size-6" /> : <X aria-hidden className="size-6" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={retake}
            disabled={phase === 'sending'}
            aria-label="ถ่ายใหม่"
            className="grid size-10 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40"
          >
            <ChevronLeft aria-hidden className="size-6" />
          </button>
        )}

        <span className="text-csmju-label font-semibold">
          {phase === 'live' ? (gallery ? 'ใส่ฟิลเตอร์ให้รูป' : 'กล้อง') : 'ตรวจภาพก่อนแชร์'}
        </span>

        {phase === 'review' && shot ? (
          <a
            href={shot.url}
            download={shot.file.name}
            aria-label="บันทึกลงเครื่อง"
            className="grid size-10 place-items-center rounded-full hover:bg-white/10"
          >
            <Download aria-hidden className="size-5" />
          </a>
        ) : (
          <span className="size-10" />
        )}
      </div>

      {/* ภาพ — กรอบ 9:16 เดียวกับภาพที่ได้ */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        <div
          className="relative aspect-9/16 h-full max-h-full max-w-full touch-none select-none overflow-hidden rounded-2xl bg-neutral-900"
          onPointerDown={phase === 'live' ? onPointerDown : undefined}
          onPointerUp={phase === 'live' ? onPointerUp : undefined}
        >
          {phase !== 'live' && shot ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL ในเครื่อง
            <img src={shot.url} alt="ภาพที่ถ่าย" className="size-full object-contain" />
          ) : gallery ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL ในเครื่อง
            <img src={gallery.url} alt="รูปที่เลือก" style={{ filter: css }} className="size-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              aria-label="ภาพจากกล้อง"
              style={{ filter: css, transform: mirrored ? 'scaleX(-1)' : undefined }}
              className="size-full object-cover"
            />
          )}

          {phase === 'live' && !gallery && !ready && !cameraError && (
            <span className="absolute inset-0 grid place-items-center text-sm text-white/70">
              <Loader2 aria-hidden className="size-7 animate-spin" />
            </span>
          )}

          {phase === 'live' && !gallery && cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-sm leading-relaxed text-white/85">{cameraError}</p>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
              >
                เลือกรูปจากคลัง
              </button>
            </div>
          )}

          {phase === 'live' && (ready || gallery) && (
            <span
              key={filter.id}
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 top-4 text-center text-lg font-semibold drop-shadow animate-in fade-in-0 duration-300"
            >
              {filter.label}
            </span>
          )}

          {flash && <span aria-hidden className="absolute inset-0 bg-white/80" />}

          {phase === 'sending' && (
            <span className="absolute inset-0 grid place-items-center bg-black/50 text-sm">
              <span className="flex items-center gap-2">
                <Loader2 aria-hidden className="size-5 animate-spin" />
                {step ?? 'กำลังส่ง…'}
              </span>
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-auto mt-2 max-w-sm px-4 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {/* แถบล่าง */}
      {phase === 'live' ? (
        <div className="shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          <div
            role="radiogroup"
            aria-label="ฟิลเตอร์"
            className="mx-auto flex max-w-full gap-3 overflow-x-auto px-4 pb-3 csmju-no-scrollbar"
          >
            {CAMERA_FILTERS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={index === filterIndex}
                onClick={() => setFilterIndex(index)}
                className="flex shrink-0 flex-col items-center gap-1"
              >
                <span
                  aria-hidden
                  style={{ filter: filterCss(item) }}
                  className={cn(
                    'csmju-filter-swatch block size-12 rounded-full ring-offset-2 ring-offset-black',
                    index === filterIndex && 'ring-2 ring-white',
                  )}
                />
                <span className={cn('text-xs', index === filterIndex ? 'font-semibold' : 'text-white/70')}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>

          <div className="mx-auto flex max-w-sm items-center justify-between px-8">
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              aria-label="เลือกรูปจากคลัง"
              className="grid size-12 place-items-center rounded-xl bg-white/10 hover:bg-white/20"
            >
              <Images aria-hidden className="size-6" />
            </button>

            <button
              type="button"
              onClick={() => void capture()}
              disabled={!ready && !gallery}
              aria-label={gallery ? 'ใช้รูปนี้' : 'ถ่ายภาพ'}
              className="grid size-18 place-items-center rounded-full border-4 border-white transition-transform active:scale-90 disabled:opacity-40"
            >
              <span className="size-14 rounded-full bg-white" />
            </button>

            {!gallery && cameraCount > 1 ? (
              <button
                type="button"
                onClick={flip}
                aria-label={facing === 'user' ? 'สลับเป็นกล้องหลัง' : 'สลับเป็นกล้องหน้า'}
                className="grid size-12 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <SwitchCamera aria-hidden className="size-6" />
              </button>
            ) : (
              <span className="size-12" />
            )}
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-md shrink-0 space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          <label className="block">
            <span className="mb-1 block text-xs text-white/70">คำบรรยาย (ใช้เมื่อแชร์เป็นโพสต์)</span>
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={2000}
              disabled={phase === 'sending'}
              placeholder="เขียนคำบรรยาย…"
              className="h-10 w-full rounded-lg bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/50 focus-visible:ring-2 focus-visible:ring-white/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void share('post')}
              disabled={phase === 'sending'}
              className="h-11 rounded-full bg-white/15 text-sm font-semibold hover:bg-white/25 disabled:opacity-50"
            >
              แชร์เป็นโพสต์
            </button>
            <button
              type="button"
              onClick={() => void share('story')}
              disabled={phase === 'sending'}
              className="csmju-brand h-11 rounded-full text-sm font-semibold disabled:opacity-50"
            >
              สตอรี่ของคุณ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
