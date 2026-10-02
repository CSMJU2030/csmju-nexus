'use client';

import { useCallback, useId, useRef, useState } from 'react';
import {
  FileArchive,
  FileCode,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Video,
  X,
} from 'lucide-react';
import {
  ACCEPTED_UPLOAD_TYPES,
  formatBytes,
  uploadFile,
  type AssetBucket,
  type UploadedAsset,
} from '@/lib/csmju/upload';

/// การแนบไฟล์ของช่องพิมพ์ข้อความ
///
/// **หลังบ้านรับไฟล์แนบมาตั้งแต่ต้น แต่หน้าบ้านไม่เคยมีปุ่มให้แนบ** —
/// ความสามารถทั้งชุด (รูป · GIF · วิดีโอ · PDF · Word · ZIP) จึงเข้าถึงไม่ได้
/// จากหน้าจอเลย ทั้งในห้องกลุ่มและแชทส่วนตัว
///
/// แยกเป็น hook เพราะช่องพิมพ์วางปุ่มกับแถวไฟล์คนละที่ (ปุ่มอยู่ในแถวเดียวกับ
/// ช่องพิมพ์ ส่วนแถวไฟล์อยู่เหนือขึ้นไป) ถ้าทำเป็นคอมโพเนนต์เดียวที่คุมทั้ง
/// เลย์เอาต์ หน้าที่มีช่องพิมพ์คนละทรงจะใช้ซ้ำไม่ได้
///
/// อัปโหลดทันทีที่เลือก ไม่รอตอนกดส่ง เพราะไฟล์ 40 MB ใช้เวลาหลายวินาที
/// ถ้าไปรออัปตอนกดส่ง ผู้ใช้จะเห็นปุ่มค้างโดยไม่รู้ว่าเกิดอะไรขึ้น

export interface PendingUpload {
  /// กุญแจชั่วคราวระหว่างอัปโหลด ยังไม่มี assetId
  key: string;
  fileName: string;
  step: string;
  error?: string;
}

function KindIcon({ kind, className }: { kind: string; className: string }) {
  if (kind === 'IMAGE') return <ImageIcon className={className} />;
  if (kind === 'VIDEO') return <Video className={className} />;
  if (kind === 'ARCHIVE') return <FileArchive className={className} />;
  if (kind === 'CODE') return <FileCode className={className} />;

  return <FileText className={className} />;
}

export function useAttachments({
  bucket = 'attachments',
  max = 10,
}: { bucket?: AssetBucket; max?: number } = {}) {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prefix = useId();
  const counter = useRef(0);

  const pick = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      // ตัดให้พอดีเพดานตั้งแต่ต้น แทนการเช็คในลูป — ผู้ใช้ลากมาห้าสิบไฟล์
      // แล้วเห็นมันทยอยขึ้นแล้วหายไปครึ่งทาง จะงงกว่าเห็นว่ารับแค่บางส่วน
      const room = Math.max(0, max - assets.length - pending.length);
      const chosen = Array.from(files).slice(0, room);

      // **ต้องคัดลอกรายชื่อไฟล์ออกมาก่อน แล้วค่อยล้างช่อง**
      //
      // `files` ที่ส่งเข้ามาคือ FileList ตัวเป็น ๆ ของ <input> ไม่ใช่สำเนา
      // การตั้ง `input.value = ''` ล้าง `input.files` ทิ้งด้วย ถ้าล้างก่อนอ่าน
      // จะได้รายการว่างทุกครั้ง — ผลคือกดแนบแล้ว "ไม่มีอะไรเกิดขึ้นเลย"
      // ไม่มี error ไม่มีแถวไฟล์ ไม่มีคำขอวิ่งออกไป
      //
      // ที่ต้องล้างเพราะถ้าไม่ล้าง ผู้ใช้เลือกไฟล์ชื่อเดิมซ้ำแล้ว onChange
      // จะไม่ยิงอีกเลย ซึ่งก็ดูเหมือนปุ่มเสียเหมือนกัน
      const input = inputRef.current;

      if (input) input.value = '';

      for (const file of chosen) {
        counter.current += 1;

        const key = `${prefix}-${counter.current}`;

        setPending((rows) => [
          ...rows,
          { key, fileName: file.name, step: 'กำลังเริ่ม…' },
        ]);

        try {
          const asset = await uploadFile(file, bucket, (step) =>
            setPending((rows) =>
              rows.map((row) => (row.key === key ? { ...row, step } : row)),
            ),
          );

          setPending((rows) => rows.filter((row) => row.key !== key));

          // **ต้องต่อท้ายด้วยฟังก์ชัน** ไม่ใช่ `[...assets, asset]`
          //
          // ลูปนี้อัปหลายไฟล์ติดกัน ถ้าอ่าน `assets` จาก closure จะได้ค่าของ
          // รอบวาดก่อนหน้าเสมอ ไฟล์ที่อัปเสร็จก่อนจะถูกทับหายทีละตัวจนเหลือ
          // แค่ไฟล์สุดท้าย — และเป็นบั๊กที่เห็นเฉพาะตอนแนบทีเดียวหลายไฟล์
          setAssets((rows) => [...rows, asset]);
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : 'อัปโหลดไม่สำเร็จ';

          setPending((rows) =>
            rows.map((row) =>
              row.key === key ? { ...row, step: '', error: message } : row,
            ),
          );
        }
      }
    },
    [assets.length, pending.length, bucket, max, prefix],
  );

  const remove = useCallback((assetId: string) => {
    setAssets((rows) => rows.filter((row) => row.assetId !== assetId));
  }, []);

  const dismiss = useCallback((key: string) => {
    setPending((rows) => rows.filter((row) => row.key !== key));
  }, []);

  const clear = useCallback(() => {
    setAssets([]);
    setPending([]);
  }, []);

  return {
    assets,
    pending,
    /// ยังมีไฟล์ที่อัปไม่เสร็จ — ห้ามส่งข้อความระหว่างนี้ ไม่งั้นไฟล์จะหลุด
    uploading: pending.some((row) => !row.error),
    full: assets.length + pending.length >= max,
    max,
    inputRef,
    pick,
    remove,
    dismiss,
    clear,
  };
}

