'use client';

import { useEffect, useState } from 'react';

/// ของเบ็ดเตล็ดด้านสื่อของการโทร: แยกภาพกล้อง/ภาพจอ · ตัววัดระดับไมค์ ·
/// เสียงทดสอบลำโพง

// ────────────────────────────────────────────────────────────
// สถานะที่ส่งหากันผ่าน data channel
// ────────────────────────────────────────────────────────────

/// สิ่งที่แต่ละฝ่ายประกาศให้อีกฝ่ายรู้ — ส่งผ่าน RTCDataChannel ของสายนั้นเอง
///
/// **ทำไมต้องประกาศเอง:** ปิดไมค์ด้วย `track.enabled = false` ไม่ได้ทำให้
/// ฝั่งรับรู้อะไรเลย (เบราว์เซอร์ส่งความเงียบไปแทน แทร็กฝั่งโน้นไม่ได้ `mute`)
/// ไอคอน "ปิดไมค์" บนช่องของแต่ละคนจึงทำจากสัญญาณเสียงไม่ได้
///
/// `camera` / `screen` คือ id ของ MediaStream ที่ใช้ตอน addTrack ซึ่ง
/// เดินทางไปถึงอีกฝั่งใน SDP (msid) — ใช้บอกว่าภาพที่วิ่งมาเส้นไหนคือกล้อง
/// เส้นไหนคือจอ จึงเปิดกล้องพร้อมแชร์จอได้โดยปลายทางไม่สับสน
export interface PeerMediaState {
  muted: boolean;
  camera: string | null;
  screen: string | null;
}

export function encodeMediaState(state: PeerMediaState): string {
  return JSON.stringify({ t: 'state', ...state });
}

export function decodeMediaState(raw: unknown): PeerMediaState | null {
  if (typeof raw !== 'string') return null;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;

    if (value.t !== 'state') return null;

    return {
      muted: value.muted === true,
      camera: typeof value.camera === 'string' ? value.camera : null,
      screen: typeof value.screen === 'string' ? value.screen : null,
    };
  } catch {
    return null;
  }
}

export interface VideoLike {
  id: string;
}

/// ภาพที่วิ่งมาจากอีกฝ่าย เส้นไหนคือกล้อง เส้นไหนคือจอ
///
/// เชื่อสิ่งที่เขาประกาศก่อน ถ้ายังไม่ได้ประกาศ (data channel ยังไม่เปิด หรือ
/// อีกฝั่งเป็นแอปรุ่นเก่า) ค่อยเดาจากสิทธิ์แชร์จอของห้อง: ถือสิทธิ์อยู่ = จอ
export function classifyVideo<T extends VideoLike>(
  streams: readonly T[],
  state: PeerMediaState | null,
  holdsScreen: boolean,
): { camera: T | null; screen: T | null } {
  let camera: T | null = null;
  let screen: T | null = null;
  const unknown: T[] = [];

  for (const stream of streams) {
    if (state?.screen && stream.id === state.screen) screen = stream;
    else if (state?.camera && stream.id === state.camera) camera = stream;
    else unknown.push(stream);
  }

  for (const stream of unknown) {
    if (holdsScreen && !screen) screen = stream;
    else if (!camera) camera = stream;
  }

  return { camera, screen };
}

// ────────────────────────────────────────────────────────────
// ตัววัดระดับไมค์
// ────────────────────────────────────────────────────────────

type AudioContextCtor = typeof AudioContext;

function audioContextClass(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;

  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ??
    null
  );
}

/// ระดับเสียงของไมค์ตอนนี้ 0–1 (Web Audio AnalyserNode)
///
/// ปิด AudioContext ทุกครั้งที่ stream เปลี่ยนหรือเลิกใช้ — เบราว์เซอร์จำกัด
/// จำนวน context ต่อหน้า ถ้าไม่ปิด เปิดกล่องตั้งค่าไม่กี่รอบก็สร้างไม่ได้อีก
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const Context = audioContextClass();

    if (!stream || !Context || stream.getAudioTracks().length === 0) return;

    const context = new Context();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    analyser.fftSize = 512;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(samples);

      let sum = 0;

      for (const sample of samples) {
        const centred = (sample - 128) / 128;

        sum += centred * centred;
      }

      // RMS ของเสียงพูดปกติอยู่ราว 0.02–0.2 — ขยายให้แถบขยับเห็นได้
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => undefined);
      setLevel(0);
    };
  }, [stream]);

  return level;
}

// ────────────────────────────────────────────────────────────
// เสียงทดสอบลำโพง
// ────────────────────────────────────────────────────────────

export const TEST_TONE_SECONDS = 12;

