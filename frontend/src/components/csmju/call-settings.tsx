'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, VideoOff, X } from 'lucide-react';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { VideoView } from '@/components/csmju/call-ui';
import {
  audioConstraints,
  pickDevice,
  videoConstraints,
  type DeviceKind,
  type DeviceMap,
  type DeviceSelection,
} from '@/lib/csmju/call-devices';
import { CALL_SHORTCUTS } from '@/lib/csmju/call-shortcuts';
import {
  playTestTone,
  TEST_TONE_SECONDS,
  useAudioLevel,
} from '@/lib/csmju/call-media';
import { cn } from '@/lib/utils';

/// กล่อง "การตั้งค่า" ของการโทร — แบบ Instagram
///
/// ทุกการเลือกมีผล **ทันที** ไม่ต้องกด "เรียบร้อย" ก่อน: เปลี่ยนไมค์กลางสาย
/// แล้วอีกฝ่ายได้ยินจากไมค์ใหม่เลย (provider ใช้ `replaceTrack` ไม่ต้อง
/// เจรจาใหม่) ปุ่ม "เรียบร้อย" มีไว้ปิดกล่องเท่านั้น
///
/// ภาพตัวอย่างและตัววัดระดับเสียงใช้สตรีมที่อยู่ในสายอยู่แล้วถ้ามี ไม่มีค่อย
/// เปิดสตรีมชั่วคราวของตัวเอง แล้วปิดทิ้งตอนปิดกล่อง — ไม่งั้นไฟกล้องจะ
/// ติดค้างหลังปิดกล่องทั้งที่ผู้ใช้ปิดกล้องไว้

export interface CallSettingsProps {
  devices: DeviceMap;
  cameraAllowed: boolean;
  outputSupported: boolean;
  selection: DeviceSelection;
  onSelect: (kind: DeviceKind, deviceId: string) => void;
  /// กล้องที่เปิดอยู่ในสาย/ห้องรอ — null = ปิดกล้องอยู่
  liveCamera: MediaStream | null;
  /// ไมค์ที่อยู่ในสาย — null = ยังไม่ได้เข้าสาย
  liveMic: MediaStream | null;
  onRequestCamera: () => Promise<void>;
  onHelp: () => void;
  onClose: () => void;
}

