'use client';

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { CreatePostModal } from '@/components/csmju/feed-create-post';
import { toast } from '@/components/csmju/feed-toast';
import { PostCard } from '@/components/csmju/feed-post-card';
import type { PostView } from '@/components/csmju/feed-post-media';
import { FeedSidebar } from '@/components/csmju/feed-sidebar';
import { StoryRow } from '@/components/csmju/story-row';
import { Avatar } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Bookmark as BookmarkRow } from '@/lib/csmju/types';
import { isStaffLike } from '@/lib/csmju/roles';

/// กระดานชุมชน — ตั้งกระทู้ กดอิโมจิ ตอบ และบันทึกไว้อ่านทีหลัง
///
/// เป็น Client Component ทั้งหน้าเพราะเนื้อหาขึ้นกับว่าใครเป็นผู้เรียก
/// (`reactedByMe`, สิทธิ์ลบ, รายการที่บันทึกไว้) จึง prerender ล่วงหน้าไม่ได้

type Feed = 'all' | 'following';

export default function FeedPage() {
  // useSearchParams (?create=post · ?story=) ต้องอยู่ใต้ Suspense ไม่งั้น build ล้ม
  return (
    <Suspense fallback={null}>
      <FeedView />
    </Suspense>
  );
}

function FeedView() {
  const [feed, setFeed] = useState<Feed>('all');
  const [courseTag, setCourseTag] = useState('');
  const me = useMe();
  const queryClient = useQueryClient();

  // แท็บและแท็กวิชาเป็นส่วนหนึ่งของคีย์ — สลับกลับมาแท็บเดิมจึงเห็นของเดิม
  // ทันทีจากแคช แล้วค่อยอัปเดตเบื้องหลัง แทนที่จะจอขาวใหม่ทุกครั้ง
  const feedKey = ['feed', feed, courseTag.trim()] as const;

  const {
    data,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: feedKey,
    queryFn: async () => {
      const [page, bookmarks] = await Promise.all([
        api.list<PostView>(
          `/posts${qs({
            limit: 20,
            feed: feed === 'following' ? 'following' : undefined,
            courseTag: courseTag.trim() || undefined,
          })}`,
        ),
        api.list<BookmarkRow>('/bookmarks?targetKind=POST&limit=100'),
      ]);

      return {
        posts: page.items,
        saved: new Set(bookmarks.items.map((row) => row.targetId)),
      };
    },
  });

  const posts = data?.posts ?? [];
  const saved = data?.saved ?? new Set<string>();

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดกระดานไม่สำเร็จ — หลังบ้านรันอยู่ไหม (npm run start:dev ใน backend/)'
    : null;

  /// แก้ข้อมูลในแคชโดยตรง แทนการเก็บสำเนาไว้ใน state ของหน้าอีกชุด
  type FeedData = { posts: PostView[]; saved: Set<string> };

  const patchFeed = useCallback(
    (update: (current: FeedData) => FeedData) => {
      queryClient.setQueryData<FeedData>(feedKey, (current) =>
        update(current ?? { posts: [], saved: new Set<string>() }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, feed, courseTag],
  );

  function setPosts(update: (prev: PostView[]) => PostView[]) {
    patchFeed((current) => ({ ...current, posts: update(current.posts) }));
  }

  function setSaved(update: (prev: Set<string>) => Set<string>) {
    patchFeed((current) => ({ ...current, saved: update(current.saved) }));
  }

  function patch(id: string, next: Partial<PostView>) {
    setPosts((prev) =>
      prev.map((post) => (post.id === id ? { ...post, ...next } : post)),
    );
  }

  async function toggleSave(post: PostView) {
    const isSaved = saved.has(post.id);

    try {
      if (isSaved) {
        await api.del(`/bookmarks${qs({ targetKind: 'POST', targetId: post.id })}`);
      } else {
        await api.post('/bookmarks', { targetKind: 'POST', targetId: post.id });
      }

      setSaved((prev) => {
        const next = new Set(prev);

        if (isSaved) next.delete(post.id);
        else next.add(post.id);

        return next;
      });
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(post: PostView) {
    await api.del(`/posts/${post.id}`);
    setPosts((prev) => prev.filter((row) => row.id !== post.id));
  }

  const canModerate = isStaffLike(me.coreRole);

  return (
    // สามคอลัมน์แบบ Instagram: แถบซ้ายอยู่ที่ layout · ฟีดกลาง · บัญชีและคำแนะนำขวา
    <div className="mx-auto flex w-full max-w-[64rem] justify-center gap-16 px-4 lg:px-8">
      <div className="w-full max-w-[39rem] py-6">
        <StoryRow />

        <Composer onCreated={(post) => setPosts((prev) => [post, ...prev])} />

        <div className="mx-auto mt-4 flex max-w-[29.5rem] flex-wrap items-center gap-3 border-b border-border">
          <div role="tablist" aria-label="เลือกฟีด" className="flex gap-6">
            {(['all', 'following'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={feed === value}
                onClick={() => setFeed(value)}
                className={`-mb-px border-b-2 pb-2.5 text-csmju-label font-semibold transition-colors ${
                  feed === value
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {value === 'all' ? 'สำหรับคุณ' : 'กำลังติดตาม'}
              </button>
            ))}
          </div>

          <input
            value={courseTag}
            onChange={(event) => setCourseTag(event.target.value.toUpperCase())}
            placeholder="# แท็กวิชา เช่น CS201"
            aria-label="กรองด้วยแท็กวิชา"
            className="mb-2 ml-auto w-40 rounded-lg bg-muted px-3 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="mx-auto max-w-[29.5rem]">
          {loading && (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              กำลังโหลด…
            </p>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && posts.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {feed === 'following'
                ? 'ยังไม่มีโพสต์จากคนที่คุณติดตาม — ลองกด “ติดตาม” คนในคอลัมน์ขวา'
                : 'ยังไม่มีโพสต์ — เริ่มโพสต์แรกได้เลย'}
            </p>
          )}

          <ul>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                saved={saved.has(post.id)}
                canDelete={post.authorCoreUserId === me.id || canModerate}
                onToggleSave={() => void toggleSave(post)}
                onDelete={() => remove(post)}
                onPatch={(next) => patch(post.id, next)}
              />
            ))}
          </ul>
        </div>
      </div>

      <FeedSidebar />
    </div>
  );
}

/// แถบ "มีคำถามหรืออยากประกาศอะไร…" บนฟีด — กดแล้วเปิดกล่อง "สร้างโพสต์ใหม่"
///
/// ปุ่ม "สร้าง → โพสต์" ในแถบซ้ายพามาที่ /feed?create=post → เปิดกล่องทันที
function Composer({ onCreated }: { onCreated: (post: PostView) => void }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const wantsCreate = useSearchParams().get('create') === 'post';
  const [handledCreate, setHandledCreate] = useState(false);

  // ปรับ state ระหว่าง render (ไม่ใช่ใน effect) — เปิดครั้งเดียวต่อการมาด้วยลิงก์นี้
  if (wantsCreate && !handledCreate) {
    setHandledCreate(true);
    setOpen(true);
  }

  return (
    <>
      <div className="mx-auto mt-5 flex max-w-[29.5rem] items-center gap-3 csmju-surface px-3 py-2.5">
        <Avatar coreUserId={me.id} size={36} showOnline={false} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 rounded-full bg-muted px-4 py-2 text-left text-csmju-label text-muted-foreground transition-colors hover:bg-accent"
        >
          มีคำถามหรืออยากประกาศอะไร…
        </button>
      </div>
      <CreatePostModal open={open} onClose={() => setOpen(false)} onCreated={onCreated} />
    </>
  );
}
