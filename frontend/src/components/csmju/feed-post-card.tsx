'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Bookmark, Loader2, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { MediaCarousel, type PostView } from '@/components/csmju/feed-post-media';
import { PostMenu } from '@/components/csmju/feed-post-menu';
import { ReactionBar } from '@/components/csmju/reaction-bar';
import { ShareSheet } from '@/components/csmju/share-sheet';
import { Avatar, UserName } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { igAgo } from '@/lib/csmju/time';
import type { PostComment, ReactionSummary } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';
import { isStaffLike } from '@/lib/csmju/roles';

/// โพสต์หนึ่งใบในฟีดแบบ Instagram — หัว · สื่อ (หรือกล่องข้อความ) · แถวปุ่ม · คำบรรยาย · ความคิดเห็น
///
/// โพสต์มีสองแบบ: มีรูป/วิดีโอ (ภาพหมุน + คำบรรยายใต้ภาพแบบ IG) และกระทู้
/// ข้อความล้วนแบบเดิมของระบบ (ถามตอบ/ประกาศ) ที่วางกล่องเนื้อหาในช่องภาพ
export function PostCard({
  post,
  saved,
  canDelete,
  onToggleSave,
  onDelete,
  onPatch,
}: {
  post: PostView;
  saved: boolean;
  canDelete: boolean;
  onToggleSave: () => void;
  onDelete: () => Promise<void>;
  onPatch: (next: Partial<PostView>) => void;
}) {
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const media = post.media ?? [];

  return (
    <li className="border-b border-border py-5">
      <PostHeader post={post} onMenu={() => setMenuOpen(true)} />

      {media.length > 0 ? (
        <MediaCarousel media={media} className="mt-3 aspect-4/5 rounded-md border border-border" />
      ) : (
        <Link
          href={`/p/${encodeURIComponent(post.id)}`}
          className="csmju-surface mt-3 block overflow-hidden transition-opacity hover:opacity-95"
        >
          <div className="bg-linear-to-br from-secondary/70 via-card to-card px-5 py-6">
            {post.title && (
              <h2 className="text-csmju-title font-bold leading-snug text-balance">{post.title}</h2>
            )}
            <p className="mt-2 line-clamp-12 whitespace-pre-wrap text-csmju-body leading-relaxed">
              {post.content}
            </p>
          </div>
        </Link>
      )}

      <PostActions
        post={post}
        saved={saved}
        onComment={() => setCommentsOpen((value) => !value)}
        commentsOpen={commentsOpen}
        onShare={() => setShareOpen(true)}
        onToggleSave={onToggleSave}
        onReactions={(next) => onPatch({ reactions: next })}
      />

      {media.length > 0 && (post.title || post.content) && <Caption post={post} />}

      {post.commentCount > 0 && !commentsOpen && (
        <button
          type="button"
          onClick={() => setCommentsOpen(true)}
          className="mt-1 text-csmju-label text-muted-foreground hover:text-foreground"
        >
          ดูความคิดเห็นทั้ง {post.commentCount} รายการ
        </button>
      )}

      {commentsOpen && (
        <PostComments
          postId={post.id}
          canComment={post.canComment !== false}
          onCountChange={(delta) => onPatch({ commentCount: Math.max(0, post.commentCount + delta) })}
          className="mt-3"
        />
      )}

      <PostMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        postId={post.id}
        authorCoreUserId={post.authorCoreUserId}
        isOwner={post.authorCoreUserId === me.id}
        canDelete={canDelete}
        onDelete={onDelete}
        onShareTo={() => setShareOpen(true)}
      />
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} target={{ kind: 'POST', id: post.id }} />
    </li>
  );
}

