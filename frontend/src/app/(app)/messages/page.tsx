'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  Loader2,
  MessageCircle,
  Search,
  SquarePen,
  X,
} from 'lucide-react';
import { SwitchAccountDialog } from '@/components/csmju/account-dialogs';
import { DirectThread } from '@/components/csmju/direct-thread';
import {
  CHANNELS_KEY,
  InboxList,
  InboxRow,
  inFolder,
  isConversation,
  othersOf,
  RequestActions,
  sortInbox,
} from '@/components/csmju/inbox-list';
import { ComposeDialog } from '@/components/csmju/messages-compose';
import { NoteComposer, NotesRow } from '@/components/csmju/messages-notes';
import { useProfile } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, ProfileSummary } from '@/lib/csmju/types';

/// ข้อความส่วนตัวแบบ Instagram Direct บนเว็บ
///
/// ต่างจากหน้า "ห้องแชท" (Discord/Teams) ที่เน้นห้องกลุ่มและเธรด — หน้านี้
/// เน้นคุยกันแบบ IG: แชทส่วนตัวและแชทกลุ่มเล็ก เป็นสองคอลัมน์ รายการทางซ้าย
/// บทสนทนาทางขวา (จอแคบเห็นทีละฝั่ง)
///
/// สถานะที่อยู่ใน URL ไม่ใช่ state — การแจ้งเตือนและหน้าต่างแชทลอยพามาถูกที่
/// ได้ตรง ๆ และปุ่มย้อนกลับของเบราว์เซอร์ทำงานแบบ IG:
///   `?channel=<id>`        เปิดบทสนทนา
///   `?compose=1`           กล่อง "ข้อความใหม่"
///   `?view=requests|hidden` หน้าคำขอข้อความ / คำขอที่ซ่อนไว้
///
/// แท็บ หลัก/ทั่วไป/คำขอ มาจาก `inboxFolder` ที่หลังบ้านตัดสินให้ทุกห้อง

type Tab = 'PRIMARY' | 'GENERAL';
type View = 'inbox' | 'requests' | 'hidden';

export default function MessagesPage() {
  // useSearchParams ต้องอยู่ใต้ Suspense ไม่งั้น build แบบ prerender ล้ม
  // (node_modules/next/dist/docs/.../use-search-params.md หัวข้อ Prerendering)
  return (
    <Suspense fallback={null}>
      <MessagesInbox />
    </Suspense>
  );
}

