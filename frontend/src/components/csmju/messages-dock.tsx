'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Maximize2, Send, SquarePen, X } from 'lucide-react';
import { DirectThread } from '@/components/csmju/direct-thread';
import {
  CHANNELS_KEY,
  InboxList,
  inFolder,
  isConversation,
  othersOf,
  sortInbox,
} from '@/components/csmju/inbox-list';
import { ComposePanel } from '@/components/csmju/messages-compose';
import { Avatar } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel } from '@/lib/csmju/types';

/// ข้อความลอยมุมขวาล่าง แบบ Instagram บนเว็บ
///
///   ปิด         ปุ่มยาว "ข้อความ" + เลขค้าง + รูปคู่สนทนาล่าสุด
///   เปิด        แผงรายชื่อแชท (หัว: ข้อความ · ขยาย · ปิด) + ปุ่มดินสอกลมมุมล่างขวา
///   ดินสอ       แผงสลับเป็นหน้า "ข้อความใหม่" ในที่ (เลือก ≥ 2 คน = แชทกลุ่ม)
///   เลือกคน     หน้าต่างคุยเล็กในแผงเดียวกัน (ย้อนกลับ · ขยาย · ปิด)
///
/// คุยได้โดยไม่ต้องออกจากหน้าที่ดูอยู่ — ซ่อนในหน้าที่เป็นหน้าคุยอยู่แล้ว
/// (ข้อความ · ห้องแชท · ห้องเสียง) ไม่งั้นจะลอยทับช่องพิมพ์ และเปิดห้องเดียวกัน
/// สองที่พร้อมกัน ซึ่งทำให้ปิดที่หนึ่งแล้วอีกที่หยุดรับข้อความสด
///
/// รายการเป็นกล่องหลัก + ทั่วไป (ไม่รวมคำขอและที่ซ่อนไว้) — คำขอมีลิงก์แยกไป
/// หน้าคำขอของ /messages เหมือนที่ IG แยกไว้
const HIDDEN_ON = ['/messages', '/chat', '/voice'];

