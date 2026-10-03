'use client';

import { useState } from 'react';
import {
  Download,
  FileArchive,
  FileCode,
  FileText,
  Loader2,
  Play,
  X,
} from 'lucide-react';
import { useAssetUrl } from '@/lib/csmju/asset-url';
import { formatBytes } from '@/lib/csmju/upload';
import type { MessageAttachment } from '@/lib/csmju/types';

/// ไฟล์แนบในข้อความ
///
/// ของเดิมหลังบ้านเก็บไฟล์แนบได้และส่งมากับข้อความอยู่แล้ว แต่หน้าบ้าน
/// **ไม่เคยเรนเดอร์มันเลย** — ส่งไฟล์เข้าไปได้แต่ไม่มีใครเห็น
///
/// กฎการแสดงผลตามชนิด:
///
///   รูปภาพ (รวม GIF) → เห็นภาพเลย กดเพื่อดูเต็มจอ
///   วิดีโอ           → ตัวเล่นพร้อม controls แต่ไม่เล่นอัตโนมัติ
///   เอกสาร/ไฟล์อื่น  → การ์ดพร้อมชื่อ ขนาด และปุ่มดาวน์โหลด
///
/// ที่ไม่เล่นวิดีโออัตโนมัติเพราะห้องแชทหนึ่งห้องมีคลิปได้หลายสิบคลิป
/// เปิดพร้อมกันหมดคือกินเน็ตผู้ใช้ทิ้งเปล่า ๆ และเสียงจะดังซ้อนกัน

function KindIcon({ kind, className }: { kind: string; className: string }) {
  if (kind === 'ARCHIVE') return <FileArchive className={className} />;
  if (kind === 'CODE') return <FileCode className={className} />;

  return <FileText className={className} />;
}

/// รูปที่กดดูเต็มจอได้
function ImageAttachment({ file }: { file: MessageAttachment }) {
  const { url, error } = useAssetUrl(file.id);
  const [zoomed, setZoomed] = useState(false);

  if (error) return <FileCard file={file} note={error} />;

  if (!url) {
    return (
      <div className="grid aspect-video w-full max-w-xs place-items-center rounded-lg border border-border bg-muted">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="block overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-90"
      >
        {/* ใช้ <img> ไม่ใช่ next/image เพราะ URL เป็น signed URL ที่เปลี่ยน
          * ทุกสองนาที การให้ next/image ไปดึงมาแปลงจะทำให้แคชของมันพลาด
          * ตลอดเวลา และเสียโควตาแปลงภาพไปเปล่า ๆ */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={file.fileName}
          className="max-h-64 w-auto max-w-full object-contain"
        />
      </button>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={file.fileName}
          className="fixed inset-0 z-100 grid place-items-center bg-black/90 p-4"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={file.fileName}
            className="max-h-full max-w-full object-contain"
          />

          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="ปิด"
            className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
    </>
  );
}

/// วิดีโอ — โหลดตัวเล่นเมื่อกดเท่านั้น
function VideoAttachment({ file }: { file: MessageAttachment }) {
  const [playing, setPlaying] = useState(false);
  const { url, error } = useAssetUrl(playing ? (file.id) : null);

  if (error) return <FileCard file={file} note={error} />;

  if (!playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="flex w-full max-w-xs items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Play className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {file.fileName}
          </span>
          <span className="block text-xs text-muted-foreground">
            วิดีโอ · {formatBytes(file.sizeBytes)}
          </span>
        </span>
      </button>
    );
  }

  return url ? (
    <video
      src={url}
      controls
      autoPlay
      playsInline
      aria-label={file.fileName}
      className="max-h-64 w-full max-w-xs rounded-lg border border-border bg-black"
    />
  ) : (
    <div className="grid aspect-video w-full max-w-xs place-items-center rounded-lg border border-border bg-muted">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  );
}

/// เอกสารและไฟล์อื่น — ดาวน์โหลดอย่างเดียว
function FileCard({
  file,
  note,
}: {
  file: MessageAttachment;
  note?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);

    try {
      // ขอลิงก์ตอนกด ไม่ใช่ตอนวาด — ลิงก์อายุสองนาที ถ้าขอไว้ล่วงหน้าทุกไฟล์
      // ในห้อง พอผู้ใช้กดจริงมันหมดอายุไปแล้ว และเปลืองคำขอโดยเปล่าประโยชน์
      const { assetUrl } = await import('@/lib/csmju/asset-url');
      const url = await assetUrl(file.id);

      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เปิดไฟล์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs items-center gap-3 rounded-lg border border-border bg-card p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <KindIcon kind={file.kind} className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={file.fileName}>
          {file.fileName}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatBytes(file.sizeBytes)}
          {(note ?? error) ? ` · ${note ?? error}` : ''}
        </span>
      </span>

      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        aria-label={`ดาวน์โหลด ${file.fileName}`}
        className="grid size-8 shrink-0 place-items-center rounded-lg border border-border transition-colors hover:bg-accent disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
      </button>
    </div>
  );
}

export function AttachmentList({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {attachments.map((file) =>
        file.kind === 'IMAGE' ? (
          <ImageAttachment key={file.id} file={file} />
        ) : file.kind === 'VIDEO' ? (
          <VideoAttachment key={file.id} file={file} />
        ) : (
          <FileCard key={file.id} file={file} />
        ),
      )}
    </div>
  );
}