/// เปลี่ยน query string โดยไม่โหลดหน้าใหม่ — Next ผูก pushState/replaceState
/// เข้ากับ useSearchParams ให้แล้ว หน้าจอจึงวาดตาม URL เอง
function navigate(
  mode: 'push' | 'replace',
  params: Record<string, string | null>,
) {
  const next = new URLSearchParams(window.location.search);

  for (const [key, value] of Object.entries(params)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }

  const query = next.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;

  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

function MessagesInbox() {
  const params = useSearchParams();
  const activeId = params.get('channel');
  const composing = params.get('compose') === '1';
  /// หน้า "โน้ตใหม่" แทนที่คอลัมน์ขวา (จอแคบแทนที่ทั้งจอ) แบบ IG
  const writingNote = params.get('note') === '1';
  const viewParam = params.get('view');
  const view: View = viewParam === 'requests' || viewParam === 'hidden' ? viewParam : 'inbox';
  const [tab, setTab] = useState<Tab>('PRIMARY');
  const [query, setQuery] = useState('');
  const [switching, setSwitching] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const me = useMe();
  const myProfile = useProfile(me.id);
  const queryClient = useQueryClient();

  // กุญแจและ queryFn ต้องตรงกับตัวเลขบนแถบซ้าย (useDirectUnread) ทุกตัวอักษร
  // — แคชเดียวกัน อ่านข้อความที่นี่แล้วตัวเลขตรงนั้นหายตามทันที
  const {
    data: channels = [],
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: async () => (await api.list<Channel>('/channels?limit=50')).items,
    // หลังบ้านไม่มี event "มีข้อความใหม่ในห้องที่คุณไม่ได้เปิด" — ห้องที่เปิดอยู่
    // สดผ่าน socket ส่วนห้องอื่นอาศัยรอบดึงนี้ (เท่ากับของแถบซ้าย)
    refetchInterval: 30_000,
  });

  const conversations = useMemo(() => channels.filter(isConversation), [channels]);
  const requests = conversations.filter((row) => inFolder(row, 'REQUEST'));
  const hiddenOnes = conversations.filter((row) => inFolder(row, 'HIDDEN'));

  const term = query.trim().toLowerCase();
  const peopleIds = useMemo(
    () => [...new Set(conversations.flatMap((row) => othersOf(row, me.id)))],
    [conversations, me.id],
  );

  // ค้นด้วยชื่อที่แสดง ไม่ใช่แค่ user id — คนจำชื่อเพื่อน ไม่ได้จำ "user-003"
  // ดึงเฉพาะตอนเริ่มพิมพ์ค้น เพราะตอนปกติแต่ละแถวดึงชื่อของตัวเองอยู่แล้ว
  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles', 'dm-peers', peopleIds.join(',')],
    queryFn: () =>
      api.get<ProfileSummary[]>(
        `/profiles?coreUserIds=${peopleIds.map(encodeURIComponent).join(',')}`,
      ),
    enabled: term !== '' && peopleIds.length > 0,
    staleTime: 60_000,
  });

  const source =
    view === 'requests'
      ? requests
      : view === 'hidden'
        ? hiddenOnes
        : conversations.filter((row) => inFolder(row, tab));

  const visible = useMemo(() => {
    if (!term) return source;

    return source.filter((channel) => {
      if (channel.name?.toLowerCase().includes(term)) return true;

      return othersOf(channel, me.id).some((id) => {
        const name = profiles.find((row) => row.coreUserId === id)?.displayName ?? '';

        return id.toLowerCase().includes(term) || name.toLowerCase().includes(term);
      });
    });
  }, [source, term, profiles, me.id]);

  // ลิงก์ตรงมาที่ห้องที่ไม่อยู่ใน 50 ห้องล่าสุด (หรือเพิ่งถูกสร้าง) ต้องยังเปิดได้
  const listed = conversations.find((channel) => channel.id === activeId) ?? null;
  const { data: fetched, error: fetchError } = useQuery({
    queryKey: ['channels', 'one', activeId],
    queryFn: () => api.get<Channel>(`/channels/${activeId}`),
    enabled: Boolean(activeId) && !loading && !listed,
    retry: false,
  });
  const active = listed ?? (fetched?.id === activeId ? fetched : null);

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดรายการข้อความไม่สำเร็จ — หลังบ้านรันอยู่ไหม'
    : null;

  function open(channel: Channel) {
    if (channel.id !== activeId) navigate('push', { channel: channel.id });
  }

  function started(channel: Channel) {
    queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (prev = []) =>
      prev.some((row) => row.id === channel.id) ? prev : sortInbox([channel, ...prev]),
    );
    navigate('push', { compose: null, view: null, channel: channel.id });
  }

  /// กดโน้ตของใครแล้วคุยกับคนนั้นเลย แบบ IG (หาห้องเดิมก่อนสร้างใหม่)
  async function chatWith(coreUserId: string) {
    setStartError(null);

    try {
      started(
        await api.post<Channel>('/direct-channels', { peerCoreUserIds: [coreUserId] }),
      );
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : 'เปิดแชทไม่สำเร็จ');
    }
  }

  // ชื่อบัญชีแบบ IG — ถ้ายังไม่มีชื่อที่แสดงใน Core ใช้ส่วนหน้าของอีเมลแทน user id
  const accountName =
    myProfile.displayName === me.id ? me.email.split('@')[0] : myProfile.displayName;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'PRIMARY', label: 'หลัก' },
    { value: 'GENERAL', label: 'ทั่วไป' },
  ];

  return (
    // จอแคบหักทั้งแถบบน (3.25rem) และแถบล่าง (3rem + ขอบล่างของเครื่อง) —
    // ถ้าหักแค่แถบบน ช่องพิมพ์จะจมอยู่ใต้แถบล่างพอดี ต้องเลื่อนหน้าก่อนถึงจะพิมพ์ได้
    <div className="flex h-[calc(100dvh-6.25rem-env(safe-area-inset-bottom))] lg:h-dvh">
      {/* ── คอลัมน์ซ้าย: รายการบทสนทนา ── */}
      <section
        aria-label="รายการข้อความ"
        className={`flex w-full shrink-0 flex-col border-r border-border md:w-[340px] lg:w-[397px] ${
          activeId || writingNote ? 'max-md:hidden' : ''
        }`}
      >
        {view === 'inbox' ? (
          <div className="flex h-[75px] shrink-0 items-center justify-between gap-2 px-6 pt-3 max-md:px-4">
            <button
              type="button"
              onClick={() => setSwitching(true)}
              aria-haspopup="dialog"
              aria-label={`${accountName} — สลับบัญชี`}
              className="flex min-w-0 items-center gap-1 text-xl font-bold"
            >
              <span className="truncate">{accountName}</span>
              <ChevronDown aria-hidden className="size-4 shrink-0" strokeWidth={2.4} />
            </button>

            <button
              type="button"
              onClick={() => navigate('push', { compose: '1' })}
              aria-label="ข้อความใหม่"
              title="ข้อความใหม่"
              className="grid size-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-accent"
            >
              <SquarePen className="size-6" strokeWidth={1.9} />
            </button>
          </div>
        ) : (
          <div className="flex h-[75px] shrink-0 items-center gap-3 px-4 pt-3">
            <button
              type="button"
              onClick={() =>
                navigate('replace', { view: view === 'hidden' ? 'requests' : null })
              }
              aria-label={view === 'hidden' ? 'กลับไปคำขอข้อความ' : 'กลับไปกล่องข้อความ'}
              className="grid size-10 place-items-center rounded-full transition-colors hover:bg-accent"
            >
              <ChevronLeft className="size-7" strokeWidth={1.9} />
            </button>
            <h1 className="text-xl font-bold">
              {view === 'hidden' ? 'คำขอที่ซ่อนไว้' : 'คำขอข้อความ'}
            </h1>
          </div>
        )}

        <div className="px-6 pb-2 pt-1 max-md:px-4">
          <label className="flex h-10 items-center gap-2.5 rounded-full bg-muted px-4 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden className="size-4 shrink-0" strokeWidth={2.2} />
            <span className="sr-only">ค้นหาบทสนทนา</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหา"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="ล้างคำค้น"
                className="grid size-5 place-items-center rounded-full bg-muted-foreground/40 text-background"
              >
                <X className="size-3" strokeWidth={3} />
              </button>
            )}
          </label>
        </div>

        {view === 'inbox' && (
          <>
            {/* แถวโน้ตแบบ IG — ตำแหน่งเดียวกับที่ IG วางไว้เหนือแท็บ */}
            <NotesRow
              onOpenChat={(id) => void chatWith(id)}
              onEditMine={() => navigate('push', { note: '1', channel: null })}
            />
            {startError && (
              <p role="alert" className="px-6 pb-2 text-xs text-destructive">
                {startError}
              </p>
            )}

            <div
              role="tablist"
              aria-label="แฟ้มข้อความ"
              className="flex shrink-0 border-b border-border px-6 max-md:px-4"
            >
              {tabs.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`-mb-px flex-1 border-b py-3 text-sm font-semibold transition-colors ${
                    tab === value
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
              {/* คำขอไม่ใช่แท็บที่กรองในที่ แต่เปิดหน้าของมันเอง แบบ IG */}
              <button
                type="button"
                onClick={() => navigate('push', { view: 'requests' })}
                className="-mb-px flex-1 border-b border-transparent py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                {requests.length > 0 ? `คำขอ (${requests.length})` : 'คำขอ'}
              </button>
            </div>
          </>
        )}

        {view === 'requests' && (
          <div className="shrink-0 border-b border-border px-6 pb-3 max-md:px-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              คำขอข้อความมาจากคนที่คุณไม่ได้ติดตาม — เขาจะไม่รู้ว่าคุณเห็นข้อความแล้ว
              จนกว่าคุณจะยอมรับหรือตอบกลับ
            </p>
            <button
              type="button"
              onClick={() => navigate('push', { view: 'hidden' })}
              className="mt-2 text-sm font-semibold text-link"
            >
              คำขอที่ซ่อนไว้{hiddenOnes.length > 0 ? ` (${hiddenOnes.length})` : ''}
            </button>
          </div>
        )}

        {view === 'hidden' && (
          <p className="shrink-0 border-b border-border px-6 pb-3 text-xs leading-relaxed text-muted-foreground max-md:px-4">
            คำขอที่คุณซ่อนไว้ ยอมรับเพื่อย้ายไปกล่องหลัก หรือลบทิ้ง
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pt-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]">
          {loading && <InboxSkeleton />}

          {error && (
            <p role="alert" className="px-6 py-6 text-sm text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="px-6 py-10 text-center text-sm leading-relaxed text-muted-foreground">
              {term
                ? `ไม่พบบทสนทนาที่ตรงกับ "${query.trim()}"`
                : view === 'requests'
                  ? 'ไม่มีคำขอข้อความ'
                  : view === 'hidden'
                    ? 'ไม่มีคำขอที่ซ่อนไว้'
                    : tab === 'GENERAL'
                      ? 'ยังไม่มีแชทในทั่วไป — ย้ายแชทมาที่นี่ได้จากเมนู ⋯ ของแต่ละแชท'
                      : 'ยังไม่มีบทสนทนา — กดไอคอนดินสอเพื่อเริ่มคุย'}
            </p>
          )}

          {view === 'inbox' ? (
            <InboxList channels={visible} activeId={activeId} onOpen={open} />
          ) : (
            <ul aria-label={view === 'hidden' ? 'คำขอที่ซ่อนไว้' : 'คำขอข้อความ'}>
              {visible.map((channel) => (
                <li key={channel.id}>
                  <InboxRow
                    channel={channel}
                    active={channel.id === activeId}
                    onOpen={open}
                    actions={false}
                    footer={
                      <RequestActions
                        channel={channel}
                        className="px-6 pb-3 pl-[5.75rem] max-md:px-4 max-md:pl-[5.25rem]"
                        onGone={() => {
                          if (channel.id === activeId) navigate('replace', { channel: null });
                        }}
                      />
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── คอลัมน์ขวา: บทสนทนา หรือสถานะว่าง ── */}
      {writingNote ? (
        <NoteComposer onClose={() => navigate('replace', { note: null })} />
      ) : active ? (
        <DirectThread
          channel={active}
          variant="page"
          onBack={() => navigate('replace', { channel: null })}
        />
      ) : activeId ? (
        <div className="grid flex-1 place-items-center px-6 text-center">
          {fetchError ? (
            <div>
              <p className="text-base font-semibold">เปิดบทสนทนานี้ไม่ได้</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {fetchError instanceof ApiError
                  ? fetchError.message
                  : 'ไม่พบบทสนทนา หรือคุณไม่ได้เป็นสมาชิก'}
              </p>
              <button
                type="button"
                onClick={() => navigate('replace', { channel: null })}
                className="mt-4 text-sm font-semibold text-link"
              >
                กลับไปรายการข้อความ
              </button>
            </div>
          ) : (
            <Loader2 aria-label="กำลังโหลด" className="size-6 animate-spin text-muted-foreground" />
          )}
        </div>
      ) : (
        <EmptyState onCompose={() => navigate('push', { compose: '1' })} />
      )}

      <ComposeDialog
        open={composing}
        recent={peopleIds}
        onClose={() => navigate('replace', { compose: null })}
        onStarted={started}
      />

      <SwitchAccountDialog open={switching} onOpenChange={setSwitching} />
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div aria-label="กำลังโหลดบทสนทนา" role="status">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-3 px-6 py-2">
          <span className="size-14 shrink-0 animate-pulse rounded-full bg-muted" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-32 animate-pulse rounded-full bg-muted" />
            <span className="block h-2.5 w-48 animate-pulse rounded-full bg-muted" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="grid min-w-0 flex-1 place-items-center px-6 max-md:hidden">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-24 place-items-center rounded-full border-2 border-foreground">
          <MessageCircle aria-hidden className="size-12" strokeWidth={1.5} />
        </span>

        <h2 className="mt-4 text-xl">ข้อความของคุณ</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ส่งข้อความส่วนตัวหาเพื่อนหรือกลุ่ม
        </p>

        <button
          type="button"
          onClick={onCompose}
          className="mt-5 rounded-lg bg-primary px-4 py-[7px] text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          ส่งข้อความ
        </button>
      </div>
    </div>
  );
}
