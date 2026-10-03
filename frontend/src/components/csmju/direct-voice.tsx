'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { api } from '@/lib/csmju/api';
import { useAssetUrl } from '@/lib/csmju/asset-url';
import type { UploadedAsset } from '@/lib/csmju/upload';
import type { MessageAttachment } from '@/lib/csmju/types';

/// ข้อความเสียงแบบ Instagram — อัดด้วย MediaRecorder แล้วส่งเป็นไฟล์แนบชนิด AUDIO
///
/// ขาอัด: กดไมค์ค้าง = อัดจนกว่าจะปล่อยแล้วส่งทันที · แตะไมค์ = อัดค้างไว้
/// แล้วกด "ส่ง" หรือถังขยะเอง · เพดาน 60 วินาที (ครบแล้วส่งให้เอง)
///
/// ขารับ: ฟองมีปุ่มเล่น · แถบความคืบหน้า · ความยาว — เล่นในหน้าด้วย <audio>
/// (หลังบ้านไม่บังคับดาวน์โหลดไฟล์ AUDIO จึงเล่นจากลิงก์ตรงได้)

export const VOICE_MAX_MS = 60_000;

/// เบราว์เซอร์นี้อัดเสียงได้ไหม — ไม่ได้ก็ซ่อนปุ่มไมค์ ไม่โชว์ปุ่มที่กดแล้วพัง
export function canRecordVoice(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/// ชนิดไฟล์ที่เครื่องนี้อัดได้ เรียงจากที่หลังบ้านรู้จักดีที่สุด
///
/// Chrome/Edge/Firefox ได้ webm+opus · Safari ได้ mp4 (m4a)
function pickFormat(): { mimeType: string; fileName: string } {
  const options = [
    { mimeType: 'audio/webm;codecs=opus', fileName: 'voice.webm' },
    { mimeType: 'audio/webm', fileName: 'voice.webm' },
    { mimeType: 'audio/ogg;codecs=opus', fileName: 'voice.ogg' },
    { mimeType: 'audio/mp4', fileName: 'voice.m4a' },
  ];

  return (
    options.find((row) => MediaRecorder.isTypeSupported?.(row.mimeType)) ?? options[0]
  );
}

/// อัปโหลดเสียงที่อัดไว้ผ่านท่อสามจังหวะเดียวกับไฟล์แนบ
///
/// ต่างจาก `uploadFile` ตรงที่ **ต้องส่ง `contentType` ไปด้วย** — webm ที่มีแต่เสียง
/// กับ webm ที่มีภาพหัวไฟล์เหมือนกันทุกไบต์ ถ้าไม่บอกหลังบ้านจะนับเป็นวิดีโอ
/// แล้วฝั่งรับได้ตัวเล่นวิดีโอจอดำแทนฟองเสียง
export async function uploadVoice(
  blob: Blob,
  fileName: string,
  contentType: string,
): Promise<UploadedAsset> {
  const intent = await api.post<{
    assetId: string;
    uploadUrl: string;
    uploadMethod: string;
    uploadHeaders: Record<string, string>;
  }>('/assets/upload-intents', {
    fileName: fileName,
    sizeBytes: blob.size,
    bucket: 'attachments',
    contentType: contentType,
  });

  const put = await fetch(intent.uploadUrl, {
    method: intent.uploadMethod || 'PUT',
    headers: intent.uploadHeaders ?? {},
    body: blob,
  });

  if (!put.ok) throw new Error(`อัปโหลดเสียงไม่สำเร็จ (HTTP ${put.status})`);

  const asset = await api.post<{
    id: string;
    fileName: string;
    kind: UploadedAsset['kind'];
    mimeType: string;
    sizeBytes: string;
  }>(`/assets/${intent.assetId}/commit`);

  return {
    assetId: asset.id,
    fileName: asset.fileName,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface VoiceClip {
  blob: Blob;
  fileName: string;
  contentType: string;
  durationMs: number;
}

/// สถานะการอัด + ระดับเสียงสำหรับวาดคลื่น
export function useVoiceRecorder(onLimit: (clip: VoiceClip) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const resolveRef = useRef<((clip: VoiceClip | null) => void) | null>(null);
  const formatRef = useRef({ mimeType: '', fileName: '' });
  const onLimitRef = useRef(onLimit);

  useEffect(() => {
    onLimitRef.current = onLimit;
  }, [onLimit]);

  const teardown = useCallback(() => {
    if (tickRef.current !== null) cancelAnimationFrame(tickRef.current);
    tickRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setLevels([]);
  }, []);

  // ออกจากห้องระหว่างอัด = ปิดไมค์ ไม่งั้นไฟแดงของเบราว์เซอร์ค้างอยู่
  useEffect(() => teardown, [teardown]);

  /// หยุดอัด — `keep: false` = ทิ้ง (ถังขยะ)
  const stop = useCallback(
    (keep: boolean): Promise<VoiceClip | null> =>
      new Promise((resolve) => {
        const recorder = recorderRef.current;

        if (!recorder || recorder.state === 'inactive') {
          teardown();
          resolve(null);

          return;
        }

        resolveRef.current = keep ? resolve : null;
        if (!keep) resolve(null);
        recorder.stop();
      }),
    [teardown],
  );

  const start = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const format = pickFormat();
      const recorder = new MediaRecorder(
        stream,
        MediaRecorder.isTypeSupported?.(format.mimeType) ? { mimeType: format.mimeType } : undefined,
      );

      formatRef.current = format;
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Math.min(Date.now() - startedRef.current, VOICE_MAX_MS);
        const contentType = (recorder.mimeType || formatRef.current.mimeType).toLowerCase();
        const clip: VoiceClip = {
          blob: new Blob(chunksRef.current, { type: contentType }),
          fileName: formatRef.current.fileName,
          contentType,
          durationMs,
        };

        teardown();
        resolveRef.current?.(clip);
        resolveRef.current = null;
      };

      // คลื่นเสียงสด — อ่านระดับเสียงจาก AnalyserNode ทุกเฟรม เก็บ 40 แท่งล่าสุด
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const analyser = AudioCtx ? new AudioCtx() : null;

      audioCtxRef.current = analyser;

      const node = analyser?.createAnalyser() ?? null;

      if (analyser && node) {
        node.fftSize = 512;
        analyser.createMediaStreamSource(stream).connect(node);
      }

      const data = node ? new Uint8Array(node.fftSize) : null;

      startedRef.current = Date.now();
      recorder.start(250);
      setRecording(true);
      setElapsed(0);

      let lastSample = 0;
      const tick = () => {
        const now = Date.now();
        const ms = now - startedRef.current;

        setElapsed(ms);

        if (node && data && now - lastSample > 90) {
          lastSample = now;
          node.getByteTimeDomainData(data);

          let peak = 0;

          for (const value of data) peak = Math.max(peak, Math.abs(value - 128));

          setLevels((prev) => [...prev.slice(-39), Math.min(1, peak / 64)]);
        }

        if (ms >= VOICE_MAX_MS) {
          // ครบเพดาน — หยุดแล้วส่งให้เอง แบบ IG
          void stop(true).then((clip) => {
            if (clip) onLimitRef.current(clip);
          });

          return;
        }

        tickRef.current = requestAnimationFrame(tick);
      };

      tickRef.current = requestAnimationFrame(tick);
    } catch (caught) {
      teardown();
      setError(
        caught instanceof DOMException
          ? 'เข้าถึงไมโครโฟนไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง'
          : caught instanceof Error
            ? caught.message
            : 'เริ่มอัดเสียงไม่สำเร็จ',
      );
    }
  }, [stop, teardown]);

  return { recording, elapsed, levels, error, start, stop };
}

