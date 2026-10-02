'use client';

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import {
  Bookmark,
  Ellipsis,
  Heart,
  Loader2,
  MessageCircle,
  Play,
  Repeat2,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { FollowButton } from '@/components/csmju/reel-follow-button';
import { ReelCommentsPanel } from '@/components/csmju/reel-comments-panel';
import {
  compactCount,
  useSignedVideoUrl,
} from '@/components/csmju/reel-media';
import { ReelOptionsDialog } from '@/components/csmju/reel-options-dialog';
import { ShareSheet, copyShareLink } from '@/components/csmju/share-sheet';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import type { Reel } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// คลิปหนึ่งจอในหน้าคลิปสั้น — วิดีโอ 9:16 กลางจอ ปุ่มแนวตั้งชิดขวาของวิดีโอ
/// และชื่อ/คำบรรยายซ้อนบนมุมล่างซ้าย แบบ Instagram Reels บนเว็บ
///
/// สถานะที่ต้องใช้ร่วมกันหลายคลิป (เสียงเปิด/ปิด, คลิปไหนกำลังเล่น, บันทึกแล้ว
/// หรือยัง) อยู่ที่หน้าแม่ — ช่องนี้ถือแค่สิ่งที่เป็นของตัวเอง เช่นผู้ใช้กดหยุดไว้

/// คลิปที่หน้าคลิปสั้นใช้ — repostCount/canComment มาจากหลังบ้านเสมอ
/// (ใน types.ts เป็น optional ให้ฟิกซ์เจอร์เก่าคอมไพล์ได้ ไม่มีค่า = ไม่โชว์ปุ่มรีโพสต์)
export type ReelView = Reel;

export interface ReelSlideProps {
  reel: ReelView;
  /// คลิปที่เห็นเกิน 60% — เล่นอัตโนมัติ
  active: boolean;
  /// ขอลิงก์วิดีโอแล้ว (คลิปที่เห็นอยู่กับคลิปถัดไป)
  load: boolean;
  /// ยังเก็บ src ไว้ — ห่างจากคลิปที่เห็นเกินนี้ถอด src ทิ้งคืนหน่วยความจำ
  mount: boolean;
  muted: boolean;
  onToggleMute: () => void;
  saved: boolean;
  onLike: () => void;
  onSave: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
  /// ยอดความคิดเห็นเปลี่ยนจากแผงความคิดเห็น — หน้าแม่แก้ commentCount ของคลิป
  onCommentCountChange: (delta: number) => void;
  /// กดรีโพสต์/เลิกรีโพสต์ — มีเฉพาะเมื่อหลังบ้านส่ง repostCount มา
  onRepost: () => void;
  canDelete: boolean;
  onDelete: () => Promise<void>;
  /// เล่นขึ้นจริงครั้งแรก — หน้าแม่กันยิงซ้ำเอง
  onViewed: () => void;
}

export function ReelSlide({
  reel,
  active,
  load,
  mount,
  muted,
  onToggleMute,
  saved,
  onLike,
  onSave,
  commentsOpen,
  onToggleComments,
  onCommentCountChange,
  onRepost,
  canDelete,
  onDelete,
  onViewed,
}: ReelSlideProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { url, error, refresh } = useSignedVideoUrl(reel.assetId, load);
  /// แผงความคิดเห็นวางตัวเองข้างแถบปุ่ม และสูงเท่ากรอบวิดีโอ
  const frameRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [portrait, setPortrait] = useState(true);
  const [expanded, setExpanded] = useState(false);
  /// ไอคอนเล่นที่โผล่แวบหนึ่งตอนกดเล่นต่อ: โผล่ → จางหาย → ถอดออก
  const [flash, setFlash] = useState<'in' | 'out' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  /// ขอลิงก์ใหม่ไปแล้วตั้งแต่เปิดได้ครั้งล่าสุด — ลิงก์ใหม่ยังเล่นไม่ขึ้น
  /// แปลว่าไฟล์เสีย ไม่ใช่ลิงก์หมดอายุ จึงไม่ขอวนต่อ
  const retried = useRef(false);
  /// ตำแหน่งที่เล่นค้างไว้ก่อนลิงก์หมดอายุ ใช้เล่นต่อหลังได้ลิงก์ใหม่
  const resumeAt = useRef<number | null>(null);

  // เลื่อนออกไปแล้วกลับมา = เริ่มเล่นใหม่ ไม่ค้างสถานะ "ผู้ใช้กดหยุด" ของรอบก่อน
  // (ปรับ state ระหว่าง render ตามแบบที่ React แนะนำ แทน setState ใน effect)
  const [wasActive, setWasActive] = useState(active);

  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setUserPaused(false);
  }

  const src = mount && url ? url : undefined;

  // muted เป็น property ไม่ใช่ attribute — React ตั้งให้แค่ตอนสร้าง element
  // จึงต้องตั้งเองทุกครั้งที่สลับ ไม่งั้นกดเปิดเสียงแล้วคลิปยังเงียบ
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, src]);

  // เล่นเฉพาะคลิปที่เห็น หยุดที่เหลือทั้งหมด
  useEffect(() => {
    const video = videoRef.current;

    if (!video || !src) return;

    if (active && !userPaused) {
      video.play().catch(() => {
        // เบราว์เซอร์ไม่ยอมเล่นแบบมีเสียงก่อนผู้ใช้แตะหน้าจอ — ไม่ต้องทำอะไร
        // ผู้ใช้แตะวิดีโอแล้ว togglePlay จะเล่นให้เอง
      });
    } else {
      video.pause();
    }
  }, [active, userPaused, src]);

  function togglePlay() {
    const video = videoRef.current;

    if (!video || !src) return;

    // สั่งเล่น/หยุดตรงนี้เลย ไม่รอ effect — ต้องอยู่ใน user gesture เดียวกับการแตะ
    // ถึงจะผ่านนโยบาย autoplay (เช่นหลังเปิดเสียงแล้วเบราว์เซอร์ไม่ยอมเล่นเอง)
    if (video.paused) {
      setUserPaused(false);
      video.play().catch(() => {});
      setFlash('in');
      setTimeout(() => setFlash('out'), 250);
      setTimeout(() => setFlash(null), 600);
    } else {
      setUserPaused(true);
      video.pause();
    }
  }

  function onVideoError() {
    const video = videoRef.current;

    // ลิงก์หมดอายุ (อายุสองนาที) — ขอใหม่หนึ่งรอบแล้วเล่นต่อจากที่ค้าง
    if (url && !retried.current) {
      retried.current = true;
      resumeAt.current = video?.currentTime || null;
      void refresh().then((fresh) => {
        if (!fresh || fresh === url) setBroken(true);
      });

      return;
    }

    setBroken(true);
  }

  const author = reel.authorCoreUserId;
  const liked = reel.likedByMe;

  return (
    <div className="relative flex h-full w-full items-end justify-center gap-4 sm:py-4">
      <div
        ref={frameRef}
        className="relative h-full w-full overflow-hidden bg-black sm:aspect-9/16 sm:w-auto sm:max-w-[calc(100%-5rem)] sm:rounded-lg"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src={src}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          aria-label={reel.title}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;

            setPortrait(video.videoHeight >= video.videoWidth);
            setBroken(false);
            retried.current = false;

            if (resumeAt.current !== null) {
              video.currentTime = resumeAt.current;
              resumeAt.current = null;
            }
          }}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => {
            setWaiting(false);
            onViewed();
          }}
          onCanPlay={() => setWaiting(false)}
          onError={onVideoError}
          // คลิปแนวตั้งเต็มกรอบ (cover) ส่วนคลิปแนวนอนเต็มความกว้าง (contain)
          // — cover กับคลิปแนวนอนจะเหลือแค่แถบกลางภาพ
          className={cn('size-full', portrait ? 'object-cover' : 'object-contain')}
        />

        {/* ไอคอนกลางจอ: กำลังโหลด / หยุดอยู่ / เพิ่งกดเล่นต่อ */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {broken || (error && !url) ? (
            <p className="rounded-lg bg-black/60 px-3 py-2 text-csmju-label text-white">
              เปิดคลิปไม่ได้
            </p>
          ) : active && (!src || waiting) && !userPaused ? (
            <Loader2 className="size-9 animate-spin text-white/80" aria-label="กำลังโหลดคลิป" />
          ) : userPaused || flash ? (
            <span
              className={cn(
                'grid size-20 place-items-center rounded-full bg-black/40 transition-opacity duration-300',
                flash === 'out' && !userPaused ? 'opacity-0' : 'opacity-100',
              )}
            >
              <Play className="size-10 fill-current text-white" strokeWidth={1.5} aria-hidden />
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMute();
          }}
          aria-label={muted ? 'เปิดเสียง' : 'ปิดเสียง'}
          aria-pressed={!muted}
          className="absolute right-3 top-14 z-10 grid size-8 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 sm:bottom-4 sm:top-auto"
        >
          {muted ? (
            <VolumeX className="size-4" strokeWidth={2} />
          ) : (
            <Volume2 className="size-4" strokeWidth={2} />
          )}
        </button>

        {/* ชื่อเจ้าของ + คำบรรยาย ซ้อนบนวิดีโอ ไล่เงาดำจากล่างให้อ่านออกทุกพื้นหลัง */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 via-black/25 to-transparent px-4 pb-4 pt-24 text-white max-sm:pr-16 sm:pr-14">
          <div className="pointer-events-auto flex items-center gap-2.5">
            <Link
              href={`/profile/${encodeURIComponent(author)}`}
              onClick={(event) => event.stopPropagation()}
              className="flex min-w-0 items-center gap-2.5"
            >
              <Avatar coreUserId={author} size={32} showOnline={false} />
              <AuthorName coreUserId={author} />
            </Link>
            <FollowButton coreUserId={author} enabled={load} variant="overlay" />
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            aria-expanded={expanded}
            className={cn(
              'pointer-events-auto mt-2 block w-full text-left text-csmju-label',
              expanded && 'max-h-40 overflow-y-auto',
            )}
          >
            <span className={cn('block', !expanded && 'line-clamp-2')}>
              <span className="font-semibold">{reel.title}</span>
              {reel.caption && <span className="font-normal"> · {reel.caption}</span>}
            </span>
          </button>
        </div>
      </div>

      <ReelActionColumn
        ref={columnRef}
        reel={reel}
        liked={liked}
        saved={saved}
        commentsOpen={commentsOpen}
        onLike={onLike}
        onSave={onSave}
        onToggleComments={onToggleComments}
        onRepost={onRepost}
        onShare={() => setShareOpen(true)}
        onMenu={() => setMenuOpen(true)}
      />

      {commentsOpen && (
        <ReelCommentsPanel
          reelId={reel.id}
          anchorRef={columnRef}
          frameRef={frameRef}
          onClose={onToggleComments}
          onCountChange={onCommentCountChange}
          // คลิปที่เจ้าของปิดความคิดเห็น — ยังอ่านของเดิมได้ แต่ไม่มีช่องพิมพ์
          canComment={reel.canComment !== false}
        />
      )}

      <ReelOptionsDialog
        open={menuOpen}
        onOpenChange={setMenuOpen}
        authorCoreUserId={author}
        canDelete={canDelete}
        onDelete={onDelete}
        onCopyLink={() => void copyShareLink({ kind: 'REEL', id: reel.id })}
        onShareTo={() => setShareOpen(true)}
      />

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        target={{ kind: 'REEL', id: reel.id }}
      />
    </div>
  );
}

