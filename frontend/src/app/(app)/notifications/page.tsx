'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronRight, Loader2 } from 'lucide-react';
import { UserAvatar } from '@/components/csmju/user-badge';
import { api, ApiError, qs } from '@/lib/csmju/api';
import {
  describeNotification,
  notificationLink,
  timeAgo,
} from '@/lib/csmju/notifications';
import type { Notification } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// หน้าการแจ้งเตือนแบบเต็ม
///
/// กระดิ่งบนแถบบนแสดงได้แค่ 15 รายการล่าสุดในกล่องแคบ ๆ ซึ่งบนมือถือ
/// แทบใช้ไม่ได้ — หน้านี้จึงมีไว้ให้ย้อนดูได้ลึกกว่านั้น กรองเฉพาะที่ยัง
/// ไม่อ่านได้ และกดไปยังสิ่งที่ถูกแจ้งได้ตรงจุด
///
/// ใช้ตรรกะข้อความร่วมกับกระดิ่งจาก lib/csmju/notifications เพื่อไม่ให้
/// สองที่พูดคนละอย่างเรื่องการแจ้งเตือนรายการเดียวกัน

type Tab = 'all' | 'unread';

const PAGE_LIMIT = 30;

export default function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const listKey = ['notifications', 'page', tab, page] as const;

  const {
    data,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      api.list<Notification>(
        `/notifications${qs({
          page,
          limit: PAGE_LIMIT,
          unreadOnly: tab === 'unread' ? 'true' : undefined,
        })}`,
      ),
  });

  const items = data?.items ?? [];
  const meta = data?.meta;

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดการแจ้งเตือนไม่สำเร็จ'
    : null;

  /// ทำเครื่องหมายว่าอ่านแล้ว โดยไม่ต้องโหลดทั้งหน้าใหม่
  const markOne = useMutation({
    mutationFn: (id: string) =>
      api.patch<{ unreadCount: number }>(`/notifications/${id}/read`),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<typeof data>(listKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                row.id === id
                  ? { ...row, readAt: new Date().toISOString() }
                  : row,
              ),
            }
          : current,
      );

      // กระดิ่งบนแถบบนถือตัวเลขคนละชุด ต้องบอกให้มันดึงใหม่ด้วย
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'bell'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const hasUnread = items.some((item) => !item.readAt);

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1); // ไม่งั้นสลับแท็บแล้วค้างอยู่หน้า 5 ของแท็บเดิม
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-csmju-display">การแจ้งเตือน</h1>
          <p className="text-sm text-muted-foreground">
            เห็นเฉพาะของคุณ · เรียงจากใหม่ไปเก่า
          </p>
        </div>

        {hasUnread && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-60"
          >
            <Check className="size-4" aria-hidden="true" />
            อ่านทั้งหมด
          </button>
        )}
      </header>

      <div
        role="tablist"
        aria-label="กรองการแจ้งเตือน"
        className="mb-4 flex gap-1 rounded-lg border border-border p-0.5"
      >
        {(
          [
            { key: 'all', label: 'ทั้งหมด' },
            { key: 'unread', label: 'ยังไม่อ่าน' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
              tab === key
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          กำลังโหลด…
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && items.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {tab === 'unread'
            ? 'อ่านครบหมดแล้ว'
            : 'ยังไม่มีการแจ้งเตือน — เมื่อมีคนตอบกระทู้ ถูกใจคลิป หรือเรียกถึงคุณ จะขึ้นที่นี่'}
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          const href = notificationLink(item);
          const unread = !item.readAt;

          const body = (
            <>
              <UserAvatar
                coreUserId={item.actorCoreUserId ?? 'ระบบ'}
                size={36}
                showOnline={false}
              />

              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug">
                  {describeNotification(item)}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {timeAgo(item.createdAt)}
                  {unread && ' · ยังไม่อ่าน'}
                </span>
              </span>

              {href && (
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </>
          );

          const shared = cn(
            'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
            unread
              ? 'border-primary/30 bg-secondary/50'
              : 'border-border bg-card',
            'hover:bg-accent',
          );

          return (
            <li key={item.id}>
              {href ? (
                // มีปลายทาง = เป็นลิงก์จริง เปิดแท็บใหม่ได้ คลิกกลางได้
                <Link
                  href={href}
                  onClick={() => unread && markOne.mutate(item.id)}
                  className={shared}
                >
                  {body}
                </Link>
              ) : (
                // ไม่มีปลายทาง = เป็นแค่ปุ่มอ่านแล้ว ไม่หลอกว่ากดไปไหนได้
                <button
                  type="button"
                  onClick={() => unread && markOne.mutate(item.id)}
                  disabled={!unread}
                  className={cn(shared, !unread && 'cursor-default')}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {meta && meta.totalPages > 1 && (
        <nav
          aria-label="หน้าของการแจ้งเตือน"
          className="mt-5 flex items-center justify-between gap-3"
        >
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
          >
            ก่อนหน้า
          </button>

          <span className="text-xs tabular-nums text-muted-foreground">
            หน้า {meta.page} จาก {meta.totalPages} ·{' '}
            {meta.total} รายการ
          </span>

          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(meta.totalPages, current + 1))
            }
            disabled={page >= meta.totalPages}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
          >
            ถัดไป
          </button>
        </nav>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Bell className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        การแจ้งเตือนใหม่จะเด้งขึ้นที่กระดิ่งมุมขวาบนทันทีโดยไม่ต้องรีเฟรชหน้า
      </p>
    </div>
  );
}