export function MessagesDock() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [thread, setThread] = useState<Channel | null>(null);

  // กุญแจและ queryFn เดียวกับหน้า /messages และแถบซ้าย — แคชก้อนเดียว
  const { data: channels = [] } = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: async () => (await api.list<Channel>('/channels?limit=50')).items,
    refetchInterval: 30_000,
  });

  const inbox = useMemo(
    () => channels.filter((row) => inFolder(row, 'PRIMARY') || inFolder(row, 'GENERAL')),
    [channels],
  );
  const requests = channels.filter((row) => inFolder(row, 'REQUEST')).length;
  const unread = inbox.reduce((sum, row) => sum + row.unreadCount, 0);
  /// รูปเล็กบนปุ่มยาวแบบ IG: คนที่มีข้อความค้างอยู่ ถ้าไม่มีใครค้างเลยค่อยเป็นแชทล่าสุด
  const firstOthers = (rows: Channel[]) => [
    ...new Set(
      rows.map((row) => othersOf(row, me.id)[0]).filter((id): id is string => Boolean(id)),
    ),
  ];
  const unreadPeers = firstOthers(inbox.filter((row) => row.unreadCount > 0));
  const peers = unreadPeers.length > 0 ? unreadPeers : firstOthers(inbox);

  if (HIDDEN_ON.some((path) => pathname.startsWith(path))) return null;

  // ใช้ห้องล่าสุดจากแคชเสมอ — เลขยังไม่อ่านและข้อความล่าสุดจะได้ไม่ค้างค่าเก่า
  const current = thread
    ? (channels.filter(isConversation).find((row) => row.id === thread.id) ?? thread)
    : null;

  const close = () => {
    setOpen(false);
    setComposing(false);
    setThread(null);
  };

  if (!open) {
    return (
      <>
        {/* จอกว้าง: ปุ่มยาวแบบ Instagram บนคอม */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`ข้อความ${unread > 0 ? ` (${unread} ยังไม่อ่าน)` : ''}`}
          // เงาฟุ้งนุ่มแบบปุ่มข้อความของ IG บนเว็บ (ไม่ใช่เงาแข็งของการ์ด)
          className="fixed bottom-6 right-6 z-30 flex w-60 items-center gap-3 rounded-full border border-border bg-card px-5 py-3 shadow-[0_4px_24px_rgb(0_0_0/0.18)] transition-transform hover:-translate-y-0.5 max-lg:hidden"
        >
          <span className="relative">
            <Send aria-hidden className="size-6 -rotate-12" strokeWidth={2} />
            {unread > 0 && (
              <span className="absolute -right-2.5 -top-2 grid min-w-[1.125rem] place-items-center rounded-full bg-badge px-1 text-[11px] font-bold leading-[1.125rem] text-white ring-2 ring-card">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>

          <span className="flex-1 text-left text-[0.9375rem] font-semibold">ข้อความ</span>

          {peers.length > 0 && (
            <span aria-hidden className="flex -space-x-2">
              {peers.slice(0, 3).map((id) => (
                <span key={id} className="rounded-full ring-2 ring-card">
                  <Avatar coreUserId={id} size={26} showOnline={false} />
                </span>
              ))}
            </span>
          )}
        </button>

        {/* จอแคบ: ปุ่มกลมลอยเหนือแถบล่าง แบบ Instagram บนมือถือ */}
        <Link
          href="/messages"
          aria-label={`ข้อความ${unread > 0 ? ` (${unread} ยังไม่อ่าน)` : ''}`}
          className="fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-full border border-border bg-card shadow-csmju-lg lg:hidden"
        >
          <Send aria-hidden className="size-6 -rotate-12" strokeWidth={2} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-badge px-1 text-[11px] font-bold leading-5 text-white ring-2 ring-card">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
      </>
    );
  }

  return (
    <section
      aria-label="ข้อความ"
      className="fixed bottom-6 right-6 z-40 flex h-[min(38rem,calc(100dvh-3rem))] w-104 origin-bottom-right flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-csmju-lg animate-in fade-in-0 zoom-in-95 duration-150 max-lg:hidden"
    >
      {current ? (
        <DirectThread
          key={current.id}
          channel={current}
          variant="dock"
          onBack={() => setThread(null)}
          onClose={close}
          onExpand={() => {
            router.push(`/messages?channel=${encodeURIComponent(current.id)}`);
            close();
          }}
        />
      ) : composing ? (
        <ComposePanel
          recent={peers}
          onBack={() => setComposing(false)}
          onClose={close}
          onStarted={(channel) => {
            queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev = []) =>
              prev.some((row) => row.id === channel.id) ? prev : sortInbox([channel, ...prev]),
            );
            setComposing(false);
            setThread(channel);
          }}
        />
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
            <h2 className="text-lg font-bold">ข้อความ</h2>
            {unread > 0 && (
              <span className="grid min-w-5 place-items-center rounded-full bg-badge px-1.5 text-xs font-bold leading-5 text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}

            <Link
              href="/messages"
              onClick={close}
              aria-label="เปิดหน้าข้อความเต็มจอ"
              className="ml-auto grid size-9 place-items-center rounded-full hover:bg-accent"
            >
              <Maximize2 aria-hidden className="size-5" strokeWidth={1.9} />
            </Link>
            <button
              type="button"
              onClick={close}
              aria-label="ปิดข้อความ"
              className="grid size-9 place-items-center rounded-full hover:bg-accent"
            >
              <X aria-hidden className="size-6" strokeWidth={1.9} />
            </button>
          </header>

          {requests > 0 && (
            <Link
              href="/messages?view=requests"
              onClick={close}
              className="flex shrink-0 items-center justify-between px-4 pb-2 text-sm font-semibold text-link"
            >
              คำขอข้อความ ({requests})
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}

          <div className="relative min-h-0 flex-1 overflow-y-auto pb-20">
            {inbox.length === 0 ? (
              <p className="px-6 py-10 text-center text-csmju-label text-muted-foreground">
                ยังไม่มีข้อความ — กดปุ่มดินสอเพื่อเริ่มคุยกับเพื่อน
              </p>
            ) : (
              <InboxList
                channels={inbox}
                activeId={null}
                onOpen={(channel) => setThread(channel)}
              />
            )}
          </div>

          {/* ปุ่มดินสอกลมลอยมุมล่างขวาของแผง แบบ IG — สลับแผงเป็นหน้า "ข้อความใหม่" ในที่ */}
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label="ข้อความใหม่"
            title="ข้อความใหม่"
            className="absolute bottom-4 right-4 grid size-11 place-items-center rounded-full border border-border bg-popover text-popover-foreground shadow-lg transition-transform hover:scale-105"
          >
            <SquarePen aria-hidden className="size-5" strokeWidth={1.9} />
          </button>
        </>
      )}
    </section>
  );
}
