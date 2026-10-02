'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Caption, PostActions, PostComments, PostHeader } from '@/components/csmju/feed-post-card';
import { MediaCarousel, type PostView } from '@/components/csmju/feed-post-media';
import { PostMenu } from '@/components/csmju/feed-post-menu';
import { toast } from '@/components/csmju/feed-toast';
import { ShareSheet } from '@/components/csmju/share-sheet';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Bookmark } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';
import { isStaffLike } from '@/lib/csmju/roles';

/// หน้าโพสต์เดี่ยว /p/:id — แบบกล่องโพสต์ของ Instagram บนเว็บ
///
///   จอกว้าง  สื่อ (ภาพหมุน) ซ้าย · หัว / ความคิดเห็น / แถวปุ่ม / ช่องพิมพ์ ขวา
///   มือถือ   เรียงลงมา: หัว · สื่อ · ปุ่ม · คำบรรยาย · ความคิดเห็น
///
/// เป็นปลายทางของ "ไปยังโพสต์" "คัดลอกลิงก์" แผ่นแชร์ ผลค้นหา และกริดกิจกรรม —
/// ลิงก์ที่ส่งต่อกันต้องเปิดโพสต์นั้นได้ตรง ๆ ไม่ใช่พาไปฟีดแล้วให้หาเอง
export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const postKey = ['post', id] as const;

  const { data: post, error, isPending } = useQuery({
    queryKey: postKey,
    queryFn: () => api.get<PostView>(`/posts/${encodeURIComponent(id)}`),
    retry: false,
  });

  const { data: saved = false } = useQuery({
    queryKey: ['post-saved', id],
    queryFn: async () =>
      (await api.list<Bookmark>('/bookmarks?targetKind=POST&limit=100')).items.some(
        (row) => row.targetId === id,
      ),
  });

  function patch(next: Partial<PostView>) {
    queryClient.setQueryData<PostView>(postKey, (current) => (current ? { ...current, ...next } : current));
  }

  async function toggleSave() {
    try {
      if (saved) await api.del(`/bookmarks${qs({ targetKind: 'POST', targetId: id })}`);
      else await api.post('/bookmarks', { targetKind: 'POST', targetId: id });

      queryClient.setQueryData(['post-saved', id], !saved);
      // ฟีดถือรายการที่บันทึกไว้ในแคชของตัวเอง — ให้ดึงใหม่ตอนกลับไป
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove() {
    await api.del(`/posts/${encodeURIComponent(id)}`);
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    router.replace('/feed');
  }

  if (isPending) {
    return (
      <div className="grid min-h-[60dvh] place-items-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-label="กำลังโหลดโพสต์" />
      </div>
    );
  }

  if (error || !post) {
    const missing = error instanceof ApiError && (error.status === 404 || error.status === 400);

    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-csmju-title">{missing ? 'ไม่พบโพสต์นี้' : 'เปิดโพสต์ไม่สำเร็จ'}</h1>
        <p className="mt-2 text-csmju-label text-muted-foreground">
          {missing
            ? 'ลิงก์ที่คุณเปิดอาจใช้ไม่ได้ หรือโพสต์อาจถูกลบไปแล้ว'
            : error instanceof ApiError
              ? error.message
              : 'ลองใหม่อีกครั้ง'}
        </p>
        <Link href="/feed" className="mt-4 inline-block text-csmju-label font-semibold text-link">
          กลับไปที่ฟีด
        </Link>
      </div>
    );
  }

  const media = post.media ?? [];
  const canModerate = isStaffLike(me.coreRole);
  const isOwner = post.authorCoreUserId === me.id;
  const hasText = Boolean(post.title || post.content);

  const actions = (
    <div className="border-t border-border pt-1">
      <PostActions
        post={post}
        saved={saved}
        onComment={() => document.getElementById('post-comment-input')?.focus()}
        onShare={() => setShareOpen(true)}
        onToggleSave={() => void toggleSave()}
        onReactions={(next) => patch({ reactions: next })}
      />
      <time dateTime={post.createdAt} className="mb-2 block text-csmju-caption text-muted-foreground">
        {new Date(post.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
      </time>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[70rem] px-0 py-0 lg:px-6 lg:py-8">
      <article
        className={cn(
          'flex flex-col overflow-hidden border-border bg-card lg:h-[min(56rem,calc(100dvh-4rem))] lg:flex-row lg:rounded-md lg:border',
        )}
      >
        <div className="px-4 py-3 lg:hidden">
          <PostHeader post={post} onMenu={() => setMenuOpen(true)} />
        </div>

        <div className="flex min-h-0 items-center justify-center bg-black lg:flex-1">
          {media.length > 0 ? (
            <MediaCarousel media={media} fit="contain" className="aspect-4/5 w-full lg:aspect-auto lg:h-full" />
          ) : (
            <div className="w-full bg-linear-to-br from-secondary/70 via-card to-card px-6 py-10 lg:flex lg:h-full lg:flex-col lg:justify-center lg:px-12">
              {post.title && <h1 className="text-csmju-title font-bold leading-snug text-balance">{post.title}</h1>}
              <p className="mt-3 whitespace-pre-wrap text-csmju-body leading-relaxed">{post.content}</p>
            </div>
          )}
        </div>

        <div className="flex min-h-0 w-full flex-col lg:w-[25rem] lg:shrink-0 lg:border-l lg:border-border">
          <div className="hidden border-b border-border px-4 py-3 lg:block">
            <PostHeader post={post} onMenu={() => setMenuOpen(true)} />
          </div>

          <PostComments
            postId={post.id}
            canComment={post.canComment !== false}
            onCountChange={(delta) => patch({ commentCount: Math.max(0, post.commentCount + delta) })}
            className="min-h-0 flex-1 px-4 pb-3"
            listClassName="min-h-0 flex-1 overflow-y-auto py-3"
            header={
              media.length > 0 && hasText ? (
                <li>
                  <Caption post={post} expandable={false} />
                </li>
              ) : null
            }
            beforeInput={actions}
            inputId="post-comment-input"
          />
        </div>
      </article>

      <PostMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        postId={post.id}
        authorCoreUserId={post.authorCoreUserId}
        isOwner={isOwner}
        canDelete={isOwner || canModerate}
        onDelete={remove}
        onShareTo={() => setShareOpen(true)}
        showGoToPost={false}
      />
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} target={{ kind: 'POST', id: post.id }} />
    </div>
  );
}