/// แถบระหว่างอัด: ถังขยะ · จุดแดง + เวลา · คลื่นเสียง · ส่ง
export function RecordingBar({
  elapsed,
  levels,
  onCancel,
  onSend,
}: {
  elapsed: number;
  levels: number[];
  onCancel: () => void;
  onSend: () => void;
}) {
  const bars = [...Array.from({ length: Math.max(0, 40 - levels.length) }, () => 0), ...levels];

  return (
    <div
      role="group"
      aria-label="กำลังอัดข้อความเสียง"
      className="flex min-h-11 flex-1 items-center gap-2 animate-in fade-in-0 duration-150"
    >
      <button
        type="button"
        onClick={onCancel}
        className="h-9 shrink-0 rounded-full px-2 text-sm font-semibold text-destructive hover:bg-accent"
      >
        ยกเลิก
      </button>

      <span className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums">
        <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-destructive" />
        <span aria-live="off">{formatDuration(elapsed)}</span>
        <span className="sr-only"> จาก {formatDuration(VOICE_MAX_MS)}</span>
      </span>

      <span aria-hidden className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden">
        {bars.map((level, index) => (
          <span
            key={index}
            className="w-[3px] shrink-0 rounded-full bg-link"
            style={{ height: `${Math.max(12, level * 100)}%`, opacity: level ? 1 : 0.35 }}
          />
        ))}
      </span>

      <button
        type="button"
        onClick={onSend}
        className="h-9 shrink-0 px-2 text-[15px] font-semibold text-link hover:text-foreground"
      >
        ส่ง
      </button>
    </div>
  );
}

