'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  MonitorUp,
  MonitorX,
  Minus,
  X,
} from 'lucide-react';
import { UserName } from '@/components/csmju/user-name';

/// จอที่กำลังแชร์ — แบบเดียวกับ Discord
///
/// **บั๊กที่ตัวนี้แก้เป็นอย่างแรก: ผู้แชร์ไม่เห็นว่าตัวเองแชร์อะไรอยู่**
///
/// ของเดิมเรนเดอร์เฉพาะตอน `presenter !== me.id` คนที่กดแชร์จึงเห็นแค่ปุ่ม
/// เปลี่ยนเป็น "หยุดแชร์หน้าจอ" แล้วต้องเชื่อใจว่าเลือกจอถูก — ซึ่งเป็น
/// สาเหตุอันดับหนึ่งของอุบัติเหตุแชร์ผิดจอ (แชร์ทั้งเดสก์ท็อปทั้งที่ตั้งใจ
/// แชร์แค่หน้าต่างเดียว แล้วอีเมลหรือแชทส่วนตัวโผล่ให้คนทั้งห้องเห็น)
///
/// บั๊กที่สอง: ของเดิมใส่ stream เดียวกับที่ `RemoteAudio` เล่นอยู่ลงใน
/// `<video>` โดยไม่ได้ใส่ `muted` เสียงของผู้แชร์จึงดังสองรอบซ้อนกัน

export type StageSize = 'mini' | 'normal' | 'full';

interface Props {
  stream: MediaStream | null;
  /// `null` = เป็นจอของเราเอง
  presenterCoreUserId: string | null;
  /// ผู้แชร์กดหยุดได้จากตรงนี้เลย ไม่ต้องเลื่อนไปหาปุ่มข้างล่าง
  onStopSharing?: () => void;
  /// วางซ้อนในกล่องของผู้เรียกแทนการลอยเองที่มุมจอ
  ///
  /// **จำเป็นเวลามีแผงอื่นลอยอยู่มุมเดียวกัน** — แผงควบคุมสายโทรยึด
  /// `bottom-4 right-4` เหมือนกัน สองอันจึงทับกันจนกดปุ่มของกันและกันไม่ได้
  /// ในสายโทรเราจึงเรียงมันไว้เหนือแผงควบคุมในคอลัมน์เดียวกันแทน
  inline?: boolean;
  /// ภาพนี้คืออะไร — ใช้เลือกคำที่บอกผู้ใช้
  ///
  /// สายหนึ่งเส้นส่งภาพได้ทางเดียว จึงเป็นจอหรือกล้องอย่างใดอย่างหนึ่ง
  /// ถ้าเรียกทุกอย่างว่า "หน้าจอ" ผู้ใช้ที่เปิดกล้องจะเห็นคำว่า
  /// "กำลังแชร์หน้าจอ" ทับหน้าตัวเอง ซึ่งอ่านแล้วน่าตกใจ
  kind?: 'screen' | 'camera';
}

/// คำที่ใช้เรียกภาพแต่ละแบบ รวมไว้ที่เดียวเพื่อไม่ให้หลุดไม่ตรงกัน
const WORDS = {
  screen: {
    region: 'จอที่กำลังแชร์',
    mine: 'คุณกำลังแชร์หน้าจอนี้',
    minePlayer: 'หน้าจอที่คุณกำลังแชร์',
    theirsSuffix: 'กำลังแชร์หน้าจอ',
    theirsPlayer: 'หน้าจอที่อีกฝ่ายกำลังแชร์',
    mineHidden: 'คุณกำลังแชร์หน้าจอ',
    theirsHidden: 'มีคนกำลังแชร์หน้าจอ',
    stop: 'หยุดแชร์หน้าจอ',
  },
  camera: {
    region: 'ภาพจากกล้อง',
    mine: 'กล้องของคุณเปิดอยู่',
    minePlayer: 'ภาพจากกล้องของคุณ',
    theirsSuffix: 'เปิดกล้องอยู่',
    theirsPlayer: 'ภาพจากกล้องของอีกฝ่าย',
    mineHidden: 'กล้องของคุณเปิดอยู่',
    theirsHidden: 'อีกฝ่ายเปิดกล้องอยู่',
    stop: 'ปิดกล้อง',
  },
} as const;

const SIZE_CLASS: Record<Exclude<StageSize, 'full'>, string> = {
  mini: 'w-64',
  normal: 'w-[min(32rem,calc(100vw-2rem))]',
};