export function PostHeader({ post, onMenu }: { post: PostView; onMenu: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="csmju-story-ring shrink-0">
        <span className="block rounded-full bg-background p-[2px]">
          <Avatar coreUserId={post.authorCoreUserId} size={32} showOnline={false} />
        </span>
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-csmju-label">
        <UserName coreUserId={post.authorCoreUserId} className="font-semibold" />
        <span aria-hidden className="text-muted-foreground">•</span>
        <Link
          href={`/p/${encodeURIComponent(post.id)}`}
          title={new Date(post.createdAt).toLocaleString('th-TH')}
          className="text-muted-foreground hover:underline"
        >
          <time dateTime={post.createdAt}>{igAgo(post.createdAt)}</time>
        </Link>
        {post.courseTag && (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-medium text-secondary-foreground">
            {post.courseTag}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onMenu}
        aria-label="ตัวเลือกของโพสต์"
        aria-haspopup="dialog"
        className="grid size-8 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
      >
        <MoreHorizontal aria-hidden className="size-5" />
      </button>
    </div>
  );
}

export function PostActions({
  post,
  saved,
  commentsOpen,
  onComment,
  onShare,
  onToggleSave,
  onReactions,
}: {
  post: PostView;
  saved: boolean;
  commentsOpen?: boolean;
  onComment: () => void;
  onShare: () => void;
  onToggleSave: () => void;
  onReactions: (next: ReactionSummary) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <ReactionBar targetKind="POST" targetId={post.id} summary={post.reactions} onChange={onReactions} />

      <button
        type="button"
        onClick={onComment}
        aria-expanded={commentsOpen}
        aria-label="ความคิดเห็น"
        className="grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
      >
        <MessageCircle aria-hidden className="size-6 -scale-x-100" strokeWidth={1.9} />
      </button>

      <button
        type="button"
        onClick={onShare}
        aria-label="แชร์"
        className="grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
      >
        <Send aria-hidden className="size-6" strokeWidth={1.9} />
      </button>

      <button
        type="button"
        onClick={onToggleSave}
        aria-label={saved ? 'เอาออกจากที่บันทึก' : 'บันทึกไว้'}
        aria-pressed={saved}
        className="ml-auto grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
      >
        <Bookmark aria-hidden className={cn('size-6', saved && 'fill-foreground')} strokeWidth={1.9} />
      </button>
    </div>
  );
}

/// คำบรรยายใต้ภาพแบบ IG: **ชื่อ** ข้อความ… "เพิ่มเติม"
export function Caption({ post, expandable = true }: { post: PostView; expandable?: boolean }) {
  const [expanded, setExpanded] = useState(!expandable);
  const text = [post.title, post.content].filter(Boolean).join('\n');

  return (
    <div className="mt-1 text-csmju-label">
      <p className={cn('whitespace-pre-wrap wrap-break-word', !expanded && 'line-clamp-2')}>
        <UserName coreUserId={post.authorCoreUserId} className="mr-1.5 font-semibold" />
        {text}
      </p>
      {!expanded && text.length > 90 && (
        <button type="button" onClick={() => setExpanded(true)} className="text-muted-foreground">
          เพิ่มเติม
        </button>
      )}
    </div>
  );
}

/// ความคิดเห็นใต้โพสต์ — รายการ + ช่องพิมพ์ (ซ่อนช่องพิมพ์เมื่อเจ้าของปิดความคิดเห็น)
export function PostComments({
  postId,
  canComment,
  onCountChange,
  className,
  listClassName,
  header,
  beforeInput,
  inputId,
}: {
  postId: string;
  canComment: boolean;
  onCountChange: (delta: number) => void;
  className?: string;
  listClassName?: string;
  /// แถวแรกของรายการ (หน้าโพสต์วางคำบรรยายของเจ้าของไว้ตรงนี้แบบ IG)
  header?: ReactNode;
  /// วางระหว่างรายการกับช่องพิมพ์ (หน้าโพสต์วางแถวปุ่มไว้ตรงนี้แบบ IG)
  beforeInput?: ReactNode;
  /// id ของช่องพิมพ์ — ปุ่ม 💬 ของหน้าโพสต์โฟกัสช่องนี้
  inputId?: string;
}) {
  const me = useMe();
  const canModerate = isStaffLike(me.coreRole);
  const [items, setItems] = useState<PostComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // เปิดส่วนความคิดเห็น = mount → โหลดครั้งเดียว
  useEffect(() => {
    let alive = true;

    api
      .list<PostComment>(`/posts/${postId}/comments?limit=50`)
      .then((page) => {
        if (alive) setItems(page.items);
      })
      .catch(() => {
        if (alive) {
          setItems([]);
          setError('โหลดความคิดเห็นไม่สำเร็จ');
        }
      });

    return () => {
      alive = false;
    };
  }, [postId]);

  async function send() {
    const content = draft.trim();

    if (!content || busy) return;

    setBusy(true);
    setError(null);

    try {
      const comment = await api.post<PostComment>(`/posts/${postId}/comments`, { content });

      setItems((prev) => [...(prev ?? []), comment]);
      onCountChange(1);
      setDraft('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งความคิดเห็นไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: PostComment) {
    try {
      await api.del(`/posts/${postId}/comments/${comment.id}`);
      setItems((prev) => (prev ?? []).filter((row) => row.id !== comment.id));
      onCountChange(-1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบความคิดเห็นไม่สำเร็จ');
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ul className={cn('space-y-3', listClassName)}>
        {header}
        {items === null && (
          <li className="flex justify-center py-4 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-label="กำลังโหลดความคิดเห็น" />
          </li>
        )}
        {items?.map((comment) => (
          <li key={comment.id} className="group flex items-start gap-3">
            <Avatar coreUserId={comment.authorCoreUserId} size={32} showOnline={false} />
            <div className="min-w-0 flex-1 text-csmju-label">
              <p className="whitespace-pre-wrap wrap-break-word">
                <UserName coreUserId={comment.authorCoreUserId} className="mr-1.5 font-semibold" />
                {comment.content}
              </p>
              <p className="mt-0.5 flex gap-3 text-csmju-caption text-muted-foreground">
                <time dateTime={comment.createdAt}>{igAgo(comment.createdAt)}</time>
                {(comment.authorCoreUserId === me.id || canModerate) && (
                  <button
                    type="button"
                    onClick={() => void remove(comment)}
                    className="font-semibold hover:text-foreground"
                  >
                    ลบ
                  </button>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-csmju-caption text-destructive">
          {error}
        </p>
      )}

      {beforeInput}

      {canComment ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="mt-3 flex items-center gap-3"
        >
          <input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="เพิ่มความคิดเห็น…"
            aria-label="เพิ่มความคิดเห็น"
            maxLength={4000}
            className="min-w-0 flex-1 bg-transparent py-1 text-csmju-label outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            className="shrink-0 text-csmju-label font-semibold text-link transition-opacity hover:opacity-70 disabled:opacity-40"
          >
            โพสต์
          </button>
        </form>
      ) : (
        <p className="mt-3 text-center text-csmju-label text-muted-foreground">ปิดการแสดงความคิดเห็น</p>
      )}
    </div>
  );
}