function AuthorName({ coreUserId }: { coreUserId: string }) {
  const profile = useProfile(coreUserId);

  return (
    <span className="truncate text-csmju-label font-semibold hover:underline">
      {profile.displayName}
    </span>
  );
}

/// แถบปุ่มแนวตั้ง — ข้างวิดีโอบนจอกว้าง ซ้อนขอบขวาของวิดีโอบนมือถือ
///
/// ลำดับเดียวกับ Instagram: ถูกใจ · ความคิดเห็น · รีโพสต์ · ส่ง · บันทึก · ⋯ · รูปเจ้าของ
/// ปุ่มรีโพสต์โผล่เมื่อหลังบ้านส่ง repostCount มาเท่านั้น — ปุ่มที่กดแล้วไม่เกิด
/// อะไรขึ้นแย่กว่าไม่มีปุ่ม
function ReelActionColumn({
  ref,
  reel,
  liked,
  saved,
  commentsOpen,
  onLike,
  onSave,
  onToggleComments,
  onRepost,
  onShare,
  onMenu,
}: {
  ref: Ref<HTMLDivElement>;
  reel: ReelView;
  liked: boolean;
  saved: boolean;
  commentsOpen: boolean;
  onLike: () => void;
  onSave: () => void;
  onToggleComments: () => void;
  onRepost: () => void;
  onShare: () => void;
  onMenu: () => void;
}) {
  // ยอดจากหลังบ้าน (ระดับบนสุด + คำตอบ) — ไม่ต้องยิง /comments ต่อคลิปมานับเอง
  const commentCount = reel.commentCount;

  return (
    <div
      ref={ref}
      className={cn(
        'flex shrink-0 flex-col items-center gap-5 pb-1',
        'max-sm:absolute max-sm:bottom-20 max-sm:right-2 max-sm:z-10 max-sm:text-white max-sm:drop-shadow-md',
      )}
    >
      <ActionButton
        label={liked ? 'เลิกถูกใจ' : 'ถูกใจ'}
        pressed={liked}
        onClick={onLike}
        count={compactCount(reel.likeCount)}
      >
        <Heart
          className={cn('size-7', liked && 'fill-current text-badge')}
          strokeWidth={1.9}
        />
      </ActionButton>

      <ActionButton
        label={`ความคิดเห็น (${commentCount} รายการ)`}
        pressed={commentsOpen}
        onClick={onToggleComments}
        count={compactCount(commentCount)}
      >
        <MessageCircle className="size-7 -scale-x-100" strokeWidth={1.9} />
      </ActionButton>

      {typeof reel.repostCount === 'number' && (
        <ActionButton
          label={reel.repostedByMe ? 'เลิกรีโพสต์' : 'รีโพสต์'}
          pressed={Boolean(reel.repostedByMe)}
          onClick={onRepost}
          count={compactCount(reel.repostCount)}
        >
          <Repeat2
            className={cn('size-7', reel.repostedByMe && 'text-success')}
            strokeWidth={1.9}
          />
        </ActionButton>
      )}

      <ActionButton label="แชร์" onClick={onShare}>
        <Send className="size-7" strokeWidth={1.9} />
      </ActionButton>

      <ActionButton label={saved ? 'เอาออกจากที่บันทึกไว้' : 'บันทึก'} pressed={saved} onClick={onSave}>
        <Bookmark className={cn('size-7', saved && 'fill-current')} strokeWidth={1.9} />
      </ActionButton>

      <ActionButton label="ตัวเลือกเพิ่มเติม" onClick={onMenu}>
        <Ellipsis className="size-7" strokeWidth={1.9} />
      </ActionButton>

      <Link
        href={`/profile/${encodeURIComponent(reel.authorCoreUserId)}`}
        aria-label="ไปที่บัญชีเจ้าของคลิป"
        className="mt-1 block size-7 overflow-hidden rounded-md border-2 border-current transition-opacity hover:opacity-80"
      >
        <SquareAvatar coreUserId={reel.authorCoreUserId} />
      </Link>
    </div>
  );
}

function ActionButton({
  label,
  pressed,
  onClick,
  count,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  count?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex flex-col items-center gap-1 transition-opacity hover:opacity-60"
    >
      {children}
      {count !== undefined && (
        <span className="text-xs font-semibold tabular-nums">{count}</span>
      )}
    </button>
  );
}

/// รูปเจ้าของคลิปแบบสี่เหลี่ยมมุมมน ท้ายแถบปุ่ม — ตำแหน่งเดียวกับปกเพลงของ IG
function SquareAvatar({ coreUserId }: { coreUserId: string }) {
  const profile = useProfile(coreUserId);

  if (profile.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- รูปจาก Core Hub คนละโดเมน ไม่ผ่าน next/image
      <img src={profile.avatarUrl} alt="" className="size-full object-cover" />
    );
  }

  return (
    <span className="grid size-full place-items-center bg-muted text-[10px] font-bold text-foreground">
      {profile.displayName.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