/// เสียงกริ่งสองโน้ตซ้ำ ๆ — สร้างสดด้วย Web Audio ไม่ต้องมีไฟล์เสียง
///
/// ส่งผ่าน `<audio>` ที่ `setSinkId` ได้ ไม่ใช่ต่อเข้า `context.destination`
/// ตรง ๆ เพราะทางนั้นดังออกลำโพงหลักของระบบเสมอ ผู้ใช้ที่เลือกหูฟังไว้จะได้ยิน
/// เสียงทดสอบจากลำโพงเครื่องแทน ซึ่งทำให้ปุ่มนี้ทดสอบผิดอุปกรณ์
export function playTestTone(options: {
  sinkId: string | null;
  onTick: (remainingSec: number) => void;
  onEnd: () => void;
}): () => void {
  const Context = audioContextClass();

  if (!Context) {
    options.onEnd();

    return () => undefined;
  }

  const context = new Context();
  const output = context.createMediaStreamDestination();
  const audio = new Audio();
  const start = context.currentTime + 0.05;

  // โน้ต E5 กับ C5 สลับกันทุก 0.75 วินาทีตลอด 12 วินาที
  for (let beat = 0; beat < TEST_TONE_SECONDS / 0.75; beat += 1) {
    const at = start + beat * 0.75;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = beat % 2 === 0 ? 659.25 : 523.25;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
    oscillator.connect(gain).connect(output);
    oscillator.start(at);
    oscillator.stop(at + 0.65);
  }

  audio.srcObject = output.stream;

  let remaining = TEST_TONE_SECONDS;
  let stopped = false;

  const timer = window.setInterval(() => {
    remaining -= 1;
    options.onTick(remaining);

    if (remaining <= 0) stop();
  }, 1000);

  function stop() {
    if (stopped) return;

    stopped = true;
    window.clearInterval(timer);
    audio.pause();
    audio.srcObject = null;
    void context.close().catch(() => undefined);
    options.onEnd();
  }

  const sink = audio as HTMLAudioElement & {
    setSinkId?: (id: string) => Promise<void>;
  };

  void (async () => {
    try {
      if (options.sinkId && sink.setSinkId) await sink.setSinkId(options.sinkId);
      if (!stopped) await audio.play();
    } catch {
      stop();
    }
  })();

  options.onTick(remaining);

  return stop;
}

// ────────────────────────────────────────────────────────────
// ใครกำลังพูด (วงเขียวรอบรูปแบบ Discord)
// ────────────────────────────────────────────────────────────

/// ระดับ RMS ที่ถือว่า "พูดอยู่" และเวลาที่ค้างวงไว้หลังเงียบ (กันวงกะพริบระหว่างคำ)
const SPEAKING_RMS = 0.02;
const SPEAKING_HOLD_MS = 350;

/// เฝ้าดูหลายสตรีมพร้อมกันด้วย AudioContext ตัวเดียว
///
/// ตัวเดียวทั้งห้อง ไม่ใช่ตัวละคน — เบราว์เซอร์จำกัดจำนวน context ต่อหน้า
/// ห้อง 8 คนที่เปิดคนละตัวจะเริ่มสร้างไม่ได้ แล้ววงของบางคนก็ไม่ขึ้นเฉย ๆ
export class SpeakingMonitor {
  private context: AudioContext | null = null;
  private readonly watched = new Map<
    string,
    { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; lastLoud: number }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private speaking = new Set<string>();

  constructor(private readonly onChange: (speaking: ReadonlySet<string>) => void) {}

  watch(id: string, stream: MediaStream | null) {
    const current = this.watched.get(id);

    if (current?.stream === stream) return;

    this.unwatch(id);

    const Context = audioContextClass();

    if (!stream || !Context || stream.getAudioTracks().length === 0) return;

    this.context ??= new Context();

    const source = this.context.createMediaStreamSource(stream);
    const analyser = this.context.createAnalyser();

    analyser.fftSize = 512;
    source.connect(analyser);
    this.watched.set(id, { stream, source, analyser, lastLoud: 0 });

    this.timer ??= setInterval(() => this.tick(), 120);
  }

  unwatch(id: string) {
    const current = this.watched.get(id);

    if (!current) return;

    current.source.disconnect();
    this.watched.delete(id);

    if (this.speaking.delete(id)) this.onChange(new Set(this.speaking));
  }

  close() {
    for (const id of [...this.watched.keys()]) this.unwatch(id);

    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private tick() {
    const now = Date.now();
    const next = new Set<string>();

    for (const [id, entry] of this.watched) {
      const samples = new Uint8Array(entry.analyser.fftSize);

      entry.analyser.getByteTimeDomainData(samples);

      let sum = 0;

      for (const sample of samples) {
        const centred = (sample - 128) / 128;

        sum += centred * centred;
      }

      // แทร็กที่ปิดไว้ (enabled = false) ส่งความเงียบมาอยู่แล้ว ไม่ต้องเช็กแยก
      if (Math.sqrt(sum / samples.length) > SPEAKING_RMS) entry.lastLoud = now;
      if (now - entry.lastLoud < SPEAKING_HOLD_MS) next.add(id);
    }

    const changed =
      next.size !== this.speaking.size || [...next].some((id) => !this.speaking.has(id));

    if (changed) {
      this.speaking = next;
      this.onChange(new Set(next));
    }
  }
}