export function CallSettingsDialog(props: CallSettingsProps) {
  const {
    devices,
    cameraAllowed,
    outputSupported,
    selection,
    onSelect,
    liveCamera,
    liveMic,
    onRequestCamera,
    onHelp,
    onClose,
  } = props;

  const id = useId();
  const panelRef = useModalFocus<HTMLDivElement>(true, onClose);

  const cameraId = pickDevice(devices.videoinput, selection.videoinput);
  const micId = pickDevice(devices.audioinput, selection.audioinput);
  const outputId = pickDevice(devices.audiooutput, selection.audiooutput);

  const [previewCamera, setPreviewCamera] = useState<MediaStream | null>(null);
  const [previewMic, setPreviewMic] = useState<MediaStream | null>(null);

  // ภาพตัวอย่างกล้องตอนที่ไม่ได้เปิดกล้องอยู่
  useEffect(() => {
    if (liveCamera || !cameraAllowed) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    void navigator.mediaDevices
      ?.getUserMedia({ video: videoConstraints(cameraId), audio: false })
      .then((opened) => {
        if (cancelled) {
          for (const track of opened.getTracks()) track.stop();

          return;
        }

        stream = opened;
        setPreviewCamera(opened);
      })
      .catch(() => setPreviewCamera(null));

    return () => {
      cancelled = true;

      for (const track of stream?.getTracks() ?? []) track.stop();

      setPreviewCamera(null);
    };
  }, [liveCamera, cameraAllowed, cameraId]);

  // ไมค์ชั่วคราวสำหรับตัววัดระดับ — เฉพาะตอนยังไม่ได้อยู่ในสาย
  useEffect(() => {
    if (liveMic) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    void navigator.mediaDevices
      ?.getUserMedia({ audio: audioConstraints(micId), video: false })
      .then((opened) => {
        if (cancelled) {
          for (const track of opened.getTracks()) track.stop();

          return;
        }

        stream = opened;
        setPreviewMic(opened);
      })
      .catch(() => setPreviewMic(null));

    return () => {
      cancelled = true;

      for (const track of stream?.getTracks() ?? []) track.stop();

      setPreviewMic(null);
    };
  }, [liveMic, micId]);

  const level = useAudioLevel(liveMic ?? previewMic);
  const camera = liveCamera ?? previewCamera;

  return createPortal(
    <div className="fixed inset-0 z-110 grid place-items-center bg-black/60 p-4 animate-in fade-in-0">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="flex max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-2xl outline-none animate-in fade-in-0 zoom-in-95"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            การตั้งค่า
          </h2>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* กล้อง */}
          <section aria-labelledby={`${id}-camera`}>
            <h3 id={`${id}-camera`} className="mb-2 text-sm font-semibold">
              กล้อง
            </h3>

            {cameraAllowed || liveCamera ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <DeviceSelect
                  label="เลือกกล้อง"
                  options={devices.videoinput}
                  value={cameraId}
                  onChange={(value) => onSelect('videoinput', value)}
                />

                <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-black sm:w-56">
                  {camera ? (
                    <VideoView stream={camera} mirrored label="ภาพตัวอย่างจากกล้อง" />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-white/50">
                      <VideoOff aria-hidden className="size-6" />
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/80">
                อนุญาตให้ใช้กล้องเพื่อให้คนอื่นๆ มองเห็นคุณได้ ·{' '}
                <button
                  type="button"
                  onClick={() => void onRequestCamera()}
                  className="font-semibold text-link hover:underline"
                >
                  ใช้กล้อง
                </button>
              </p>
            )}
          </section>

          {/* ไมโครโฟน */}
          <section aria-labelledby={`${id}-mic`}>
            <h3 id={`${id}-mic`} className="mb-2 text-sm font-semibold">
              ไมโครโฟน
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <DeviceSelect
                label="เลือกไมโครโฟน"
                options={devices.audioinput}
                value={micId}
                onChange={(value) => onSelect('audioinput', value)}
              />
              <LevelMeter level={level} />
            </div>
          </section>

          {/* เอาต์พุตเสียง — ซ่อนถ้าเบราว์เซอร์เลือกลำโพงไม่ได้ */}
          {outputSupported && devices.audiooutput.length > 0 && (
            <section aria-labelledby={`${id}-output`}>
              <h3 id={`${id}-output`} className="mb-2 text-sm font-semibold">
                เอาต์พุตเสียง
              </h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <DeviceSelect
                  label="เลือกลำโพง"
                  options={devices.audiooutput}
                  value={outputId}
                  onChange={(value) => onSelect('audiooutput', value)}
                />
                <TestSoundButton sinkId={outputId} />
              </div>
            </section>
          )}

          {/* ทางลัดแป้นพิมพ์ */}
          <section aria-labelledby={`${id}-keys`}>
            <h3 id={`${id}-keys`} className="mb-2 text-sm font-semibold">
              ทางลัดแป้นพิมพ์
            </h3>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {CALL_SHORTCUTS.map((shortcut) => (
                <div key={shortcut.action} className="flex items-center justify-between gap-3">
                  <dt className="text-white/80">{shortcut.label}</dt>
                  <dd>
                    <kbd className="rounded-md bg-white/10 px-2 py-0.5 font-sans text-xs text-white">
                      {shortcut.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onHelp}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
          >
            ขอรับความช่วยเหลือ
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            เรียบร้อย
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function DeviceSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: DeviceMap[DeviceKind];
  value: string | null;
  onChange: (deviceId: string) => void;
}) {
  const usable = options.filter((option) => option.deviceId !== '');

  return (
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={usable.length === 0}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-neutral-800 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50"
    >
      {usable.length === 0 && <option value="">ไม่พบอุปกรณ์</option>}
      {usable.map((option) => (
        <option key={option.deviceId} value={option.deviceId}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const METER_SEGMENTS = 12;

function LevelMeter({ level }: { level: number }) {
  const lit = Math.round(level * METER_SEGMENTS);

  return (
    <div
      role="meter"
      aria-label="ระดับเสียงไมโครโฟน"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className="flex h-10 shrink-0 items-center gap-1 sm:w-56"
    >
      {Array.from({ length: METER_SEGMENTS }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-3 flex-1 rounded-full transition-colors duration-75',
            index < lit ? 'bg-primary' : 'bg-white/15',
          )}
        />
      ))}
    </div>
  );
}

function TestSoundButton({ sinkId }: { sinkId: string | null }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [stop, setStop] = useState<(() => void) | null>(null);

  // ปิดกล่องระหว่างเล่น = หยุดเสียง ไม่ปล่อยดังค้างอีกสิบวินาที
  useEffect(() => () => stop?.(), [stop]);

  const playing = remaining !== null;

  function toggle() {
    if (stop) {
      stop();

      return;
    }

    const halt = playTestTone({
      sinkId,
      onTick: setRemaining,
      onEnd: () => {
        setRemaining(null);
        setStop(null);
      },
    });

    setStop(() => halt);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? 'หยุดเสียงทดสอบ' : 'เล่นเสียงทดสอบ'}
      aria-pressed={playing}
      className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20 sm:w-56"
    >
      {playing ? (
        <Square aria-hidden className="size-3.5 fill-current" />
      ) : (
        <Play aria-hidden className="size-3.5 fill-current" />
      )}
      <span aria-hidden className="flex flex-1 items-center justify-center gap-1">
        {Array.from({ length: 3 }, (_, index) => (
          <span
            key={index}
            className={cn(
              'size-1.5 rounded-full bg-white/70',
              playing && 'animate-pulse',
            )}
            style={playing ? { animationDelay: `${index * 150}ms` } : undefined}
          />
        ))}
      </span>
      <span className="tabular-nums text-white/80">
        {remaining ?? TEST_TONE_SECONDS}s
      </span>
    </button>
  );
}
