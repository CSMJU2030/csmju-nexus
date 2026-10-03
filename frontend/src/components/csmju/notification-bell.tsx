'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Heart } from 'lucide-react';
import { api } from '@/lib/csmju/api';
import {
  bindSocket,
  connectSocket,
  onSocketReconnect,
} from '@/lib/csmju/socket';
import {
  describeNotification,
  timeAgo,
} from '@/lib/csmju/notifications';
import type { Notification } from '@/lib/csmju/types';
import { NotificationsPanel } from '@/components/csmju/notifications-panel';


const NOTIFICATIONS_KEY = ['notifications', 'bell'] as const;

/// `rail` = ไอคอนหัวใจในแถบซ้ายแบบ Instagram เปิดเป็นแผงเต็มความสูงข้างแถบ
/// `header` = กระดิ่งบนแถบบนของจอมือถือ เปิดเป็นกล่องลอยใต้ปุ่ม
export function NotificationBell({
  variant = 'header',
}: {
  variant?: 'header' | 'rail';
} = {}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => {
      const [count, page] = await Promise.all([
        api.get<{ unreadCount: number }>('/notifications/unread-count'),
        api.list<Notification>('/notifications?limit=15'),
      ]);

      return { unread: count.unreadCount, items: page.items };
    },
  });

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  /// เขียนทับแคชของกระดิ่งโดยตรง
  ///
  /// ใช้กับสิ่งที่เรารู้ผลอยู่แล้ว (อ่านแล้ว · มีตัวใหม่เข้ามาทาง socket)
  /// จะได้ไม่ต้องยิงถามหลังบ้านซ้ำในสิ่งที่เพิ่งทำเอง
  const patchCache = useCallback(
    (next: { unread: number; items: Notification[] }) => {
      queryClient.setQueryData(NOTIFICATIONS_KEY, next);
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [queryClient]);

  // ฟังการแจ้งเตือนสด — หลังบ้านส่งเข้าห้องส่วนตัว user:<coreUserId>
  // ซึ่ง socket เข้าให้อัตโนมัติตอนต่อ จึงไม่ต้อง subscribe อะไรเพิ่ม
  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | null = null;

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        // ต้องถอดตอน unmount ด้วย — เดิมผูกแล้วปล่อยทิ้ง ทำให้ใน StrictMode
        // (และทุกครั้งที่ component นี้ mount ใหม่) มีผู้ฟังซ้อนกันหลายตัว
        // อาการคือการแจ้งเตือนหนึ่งครั้งเด้งขึ้นมาสองสามรายการ
        unbind = bindSocket<{
          notification: Notification;
          unreadCount: number;
        }>(socket, 'notification:new', (payload) => {
          const current = queryClient.getQueryData<{
            unread: number;
            items: Notification[];
          }>(NOTIFICATIONS_KEY);

          patchCache({
            unread: payload.unreadCount,
            items: [payload.notification, ...(current?.items ?? [])].slice(
              0,
              15,
            ),
          });
        });

        // ผูกผ่าน bindSocket จึงถูกย้ายไปที่ socket ตัวใหม่เองหลังต่อกลับ
        // แต่ระหว่างที่หลุดอาจมีการแจ้งเตือนที่พลาดไป จึงต้องดึงมาใหม่
        const stopReconnect = onSocketReconnect(() => void refresh());
        const unbindEvent = unbind;

        unbind = () => {
          unbindEvent();
          stopReconnect();
        };
      } catch {
        // ต่อ socket ไม่ได้ = ยังใช้งานได้ แค่ต้องรีเฟรชเอง
      }
    })();

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [refresh, patchCache, queryClient]);

  async function markAll() {
    await api.patch('/notifications/read-all');
    await refresh();
  }

  async function markOne(id: string) {
    const result = await api.patch<{ unreadCount: number }>(
      `/notifications/${id}/read`,
    );

    patchCache({
      unread: result.unreadCount,
      items: items.map((item) =>
        item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    });
  }

  return (
    <div className={variant === 'rail' ? 'relative w-full' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          variant === 'rail'
            ? `csmju-rail-item ${open ? 'bg-sidebar-accent' : ''}`
            : 'relative grid size-9 place-items-center rounded-lg transition-colors hover:bg-accent'
        }
        aria-label={`การแจ้งเตือน${unread > 0 ? ` (${unread} ยังไม่อ่าน)` : ''}`}
      >
        {variant === 'rail' ? (
          <Heart
            aria-hidden
            className={`size-6 ${open ? 'fill-current' : ''}`}
            strokeWidth={open ? 2.4 : 1.9}
          />
        ) : (
          <Heart aria-hidden className="size-6" strokeWidth={1.9} />
        )}

        {variant === 'rail' && <span className="csmju-rail-label">การแจ้งเตือน</span>}

        {unread > 0 && (
          <span
            className={
              variant === 'rail'
                ? 'csmju-rail-badge'
                : 'absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-badge px-1 text-[10px] font-semibold leading-4 text-white'
            }
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && variant === 'rail' && (
        // ฉากหลังโปร่งใส — คลิกนอกแผงแล้วปิด เหมือนแผงแจ้งเตือนของ Instagram
        <button
          type="button"
          aria-label="ปิดการแจ้งเตือน"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 cursor-default"
        />
      )}

      {open && variant === 'rail' && (
        // แผงแบบ Instagram — เลื่อนออกจากขอบแถบ เต็มความสูง มุมขวาโค้ง
        <div className="fixed inset-y-0 left-[4.5rem] z-50 w-[24.8rem] max-w-[calc(100vw-4.5rem)] overflow-hidden rounded-r-2xl border-r border-border bg-background shadow-csmju-lg animate-in slide-in-from-left-4 fade-in-0 duration-200">
          <NotificationsPanel unread={unread} onClose={() => setOpen(false)} />
        </div>
      )}

      {open && variant === 'header' && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div
            className="flex items-center justify-between border-b border-border px-3 py-2"
          >
            <span className="text-sm font-medium">
              การแจ้งเตือน
            </span>

            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Check className="size-3" />
                อ่านทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                ยังไม่มีการแจ้งเตือน
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void markOne(item.id)}
                  className={`block w-full border-b border-border px-3 py-2.5 text-left last:border-0 transition-colors hover:bg-accent ${
                    item.readAt ? '' : 'bg-secondary/60'
                  }`}
                >
                  <span className="block text-sm leading-snug">
                    {describeNotification(item)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {timeAgo(item.createdAt)}
                    {item.readAt ? '' : ' · ยังไม่อ่าน'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
