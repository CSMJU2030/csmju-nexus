'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { Ellipsis, Heart, Loader2, Smile, X } from 'lucide-react';
import { EmojiPopover } from '@/components/csmju/emoji-picker';
import { LoadMoreSentinel } from '@/components/csmju/explore-grid';
import { ReelCommentMenu } from '@/components/csmju/reel-comment-menu';
import { Avatar, UserName, useProfile } from '@/components/csmju/user-name';
import { api, ApiError, qs, type Page } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { igAgo } from '@/lib/csmju/time';
import type { CommentLike, ReelComment } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';
import { isStaffLike } from '@/lib/csmju/roles';

/// แผงความคิดเห็นของคลิปแบบ Instagram — การ์ดลอยข้างแถบปุ่มบนจอกว้าง
/// แผ่นเลื่อนขึ้นจากล่างบนมือถือ
///
/// **วาดผ่าน portal ไปที่ body** ไม่ใช่ลูกของช่องคลิป เพราะช่องคลิปอยู่ในกล่อง
/// `overflow-hidden` + snap scroller — ถ้าวาดข้างใน การ์ดจะถูกตัดขอบ และแผ่นล่าง
/// บนมือถือจะอยู่ใต้แถบล่างของ layout (z-60) ที่อยู่คนละ stacking context
///
/// ตัวเดียวกันทั้งสองขนาดจอ แค่ class ต่างกัน — ถ้าแยกสองคอมโพเนนต์ ร่างที่
/// พิมพ์ค้างไว้จะหายตอนหมุนจอ/ย่อหน้าต่างข้ามเส้น lg
///
/// การตอบกลับลึกได้ชั้นเดียว (หลังบ้านคืน 400 ถ้าตอบคำตอบ) — กด "ตอบกลับ"
/// ที่คำตอบจึงผูกกับต้นเรื่องระดับบนสุด แล้วเติม `@ชื่อ ` นำหน้าแบบที่ IG ทำ

const TOP_PAGE = 20;
const REPLY_PAGE = 50;
const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 640;
const PANEL_GAP = 16;

type CommentPages = InfiniteData<Page<ReelComment>, number>;

const topKey = (reelId: string) => ['reel-comments', reelId] as const;
const repliesKey = (commentId: string) => ['reel-comment-replies', commentId] as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function nextPage(last: Page<ReelComment>) {
  return last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined;
}

/// แก้/ลบความคิดเห็นหนึ่งแถวในข้อมูลแบบหลายหน้า — คืน null = ลบแถวนั้นทิ้ง
function mapComment(
  data: CommentPages | undefined,
  id: string,
  update: (comment: ReelComment) => ReelComment | null,
): CommentPages | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((comment) => {
        if (comment.id !== id) return [comment];

        const next = update(comment);

        return next ? [next] : [];
      }),
    })),
  };
}

