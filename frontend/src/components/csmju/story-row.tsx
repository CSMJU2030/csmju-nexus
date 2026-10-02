'use client';

import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, User } from 'lucide-react';
import { toast } from '@/components/csmju/feed-toast';
import { StoryTrayViewer } from '@/components/csmju/story-tray-viewer';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { StoryItem, StoryTray } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// แถวสตอรี่บนสุดของฟีด
///
/// ต่อกับ GET /stories ซึ่งคืนสตอรี่ที่ยังไม่หมดอายุของตัวเองและของคนที่ติดตาม
/// จัดกลุ่มตามเจ้าของมาให้แล้ว พร้อม hasUnseen สำหรับตัดสินสีวงแหวน
///
/// mediaUrl ที่ได้มาเป็น signed URL อายุ 5 นาที ถ้าผู้ใช้เปิดฟีดค้างไว้นาน
/// แล้วกดดู รูปจะโหลดไม่ขึ้น — onMediaError จึงดึงแถวใหม่ให้อัตโนมัติ

export function StoryRow() {
  const me = useMe();
  const refreshing = useRef(false);
  const viewed = useRef<Set<string>>(new Set());
  const params = useSearchParams();
  const wantedStory = params.get('story');
  const [open, setOpen] = useState<{ tray: number; storyId: string | null } | null>(null);
  const [handledLink, setHandledLink] = useState<string | null>(null);

  const {
    data: trays = [],
    isPending: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['stories'],
    queryFn: () => api.get<StoryTray[]>('/stories'),
  });

  const error =
    queryError instanceof ApiError ? queryError.message : null;

  // ของฉันขึ้นก่อน แล้วคนที่ยังมีสตอรี่ที่ยังไม่ดู แล้วคนที่ดูครบแล้ว — แบบ IG
  const ordered = [
    ...trays.filter((tray) => tray.isMe),
    ...trays.filter((tray) => !tray.isMe && tray.hasUnseen),
    ...trays.filter((tray) => !tray.isMe && !tray.hasUnseen),
  ];

  // ลิงก์ที่แชร์มา ?story=<id> — เปิดตัวดูที่ชิ้นนั้นครั้งเดียวต่อลิงก์
  // (ปรับ state ระหว่าง render ไม่ใช่ใน effect)
  if (wantedStory && !loading && handledLink !== wantedStory) {
    setHandledLink(wantedStory);

    const index = ordered.findIndex((tray) => tray.stories.some((story) => story.id === wantedStory));

    if (index >= 0) setOpen({ tray: index, storyId: wantedStory });
    else toast('สตอรี่นี้ไม่มีให้ดูแล้ว — อาจหมดอายุหรือถูกลบ');
  }

  /// signed URL หมดอายุ → ดึงแถวใหม่ครั้งเดียว ไม่วนซ้ำ
  const refreshUrls = useCallback(() => {
    if (refreshing.current) return;

    refreshing.current = true;

    void refetch().finally(() => {
      // ปลดล็อกหลังหนึ่งวินาที เพื่อไม่ให้ error หลายชิ้นยิงซ้อนกันเป็นสิบครั้ง
      setTimeout(() => {
        refreshing.current = false;
      }, 1000);
    });
  }, [refetch]);

  const markViewed = useCallback((story: StoryItem) => {
    // ของตัวเองไม่นับ และแต่ละชิ้นยิงครั้งเดียวต่อรอบการโหลด
    if (story.authorCoreUserId === me.id || viewed.current.has(story.id)) return;

    viewed.current.add(story.id);
    api.post(`/stories/${story.id}/views`).catch(() => {
      // นับการดูพลาดไม่ควรขัดจังหวะการดู
    });
  }, [me.id]);

  const mine = ordered.find((tray) => tray.isMe);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        กำลังโหลดสตอรี่…
      </div>
    );
  }

  return (
    <div className="mb-4">
      {error && (
        <p className="mb-2 text-xs text-destructive">{error}</p>
      )}

      <div className="flex gap-4 overflow-x-auto py-2 scrollbar-none">
        {/* ของตัวเอง: ถ้ามีสตอรี่อยู่แล้วให้กดดู ถ้ายังไม่มีให้กดโพสต์ */}
        {!mine && <AddStoryButton onPosted={() => void refetch()} />}

        {ordered.map((tray, index) => (
          <StoryCircle
            key={tray.authorCoreUserId}
            tray={tray}
            label={tray.isMe ? 'สตอรี่ของคุณ' : undefined}
            onOpen={() => setOpen({ tray: index, storyId: null })}
          />
        ))}

        {mine && <AddStoryButton onPosted={() => void refetch()} />}
      </div>

      {trays.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          ยังไม่มีสตอรี่ — โพสต์ของคุณเอง หรือไปติดตามคนอื่นเพื่อเห็นของเขา
        </p>
      )}

      {open && ordered.length > 0 && (
        <StoryTrayViewer
          trays={ordered}
          startTray={open.tray}
          startStoryId={open.storyId}
          onClose={() => {
            setOpen(null);
            // วงแหวนต้องเปลี่ยนเป็นสีเทาทันทีสำหรับคนที่ดูครบแล้ว
            void refetch();
          }}
          onViewed={markViewed}
          onMediaError={refreshUrls}
          onDeleted={() => void refetch()}
        />
      )}
    </div>
  );
}

