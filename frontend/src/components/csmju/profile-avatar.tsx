'use client';

import { useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StoryViewer, type Story } from '@/components/ui/story-viewer';
import { Avatar } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import type { StoryTray } from '@/lib/csmju/types';

/// รูปโปรไฟล์ใหญ่บนหัวโปรไฟล์ — มีวงแหวนเมื่อเจ้าของมีสตอรี่ที่ยังไม่หมดอายุ
///
/// ใช้คีย์ `['stories']` เดียวกับแถวสตอรี่บนฟีด จึงไม่ยิงซ้ำถ้าเพิ่งเปิดฟีดมา
/// หลังบ้านคืนเฉพาะสตอรี่ของตัวเองและของคนที่เราติดตาม — โปรไฟล์ของคนที่
/// ยังไม่ได้ติดตามจึงไม่มีวงแหวน ตรงกับที่ Instagram ทำกับบัญชีที่ไม่ได้ติดตาม
///
/// ตัวเล่นเต็มจอยืม `StoryViewer` ตัวเดียวกับฟีด (นับยอดดู ขอลิงก์ใหม่เมื่อ
/// หมดอายุ ครบแล้ว) แต่ปุ่มของมันมีขนาดตายตัว 72px — จึงซ่อนปุ่มนั้นไว้แล้ว
/// ให้รูปใหญ่ของเรากดแทน ดีกว่าเขียนตัวเล่นใหม่อีกชุดที่วันหนึ่งจะทำงานไม่เหมือนกัน

export const STORIES_KEY = ['stories'] as const;

export function useStoryTray(coreUserId: string) {
  const query = useQuery({
    queryKey: STORIES_KEY,
    queryFn: () => api.get<StoryTray[]>('/stories'),
  });

  return {
    ...query,
    tray: query.data?.find((row) => row.authorCoreUserId === coreUserId) ?? null,
  };
}

function toStories(tray: StoryTray): Story[] {
  return tray.stories.map((item) => ({
    id: item.id,
    type: item.kind === 'VIDEO' ? 'video' : 'image',
    src: item.mediaUrl,
  }));
}

/// ขนาดตาม Instagram: 77px บนมือถือ 150px บนจอกว้าง
///
/// `Avatar` รับขนาดเป็นตัวเลขแล้วเขียนเป็น inline style จึงเปลี่ยนตามจอด้วย
/// คลาสธรรมดาไม่ได้ — ห่อด้วยกรอบที่กำหนดขนาดแล้วบังคับให้ข้างในเต็มกรอบ
/// แทนการวาดสองชุดแล้วซ่อนชุดหนึ่ง (ซึ่งทำให้มีรูปซ้ำสองรูปในหน้า)
///
/// ป้ายยืนยันที่มุมรูปถูกซ่อน เพราะบนรูป 150px มันลอยห่างจากขอบจนดูเป็นจุดแปลก ๆ
/// — หัวโปรไฟล์มีป้ายเดียวกันอยู่ข้างชื่อแล้ว แบบเครื่องหมายยืนยันของ Instagram
const FILL =
  'block size-full [&>span]:!block [&>span]:!size-full [&>span>span:not([data-slot=avatar])]:!hidden [&_[data-slot=avatar]]:!size-full [&_[data-slot=avatar]>span]:!text-[28px] md:[&_[data-slot=avatar]>span]:!text-[54px]';

export function ProfileAvatar({
  coreUserId,
  displayName,
}: {
  coreUserId: string;
  displayName: string;
}) {
  const { tray, refetch } = useStoryTray(coreUserId);
  const hidden = useRef<HTMLDivElement | null>(null);
  const refreshing = useRef(false);

  /// signed URL ของสตอรี่อายุ 5 นาที — หมดอายุแล้วดึงแถวใหม่ครั้งเดียว
  const refreshUrls = useCallback(() => {
    if (refreshing.current) return;

    refreshing.current = true;

    void refetch().finally(() => {
      setTimeout(() => {
        refreshing.current = false;
      }, 1000);
    });
  }, [refetch]);

  const hasStory = Boolean(tray && tray.stories.length > 0);
  const sizing = 'size-[77px] md:size-[150px]';

  if (!hasStory || !tray) {
    return (
      <div className={`${sizing} shrink-0`}>
        <span className={FILL}>
          <Avatar coreUserId={coreUserId} size={150} showOnline={false} />
        </span>
      </div>
    );
  }

  return (
    <div className={`${sizing} relative shrink-0`}>
      <button
        type="button"
        onClick={() => hidden.current?.querySelector('button')?.click()}
        aria-label={`ดูสตอรี่ของ ${displayName}`}
        className={`block size-full rounded-full p-[2px] transition-transform active:scale-95 md:p-[3px] ${
          tray.hasUnseen ? 'csmju-story-ring' : 'bg-border'
        }`}
      >
        <span className="block size-full rounded-full bg-background p-[2px] md:p-[4px]">
          <span className={FILL}>
            <Avatar coreUserId={coreUserId} size={150} showOnline={false} />
          </span>
        </span>
      </button>

      {/* ตัวเล่นจริง — ปุ่มของมันถูกซ่อน ส่วนหน้าจอเต็มถูก portal ไปที่ body */}
      <div ref={hidden} hidden>
        <StoryViewer
          stories={toStories(tray)}
          coreUserId={coreUserId}
          timestamp={tray.stories.at(-1)?.createdAt}
          hasUnseen={tray.hasUnseen}
          onStoryView={(story) => {
            void api.post(`/stories/${story.id}/views`).catch(() => {
              // นับยอดดูพลาดไม่ควรขัดจังหวะการดู
            });
          }}
          onMediaError={refreshUrls}
          onAllStoriesViewed={() => void refetch()}
        />
      </div>
    </div>
  );
}