export function ReelCommentsPanel({
  reelId,
  anchorRef,
  frameRef,
  onClose,
  onCountChange,
  canComment = true,
}: {
  reelId: string;
  /// แถบปุ่มข้างวิดีโอ — การ์ดวางชิดขวาของมัน
  anchorRef: RefObject<HTMLElement | null>;
  /// กรอบวิดีโอ — การ์ดสูงไม่เกินวิดีโอและชิดขอบล่างเดียวกัน
  frameRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /// ยอดความคิดเห็นของคลิปเปลี่ยน (+1 โพสต์ · −n ลบพร้อมคำตอบ) — หน้าแม่แก้ commentCount
  onCountChange: (delta: number) => void;
  /// false = เจ้าของคลิปปิดความคิดเห็น — อ่านของเดิมได้ แต่ไม่มีช่องพิมพ์/ตอบกลับ
  canComment?: boolean;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const canModerate = isStaffLike(me.coreRole);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ topId: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<ReelComment | null>(null);
  /// ต้นเรื่องที่กางคำตอบอยู่
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pos, setPos] = useState<{ left: number; top: number; height: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  /// มีกล่องซ้อนอยู่ข้างบน (อิโมจิ/เมนู) — Esc ต้องปิดกล่องนั้น ไม่ใช่ทั้งแผง
  const childOpen = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    childOpen.current = emojiOpen || menuFor !== null;
  });

  const top = useInfiniteQuery({
    queryKey: topKey(reelId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<ReelComment>(
        `/reels/${reelId}/comments${qs({ limit: TOP_PAGE, page: pageParam })}`,
      ),
    getNextPageParam: nextPage,
  });

  const comments = top.data?.pages.flatMap((page) => page.items) ?? [];

  // วางการ์ดข้างแถบปุ่ม (จอกว้าง) — คำนวณก่อนวาดเฟรมแรก ไม่ให้เห็นการ์ดกระโดด
  const place = useCallback(() => {
    const column = anchorRef.current;
    const frame = frameRef.current;

    if (!column || !frame) return;

    const c = column.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const height = Math.min(PANEL_MAX_HEIGHT, f.height);

    setPos({
      // จอแคบกว่าที่การ์ดจะวางข้างปุ่มได้ → ชิดขอบขวาจอแทนการล้นออกนอกจอ
      left: Math.max(
        PANEL_GAP,
        Math.min(c.right + PANEL_GAP, window.innerWidth - PANEL_WIDTH - PANEL_GAP),
      ),
      top: f.bottom - height,
      height,
    });
  }, [anchorRef, frameRef]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  // กักโฟกัส + Esc ปิด + คืนโฟกัสปุ่มเดิมตอนปิด
  //
  // ไม่ใช้ useModalFocus ตรง ๆ เพราะมันปิดทุกครั้งที่กด Esc — ที่นี่มีกล่องซ้อน
  // (แผงอิโมจิ, เมนู ⋯ ที่เป็น <dialog>) กด Esc ครั้งแรกต้องปิดแค่กล่องบนสุด
  useEffect(() => {
    const panel = panelRef.current;

    if (!panel) return;

    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // โฟกัสตัวแผง ไม่ใช่ช่องพิมพ์ — บนมือถือโฟกัสช่องพิมพ์ = คีย์บอร์ดเด้งขึ้นมาบังทันที
    panel.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (childOpen.current || document.querySelector('dialog[open]')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();

        return;
      }

      if (event.key !== 'Tab' || !panel) return;

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];

      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel.contains(active);

      if (event.shiftKey && (active === first || active === panel || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, []);

  function patch(comment: ReelComment, update: (row: ReelComment) => ReelComment | null) {
    const key = comment.parentId ? repliesKey(comment.parentId) : topKey(reelId);

    queryClient.setQueryData<CommentPages>(key, (data) => mapComment(data, comment.id, update));
  }

  function patchTop(id: string, update: (row: ReelComment) => ReelComment | null) {
    queryClient.setQueryData<CommentPages>(topKey(reelId), (data) => mapComment(data, id, update));
  }

  async function toggleLike(comment: ReelComment) {
    const liked = !comment.likedByMe;
    const path = `/reels/${reelId}/comments/${comment.id}/likes`;

    // เปลี่ยนก่อนรอหลังบ้าน แบบ IG — กดหัวใจแล้วต้องแดงทันที
    patch(comment, (row) => ({
      ...row,
      likedByMe: liked,
      likeCount: Math.max(0, row.likeCount + (liked ? 1 : -1)),
    }));

    try {
      const result = liked
        ? await api.post<CommentLike>(path)
        : await api.del<CommentLike>(path);

      patch(comment, (row) => ({ ...row, ...result }));
    } catch {
      patch(comment, (row) => ({
        ...row,
        likedByMe: comment.likedByMe,
        likeCount: comment.likeCount,
      }));
      setError('กดถูกใจความคิดเห็นไม่สำเร็จ');
    }
  }

  function focusInputAtEnd(value: string) {
    requestAnimationFrame(() => {
      const input = inputRef.current;

      if (!input) return;

      input.focus();
      input.setSelectionRange(value.length, value.length);
    });
  }

  function startReply(comment: ReelComment, name: string) {
    const prefix = `@${name} `;
    // เปลี่ยนคนที่ตอบ → เอา @ชื่อเดิมออกก่อน ไม่ให้ซ้อนกันเป็น "@ก @ข "
    const body =
      replyTo && draft.startsWith(`@${replyTo.name} `)
        ? draft.slice(replyTo.name.length + 2)
        : draft;
    const next = body.startsWith(prefix) ? body : prefix + body;

    setReplyTo({ topId: comment.parentId ?? comment.id, name });
    setDraft(next);
    focusInputAtEnd(next);
  }

  function cancelReply() {
    if (replyTo && draft.startsWith(`@${replyTo.name} `)) {
      setDraft(draft.slice(replyTo.name.length + 2));
    }

    setReplyTo(null);
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    const caret = start + emoji.length;

    setDraft(next.slice(0, 1000));
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  async function send() {
    const content = draft.trim();

    if (!content || sending) return;

    setSending(true);
    setError(null);

    try {
      const parentId = replyTo?.topId;
      const comment = await api.post<ReelComment>(
        `/reels/${reelId}/comments`,
        parentId ? { content, parentId: parentId } : { content },
      );

      if (parentId) {
        queryClient.setQueryData<CommentPages>(repliesKey(parentId), (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page, index) =>
                  index === data.pages.length - 1
                    ? { ...page, items: [...page.items, comment] }
                    : page,
                ),
              }
            : data,
        );
        patchTop(parentId, (row) => ({ ...row, replyCount: row.replyCount + 1 }));
        setExpanded((prev) => new Set(prev).add(parentId));
      } else {
        queryClient.setQueryData<CommentPages>(topKey(reelId), (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page, index) =>
                  index === 0 ? { ...page, items: [comment, ...page.items] } : page,
                ),
              }
            : data,
        );
      }

      onCountChange(1);
      setDraft('');
      setReplyTo(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ส่งความคิดเห็นไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  /// ปล่อย error ให้กล่องยืนยันแสดงเอง
  async function remove(comment: ReelComment) {
    await api.del(`/reels/${reelId}/comments/${comment.id}`);

    patch(comment, () => null);

    if (comment.parentId) {
      patchTop(comment.parentId, (row) => ({
        ...row,
        replyCount: Math.max(0, row.replyCount - 1),
      }));
      onCountChange(-1);
    } else {
      // ลบต้นเรื่อง = คำตอบหายไปด้วย (หลังบ้านทำให้) ยอดรวมของคลิปจึงหักทั้งหมด
      queryClient.removeQueries({ queryKey: repliesKey(comment.id) });
      onCountChange(-(1 + comment.replyCount));
    }
  }

  const toggleReplies = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  const rowProps = {
    meId: me.id,
    canReply: canComment,
    canModerate,
    onLike: (comment: ReelComment) => void toggleLike(comment),
    onReply: startReply,
    onMenu: setMenuFor,
  };

  return createPortal(
    <>
      {/* ฉากหลังของแผ่นล่างบนมือถือ — แตะเพื่อปิด */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-80 bg-black/50 animate-in fade-in-0 lg:hidden"
      />

      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="ความคิดเห็น"
        tabIndex={-1}
        style={
          pos
            ? ({
                '--cp-left': `${pos.left}px`,
                '--cp-top': `${pos.top}px`,
                '--cp-height': `${pos.height}px`,
              } as CSSProperties)
            : undefined
        }
        className={cn(
          'fixed z-80 flex flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-csmju-md outline-none',
          'animate-in fade-in-0 zoom-in-95 duration-150',
          // มือถือ: แผ่นล่าง เหนือแถบล่างของ layout
          'max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[70dvh] max-lg:rounded-t-2xl max-lg:border-b-0 max-lg:slide-in-from-bottom-8',
          // จอกว้าง: การ์ดข้างแถบปุ่ม ชิดล่างเท่าวิดีโอ แบบ Instagram
          'lg:left-(--cp-left) lg:top-(--cp-top) lg:h-(--cp-height) lg:w-90 lg:rounded-xl',
        )}
      >
        <header className="relative flex shrink-0 items-center justify-center border-b border-border px-4 py-3">
          <span
            aria-hidden
            className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-border lg:hidden"
          />
          <h2 className="text-csmju-label font-semibold">ความคิดเห็น</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดความคิดเห็น"
            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
          >
            <X className="size-5" strokeWidth={1.9} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {top.isPending && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-label="กำลังโหลดความคิดเห็น" />
            </div>
          )}

          {top.isError && (
            <p role="alert" className="py-6 text-center text-csmju-label text-destructive">
              โหลดความคิดเห็นไม่สำเร็จ
            </p>
          )}

          {!top.isPending && !top.isError && comments.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 py-12 text-center">
              <p className="text-[1.5rem] font-bold leading-tight">ยังไม่มีความคิดเห็น</p>
              <p className="text-csmju-label text-muted-foreground">เริ่มการสนทนา</p>
            </div>
          )}

          <ul className="space-y-4">
            {comments.map((comment) => (
              <li key={comment.id}>
                <CommentRow comment={comment} {...rowProps} />
                {comment.replyCount > 0 && (
                  <Replies
                    reelId={reelId}
                    parent={comment}
                    open={expanded.has(comment.id)}
                    onToggle={() => toggleReplies(comment.id)}
                    rowProps={rowProps}
                  />
                )}
              </li>
            ))}
          </ul>

          <LoadMoreSentinel
            onVisible={() => void top.fetchNextPage()}
            disabled={!top.hasNextPage || top.isFetchingNextPage}
          />
          {top.isFetchingNextPage && (
            <div className="flex justify-center py-3 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-label="กำลังโหลดความคิดเห็นเพิ่ม" />
            </div>
          )}
        </div>

        {replyTo && (
          <div className="flex shrink-0 items-center justify-between gap-2 bg-muted px-4 py-2 text-csmju-label text-muted-foreground">
            <span className="min-w-0 truncate">
              กำลังตอบกลับ <span className="font-semibold text-foreground">@{replyTo.name}</span>
            </span>
            <button
              type="button"
              onClick={cancelReply}
              aria-label="ยกเลิกการตอบกลับ"
              className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="shrink-0 px-4 pt-2 text-csmju-caption text-destructive">
            {error}
          </p>
        )}

        {!canComment && (
          <p className="shrink-0 border-t border-border px-4 py-4 text-center text-csmju-label text-muted-foreground">
            ปิดการแสดงความคิดเห็น
          </p>
        )}

        {canComment && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <Avatar coreUserId={me.id} size={32} showOnline={false} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="เพิ่มความคิดเห็น…"
            aria-label="เพิ่มความคิดเห็น"
            maxLength={1000}
            className="min-w-0 flex-1 bg-transparent text-csmju-label outline-none placeholder:text-muted-foreground"
          />
          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setEmojiOpen((value) => !value)}
            aria-label="แทรกอีโมจิ"
            aria-expanded={emojiOpen}
            className="grid size-8 shrink-0 place-items-center rounded-full text-foreground transition-opacity hover:opacity-60"
          >
            <Smile className="size-5" strokeWidth={1.9} />
          </button>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="shrink-0 text-csmju-label font-semibold text-link transition-opacity hover:opacity-70 disabled:opacity-40"
          >
            โพสต์
          </button>
        </form>
        )}

        <EmojiPopover
          anchorRef={emojiButtonRef}
          open={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          onPick={insertEmoji}
          variant="composer"
        />

        <ReelCommentMenu
          comment={menuFor}
          onClose={() => setMenuFor(null)}
          onDelete={remove}
        />
      </section>
    </>,
    document.body,
  );
}

interface RowProps {
  meId: string;
  canReply: boolean;
  canModerate: boolean;
  onLike: (comment: ReelComment) => void;
  onReply: (comment: ReelComment, name: string) => void;
  onMenu: (comment: ReelComment) => void;
}

/// คำตอบของต้นเรื่องหนึ่ง — ขอเมื่อกางเท่านั้น (ต้นเรื่องส่วนใหญ่ไม่มีใครกางดู)
function Replies({
  reelId,
  parent,
  open,
  onToggle,
  rowProps,
}: {
  reelId: string;
  parent: ReelComment;
  open: boolean;
  onToggle: () => void;
  rowProps: RowProps;
}) {
  const replies = useInfiniteQuery({
    queryKey: repliesKey(parent.id),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.list<ReelComment>(
        `/reels/${reelId}/comments${qs({ parentId: parent.id, limit: REPLY_PAGE, page: pageParam })}`,
      ),
    getNextPageParam: nextPage,
    enabled: open,
  });

  const items = replies.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mt-2 pl-11">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-3 text-csmju-caption font-semibold text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden className="h-px w-6 bg-muted-foreground/60" />
        {open ? 'ซ่อนข้อความตอบกลับ' : `ดูข้อความตอบกลับทั้งหมด ${parent.replyCount} รายการ`}
        {open && replies.isFetching && <Loader2 className="size-3 animate-spin" aria-hidden />}
      </button>

      {open && (
        <ul className="mt-3 space-y-4">
          {items.map((reply) => (
            <li key={reply.id}>
              <CommentRow comment={reply} {...rowProps} />
            </li>
          ))}
          {replies.hasNextPage && (
            <li>
              <button
                type="button"
                onClick={() => void replies.fetchNextPage()}
                className="text-csmju-caption font-semibold text-muted-foreground hover:text-foreground"
              >
                ดูข้อความตอบกลับเพิ่มเติม
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  meId,
  canReply,
  canModerate,
  onLike,
  onReply,
  onMenu,
}: RowProps & { comment: ReelComment }) {
  const profile = useProfile(comment.authorCoreUserId);
  const liked = comment.likedByMe;
  // ลบได้ = เจ้าของความคิดเห็น หรือ staff/admin ตรงกับ ReelsService.removeComment
  // (เจ้าของคลิปลบความคิดเห็นของคนอื่นไม่ได้ — หลังบ้านไม่ยอม จึงไม่โชว์ปุ่ม)
  const canManage = comment.authorCoreUserId === meId || canModerate;

  return (
    <div className="group flex items-start gap-3">
      <Avatar coreUserId={comment.authorCoreUserId} size={32} showOnline={false} />

      <div className="min-w-0 flex-1 text-csmju-label">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <UserName coreUserId={comment.authorCoreUserId} className="font-semibold" />
          <time dateTime={comment.createdAt} className="text-csmju-caption text-muted-foreground">
            {igAgo(comment.createdAt)}
          </time>
        </p>
        <p className="whitespace-pre-wrap wrap-break-word">{comment.content}</p>
        <p className="mt-1 flex items-center gap-3 text-csmju-caption font-semibold text-muted-foreground">
          {canReply && (
            <button
              type="button"
              onClick={() => onReply(comment, profile.displayName)}
              className="hover:text-foreground"
            >
              ตอบกลับ
            </button>
          )}
          {comment.likeCount > 0 && <span>ถูกใจ {comment.likeCount} ครั้ง</span>}
          {canManage && (
            <button
              type="button"
              onClick={() => onMenu(comment)}
              aria-label="ตัวเลือกความคิดเห็น"
              className="grid size-5 place-items-center rounded-full hover:text-foreground lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
            >
              <Ellipsis className="size-4" />
            </button>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onLike(comment)}
        aria-label={liked ? 'เลิกถูกใจความคิดเห็น' : 'ถูกใจความคิดเห็น'}
        aria-pressed={liked}
        className="mt-1.5 grid size-6 shrink-0 place-items-center text-muted-foreground transition-opacity hover:opacity-60"
      >
        {/* key เปลี่ยนตามสถานะ = element ใหม่ = เล่นแอนิเมชัน "เด้ง" ทุกครั้งที่กดถูกใจ */}
        <Heart
          key={liked ? 'on' : 'off'}
          className={cn(
            'size-3.5',
            liked && 'fill-current text-badge animate-in zoom-in-50 duration-300',
          )}
          strokeWidth={2}
        />
      </button>
    </div>
  );
}
