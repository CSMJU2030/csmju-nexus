'use client';

import { useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { CalendarPlus, Loader2, Video, XCircle } from 'lucide-react';
import Link from 'next/link';
import { UserName } from '@/components/csmju/user-name';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, Meeting } from '@/lib/csmju/types';

/// นัดประชุมล่วงหน้าแบบ Microsoft Teams
///
/// นัดผูกกับห้องเสมอ — สิทธิ์การเห็นนัดยืมมาจากสมาชิกของห้อง จึงไม่มีตาราง
/// ผู้ได้รับเชิญแยก (ถ้ามีสองรายการ มันจะไม่ตรงกันทันทีที่คนเข้า/ออกห้อง)
///
/// `joinableNow` คำนวณจากเวลาเซิร์ฟเวอร์ ไม่ใช่นาฬิกาเครื่องผู้ใช้ —
/// เครื่องที่ตั้งเวลาผิดจะเห็นปุ่มเข้าห้องโผล่ผิดเวลาถ้าคำนวณที่หน้าบ้าน

export default function MeetingsPage() {
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const me = useMe();
  const queryClient = useQueryClient();

  const meetingsKey = ['meetings', upcomingOnly] as const;

  const {
    data,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: meetingsKey,
    queryFn: async () => {
      const [page, channelPage] = await Promise.all([
        api.list<Meeting>(
          `/meetings?limit=50&upcomingOnly=${upcomingOnly}`,
        ),
        api.list<Channel>('/channels?limit=50'),
      ]);

      return { meetings: page.items, channels: channelPage.items };
    },
  });

  const meetings = data?.meetings ?? [];
  const channels = data?.channels ?? [];


  function setMeetings(update: (prev: Meeting[]) => Meeting[]) {
    queryClient.setQueryData<{ meetings: Meeting[]; channels: Channel[] }>(
      meetingsKey,
      (current) => ({
        meetings: update(current?.meetings ?? []),
        channels: current?.channels ?? [],
      }),
    );
  }

  const cancelMutation = useMutation({
    mutationFn: (meeting: Meeting) =>
      api.del<Meeting>(`/meetings/${meeting.id}`),
    onSuccess: (updated, meeting) => {
      setMeetings((prev) =>
        prev.map((row) => (row.id === meeting.id ? updated : row)),
      );
    },
  });

  const cancelError = cancelMutation.error;

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดนัดประชุมไม่สำเร็จ'
    : cancelError
      ? cancelError instanceof ApiError
        ? cancelError.message
        : 'ยกเลิกไม่สำเร็จ'
      : null;

  function cancel(meeting: Meeting) {
    cancelMutation.mutate(meeting);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-csmju-display">นัดประชุม</h1>
        <p className="text-sm text-muted-foreground">
          นัดติวหรือประชุมล่วงหน้า แล้วเข้าห้องเสียงของห้องนั้นเมื่อถึงเวลา
        </p>
      </header>

      <Scheduler
        channels={channels}
        onCreated={(meeting) => setMeetings((prev) => [meeting, ...prev])}
      />

      <label className="my-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={upcomingOnly}
          onChange={(event) => setUpcomingOnly(event.target.checked)}
          className="size-4 accent-[var(--csmju-primary)]"
        />
        เอาเฉพาะนัดที่ยังไม่จบ
      </label>

      {loading && (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลด…
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && meetings.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีนัดประชุมในห้องที่คุณเป็นสมาชิก
        </p>
      )}

      <ul className="space-y-2">
        {meetings.map((meeting) => {
          const channel = channels.find((row) => row.id === meeting.channelId);
          const cancelled = meeting.status === 'CANCELLED';

          return (
            <li
              key={meeting.id}
              className={`csmju-surface p-4 ${cancelled ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2
                    className={`font-semibold leading-snug ${cancelled ? 'line-through' : ''}`}
                  >
                    {meeting.title}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {new Date(meeting.startsAt).toLocaleString('th-TH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' – '}
                    {new Date(meeting.endsAt).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    ห้อง {channel?.name ?? meeting.channelId} · นัดโดย{' '}
                    <UserName
                      coreUserId={meeting.createdByCoreUserId}
                      className="text-xs"
                    />
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    cancelled
                      ? 'bg-destructive/10 text-destructive'
                      : meeting.joinableNow
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {cancelled
                    ? 'ยกเลิกแล้ว'
                    : meeting.joinableNow
                      ? 'เข้าได้แล้ว'
                      : 'ยังไม่ถึงเวลา'}
                </span>
              </div>

              {meeting.agenda && (
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {meeting.agenda}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {meeting.joinableNow && !cancelled && (
                  <Link
                    href="/voice"
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  >
                    <Video className="size-4" />
                    เข้าห้องเสียง
                  </Link>
                )}

                {!cancelled &&
                  (meeting.createdByCoreUserId === me.id ||
                    me.coreRole === 'admin') && (
                    <button
                      type="button"
                      onClick={() => void cancel(meeting)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XCircle className="size-4" />
                      ยกเลิกนัด
                    </button>
                  )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/// ค่าเริ่มต้นของฟอร์ม: พรุ่งนี้ 13:00–15:00
///
/// ใส่ค่าเริ่มต้นที่ใช้งานได้จริงเพราะฟอร์มเปล่าทำให้คนต้องพิมพ์วันเวลาเอง
/// แล้วพิมพ์ผิดรูปแบบ — ซึ่งเป็นทางที่ทำให้เจอ error "ต้องเป็น ISO 8601"
function defaultRange() {
  const start = new Date();

  start.setDate(start.getDate() + 1);
  start.setHours(13, 0, 0, 0);

  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const format = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

  return { start: format(start), end: format(end) };
}

function Scheduler({
  channels,
  onCreated,
}: {
  channels: Channel[];
  onCreated: (meeting: Meeting) => void;
}) {
  const initial = defaultRange();
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [startsAt, setStartsAt] = useState(initial.start);
  const [endsAt, setEndsAt] = useState(initial.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = channels.filter((channel) => channel.kind !== 'DM');

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const meeting = await api.post<Meeting>('/meetings', {
        channelId: channelId || eligible[0]?.id,
        title: title.trim(),
        ...(agenda.trim() ? { agenda: agenda.trim() } : {}),
        // input type=datetime-local ให้เวลาแบบไม่มี timezone —
        // new Date() ตีความเป็นเวลาท้องถิ่น แล้ว toISOString แปลงเป็น UTC ให้
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });

      onCreated(meeting);
      setOpen(false);
      setTitle('');
      setAgenda('');
    } catch (caught) {
      // เช่น "นัดประชุมยาวสุด 8 ชั่วโมง" หรือ
      // "เฉพาะผู้ดูแลห้องหรืออาจารย์เท่านั้นที่นัดประชุมได้"
      setError(caught instanceof Error ? caught.message : 'นัดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card py-3 text-sm font-medium transition-colors hover:bg-accent"
      >
        <CalendarPlus className="size-4" />
        นัดประชุมใหม่
      </button>
    );
  }

  return (
    <div className="space-y-2 csmju-surface p-3">
      <select
        value={channelId}
        onChange={(event) => setChannelId(event.target.value)}
        className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
      >
        <option value="">— เลือกห้อง —</option>
        {eligible.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.name ?? channel.id}
          </option>
        ))}
      </select>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="หัวข้อ เช่น ติวก่อนสอบกลางภาค CS201"
        className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
      />

      <textarea
        value={agenda}
        onChange={(event) => setAgenda(event.target.value)}
        placeholder="วาระ (ไม่ใส่ก็ได้)"
        rows={2}
        className="w-full resize-y rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          เริ่ม
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="mt-0.5 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>

        <label className="text-xs text-muted-foreground">
          สิ้นสุด
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="mt-0.5 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>

      <p className="text-[11px] text-muted-foreground">
        นัดสั้นสุด 5 นาที ยาวสุด 8 ชั่วโมง · สมาชิกทุกคนในห้องจะได้รับแจ้งเตือน
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !title.trim() || (!channelId && !eligible[0])}
          onClick={() => void submit()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          นัดประชุม
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