/// วงกลมหนึ่งคนในแถวสตอรี่ — วงแหวนไล่สีเมื่อยังมีชิ้นที่ยังไม่ดู · เทาเมื่อดูครบแล้ว
function StoryCircle({
  tray,
  label,
  onOpen,
}: {
  tray: StoryTray;
  label?: string;
  onOpen: () => void;
}) {
  const profile = useProfile(tray.authorCoreUserId);
  const name = label ?? profile.displayName;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`ดูสตอรี่ของ ${tray.isMe ? 'คุณ' : profile.displayName}`}
      className="flex w-18 shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className={cn(
          'rounded-full p-[2px]',
          tray.hasUnseen ? 'csmju-story-ring' : 'bg-border',
        )}
      >
        <span className="block rounded-full bg-background p-[2px]">
          <Avatar coreUserId={tray.authorCoreUserId} size={62} showOnline={false} />
        </span>
      </span>
      <span className="w-full truncate text-center text-csmju-caption">{name}</span>
    </button>
  );
}

/// โพสต์สตอรี่ผ่านท่ออัปโหลดสามจังหวะเดียวกับคลิปและไฟล์แนบ
function AddStoryButton({ onPosted }: { onPosted: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    try {
      setStep('ขอสิทธิ์…');

      const intent = await api.post<{
        assetId: string;
        uploadUrl: string;
        uploadMethod: string;
        uploadHeaders: Record<string, string>;
      }>('/assets/upload-intents', {
        fileName: file.name,
        sizeBytes: file.size,
        bucket: 'attachments',
      });

      setStep('อัปโหลด…');

      const put = await fetch(intent.uploadUrl, {
        method: intent.uploadMethod || 'PUT',
        headers: intent.uploadHeaders ?? {},
        body: file,
      });

      if (!put.ok) {
        throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (HTTP ${put.status})`);
      }

      setStep('ยืนยัน…');
      await api.post(`/assets/${intent.assetId}/commit`);

      setStep('โพสต์…');
      await api.post('/stories', { assetId: intent.assetId });

      onPosted();
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น "สตอรี่รับเฉพาะรูปภาพและวิดีโอ"
      setError(caught instanceof Error ? caught.message : 'โพสต์ไม่สำเร็จ');
    } finally {
      setStep(null);

      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) void upload(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={step !== null}
        className="group relative cursor-pointer disabled:cursor-default"
        aria-label="โพสต์สตอรี่"
      >
        <span className="grid size-[72px] place-items-center rounded-full border-2 border-dashed border-muted-foreground/40 bg-muted/30 transition-colors group-hover:border-muted-foreground/60 group-hover:bg-muted/50">
          {step ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <User className="size-7 text-muted-foreground/50" />
          )}
        </span>

        <span className="absolute bottom-0 right-0 grid size-6 place-items-center rounded-full bg-primary shadow-sm transition-transform group-hover:scale-110">
          <Plus className="size-4 text-primary-foreground" strokeWidth={2.5} />
        </span>
      </button>

      <span className="max-w-[80px] truncate text-xs text-muted-foreground">
        {step ?? 'เพิ่มสตอรี่'}
      </span>

      {error && (
        <span className="max-w-[140px] text-center text-[10px] leading-tight text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