/// ฟองข้อความเสียง: ปุ่มเล่น · แถบความคืบหน้า · ความยาว
export function VoiceMessage({
  attachment,
  mine,
}: {
  attachment: MessageAttachment;
  mine: boolean;
}) {
  const { url, error } = useAssetUrl(attachment.id);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);

  /// **webm ที่ MediaRecorder อัดไม่มีความยาวในหัวไฟล์** — Chrome รายงาน
  /// duration = Infinity จนกว่าจะเล่นจบ ฟองจึงขึ้น "∞:NaN" ถ้าเชื่อตามนั้น
  /// ทางแก้มาตรฐาน: กระโดดไปท้ายไฟล์หนึ่งครั้งให้เบราว์เซอร์ไล่หาความยาวจริง
  /// แล้วค่อยกลับมาต้นไฟล์
  function readDuration(audio: HTMLAudioElement) {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);

      return;
    }

    const settle = () => {
      if (!Number.isFinite(audio.duration)) return;

      audio.removeEventListener('durationchange', settle);
      setDuration(audio.duration);
      audio.currentTime = 0;
    };

    audio.addEventListener('durationchange', settle);
    audio.currentTime = 1e7;
  }

  const tone = mine ? 'bg-[var(--bubble-mine)] text-white' : 'bg-[var(--bubble-theirs)] text-foreground';
  const progress = duration ? Math.min(1, position / duration) : 0;

  return (
    <div className={`flex w-60 max-w-full items-center gap-2.5 rounded-[22px] px-2 py-1.5 ${tone}`}>
      <button
        type="button"
        disabled={!url}
        onClick={() => {
          const audio = audioRef.current;

          if (!audio) return;
          if (audio.paused) void audio.play().catch(() => undefined);
          else audio.pause();
        }}
        aria-label={playing ? 'หยุดข้อความเสียง' : 'เล่นข้อความเสียง'}
        className={`grid size-8 shrink-0 place-items-center rounded-full disabled:opacity-50 ${
          mine ? 'bg-white text-[var(--bubble-mine)]' : 'bg-foreground text-background'
        }`}
      >
        {!url && !error ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : playing ? (
          <Pause aria-hidden className="size-4 fill-current" />
        ) : (
          <Play aria-hidden className="ml-0.5 size-4 fill-current" />
        )}
      </button>

      <span
        role="progressbar"
        aria-label="ความคืบหน้าของข้อความเสียง"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className={`relative h-1 min-w-0 flex-1 overflow-hidden rounded-full ${mine ? 'bg-white/35' : 'bg-foreground/20'}`}
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${mine ? 'bg-white' : 'bg-foreground'}`}
          style={{ width: `${progress * 100}%` }}
        />
      </span>

      <span className="w-9 shrink-0 text-right text-xs tabular-nums opacity-80">
        {error ? '—' : formatDuration(((playing || position > 0 ? position : duration) ?? 0) * 1000)}
      </span>

      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onLoadedMetadata={(event) => readDuration(event.currentTarget)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            // ระหว่างไล่หาความยาวจริง (กระโดดไปท้ายไฟล์) ไม่ใช่การเล่น — อย่าขยับแถบ
            if (duration !== null) setPosition(event.currentTarget.currentTime);
          }}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
        >
          <track kind="captions" label="ข้อความเสียง (ไม่มีคำบรรยาย)" />
        </audio>
      )}

      {error && <span className="sr-only">เปิดข้อความเสียงไม่ได้: {error}</span>}
    </div>
  );
}