export function ScreenStage({
  stream,
  presenterCoreUserId,
  onStopSharing,
  inline = false,
  kind = 'screen',
}: Props) {
  const words = WORDS[kind];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<StageSize>('normal');
  const [hidden, setHidden] = useState(false);

  const isMine = presenterCoreUserId === null;

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    // ตั้งเป็น null ตอนไม่มี stream ด้วย ไม่งั้นเฟรมสุดท้ายจะค้างบนจอ
    // หลังคนแชร์หยุดไปแล้ว — ผู้ชมจะนึกว่ายังแชร์อยู่
    video.srcObject = stream;
  }, [stream]);

  /// ออกจากโหมดเต็มจอเมื่อผู้ใช้กด Esc หรือออกทางอื่น
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) {
        setSize((current) => (current === 'full' ? 'normal' : current));
      }
    };

    document.addEventListener('fullscreenchange', sync);

    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFull = useCallback(() => {
    const frame = frameRef.current;

    if (!frame) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);

      return;
    }

    // เบราว์เซอร์บางตัวปฏิเสธถ้าไม่ได้มาจากการกดของผู้ใช้ — ล้มแล้วก็แค่
    // ไม่เต็มจอ ไม่ควรทำให้ทั้งหน้าพัง
    void frame
      .requestFullscreen()
      .then(() => setSize('full'))
      .catch(() => undefined);
  }, []);

  if (!stream) return null;

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className={`csmju-surface z-40 flex items-center gap-2 px-3 py-2 text-csmju-label shadow-csmju-lg ${
          inline
            ? 'mb-2 w-full justify-center'
            : 'fixed bottom-24 right-4 lg:bottom-4'
        }`}
      >
        <MonitorUp aria-hidden className="size-4 text-primary" />
        {isMine ? words.mineHidden : words.theirsHidden}
      </button>
    );
  }

  return (
    <section
      ref={frameRef}
      // ตั้งชื่อให้ทั้งกรอบ เพราะปุ่ม "หยุดแชร์หน้าจอ" มีทั้งบนกรอบนี้และบน
      // แถบควบคุมข้างล่าง — ชื่อซ้ำกันสองปุ่มโดยไม่มีอะไรคั่น ผู้ใช้โปรแกรม
      // อ่านหน้าจอจะแยกไม่ออกว่ากำลังอยู่ตรงไหนของหน้า
      aria-label={words.region}
      // ลอยอยู่มุมขวาล่างเหมือน Discord — ไม่ใช่ modal ที่บังทั้งหน้า
      // เพราะระหว่างดูจอคนอื่น ผู้ใช้ยังต้องพิมพ์แชทและดูรายชื่อคนในห้องได้
      className={
        size === 'full'
          ? 'fixed inset-0 z-50 flex flex-col bg-black'
          : inline
            ? 'csmju-surface mb-2 w-full overflow-hidden shadow-csmju-lg'
            : `csmju-surface fixed bottom-24 right-4 z-40 overflow-hidden shadow-csmju-lg lg:bottom-4 ${SIZE_CLASS[size]}`
      }
    >
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 ${
          size === 'full'
            ? 'bg-black/80 text-white'
            : 'border-b border-border bg-card'
        }`}
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive"
        />

        <span className="min-w-0 flex-1 truncate text-csmju-caption">
          {isMine ? (
            <span className="font-medium text-primary">{words.mine}</span>
          ) : (
            <>
              <UserName coreUserId={presenterCoreUserId} /> {words.theirsSuffix}
            </>
          )}
        </span>

        {isMine && onStopSharing && (
          <button
            type="button"
            onClick={onStopSharing}
            aria-label={words.stop}
            title={words.stop}
            className="grid size-6 place-items-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
          >
            <MonitorX aria-hidden className="size-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setSize(size === 'mini' ? 'normal' : 'mini')}
          aria-label={size === 'mini' ? 'ขยายจอ' : 'ย่อจอ'}
          title={size === 'mini' ? 'ขยายจอ' : 'ย่อจอ'}
          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {size === 'mini' ? (
            <Maximize2 aria-hidden className="size-3.5" />
          ) : (
            <Minus aria-hidden className="size-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={toggleFull}
          aria-label={size === 'full' ? 'ออกจากเต็มจอ' : 'ดูเต็มจอ'}
          title={size === 'full' ? 'ออกจากเต็มจอ' : 'ดูเต็มจอ'}
          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {size === 'full' ? (
            <Minimize2 aria-hidden className="size-3.5" />
          ) : (
            <Maximize2 aria-hidden className="size-3.5" />
          )}
        </button>

        {size !== 'full' && (
          <button
            type="button"
            onClick={() => setHidden(true)}
            aria-label="ซ่อนจอที่แชร์"
            title="ซ่อนจอที่แชร์"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      {/* จอที่แชร์สดไม่มีคำบรรยายให้ใส่ — ข้อความอธิบายว่าใครกำลังแชร์
          อยู่ในแถบหัวข้างบน และ `aria-label` ข้างล่างบอกซ้ำให้เครื่องอ่านหน้าจอ */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // **ต้อง muted เสมอ**
        //
        // จอของเราเอง: ไม่งั้นเสียงจากเครื่องตัวเองวนกลับเข้าไมค์
        // จอคนอื่น: เสียงของเขาถูกเล่นโดย <RemoteAudio> อยู่แล้ว ใส่ซ้ำ
        //           ที่นี่จะได้ยินเป็นสองเสียงซ้อนกัน (บั๊กเดิม)
        muted
        aria-label={isMine ? words.minePlayer : words.theirsPlayer}
        className={`bg-black object-contain ${
          size === 'full' ? 'min-h-0 w-full flex-1' : 'aspect-video w-full'
        } ${
          // กล้องของตัวเองต้องกลับด้านซ้ายขวา ไม่งั้นขยับมือขวาแล้วเห็นมือซ้าย
          // ขยับ ซึ่งสับสนจนใช้ไม่ได้ (จอที่แชร์ห้ามกลับ เพราะตัวหนังสือจะอ่านไม่ออก)
          kind === 'camera' && isMine ? '-scale-x-100' : ''
        }`}
      />
    </section>
  );
}