type Attachments = ReturnType<typeof useAttachments>;

/// ปุ่มคลิปหนีบกระดาษ พร้อมช่องเลือกไฟล์ที่ซ่อนอยู่
export function AttachmentButton({
  attachments,
  disabled = false,
}: {
  attachments: Attachments;
  disabled?: boolean;
}) {
  const { inputRef, pick, full, max } = attachments;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_UPLOAD_TYPES}
        className="sr-only"
        // ช่องนี้ถูกซ่อนด้วย sr-only ไม่ใช่ display:none เพื่อให้ยังโฟกัสด้วย
        // คีย์บอร์ดและอ่านด้วยโปรแกรมอ่านหน้าจอได้
        aria-label="เลือกไฟล์ที่จะแนบ"
        onChange={(event) => void pick(event.target.files)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || full}
        aria-label="แนบไฟล์"
        title={full ? `แนบได้สูงสุด ${max} ไฟล์ต่อข้อความ` : 'แนบไฟล์'}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
      >
        <Paperclip className="size-4" />
      </button>
    </>
  );
}

/// แถวไฟล์ที่แนบไว้แล้วและที่กำลังอัป
export function AttachmentTray({ attachments }: { attachments: Attachments }) {
  const { assets, pending, remove, dismiss } = attachments;

  if (assets.length === 0 && pending.length === 0) return null;

  return (
    <ul
      aria-label="ไฟล์ที่แนบไว้"
      className="mb-2 flex flex-wrap gap-1.5"
    >
      {assets.map((asset) => (
        <li
          key={asset.assetId}
          className="flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1"
        >
          <KindIcon
            kind={asset.kind}
            className="size-3.5 shrink-0 text-muted-foreground"
          />

          <span
            className="min-w-0 flex-1 truncate text-xs"
            title={asset.fileName}
          >
            {asset.fileName}
          </span>

          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatBytes(asset.sizeBytes)}
          </span>

          <button
            type="button"
            onClick={() => remove(asset.assetId)}
            aria-label={`เอา ${asset.fileName} ออก`}
            className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </li>
      ))}

      {pending.map((row) => (
        <li
          key={row.key}
          className={`flex max-w-[16rem] items-center gap-1.5 rounded-lg border px-2 py-1 ${
            row.error
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border bg-card'
          }`}
        >
          {row.error ? (
            <X aria-hidden className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <Loader2
              aria-hidden
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
          )}

          <span className="min-w-0 flex-1 truncate text-xs" title={row.fileName}>
            {row.fileName}
          </span>

          <span
            className={`shrink-0 text-[11px] ${
              row.error ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {row.error ?? row.step}
          </span>

          {row.error && (
            <button
              type="button"
              onClick={() => dismiss(row.key)}
              aria-label={`ปิดข้อความผิดพลาดของ ${row.fileName}`}
              className="grid size-4 shrink-0 place-items-center rounded text-destructive transition-colors hover:bg-destructive/10"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
