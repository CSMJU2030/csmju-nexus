'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldAlert, Trash } from 'lucide-react';
import { UserName } from '@/components/csmju/user-name';
import MemberList from '@/components/ui/member-list';
import { api, ApiError } from '@/lib/csmju/api';
import { isStaffLike } from '@/lib/csmju/roles';
import { useMe } from '@/lib/csmju/session';
import type {
  AdminOverview,
  AuditLog,
  Report,
} from '@/lib/csmju/types';

/// แผงผู้ดูแลระบบย่อย
///
/// สิ่งที่แก้ที่นี่ได้คือ **Layer 2 เท่านั้น** เพราะเป็น Local Data ของระบบย่อย
/// (Blueprint หน้า 11) — Layer 1 (student/staff/admin) ต้องไปแก้ที่
/// Admin Panel กลาง หน้านี้ไม่แตะ
///
/// ทุกการเปลี่ยนสิทธิ์และโควตาเขียนลง audit log ในทรานแซกชันเดียวกับการแก้
/// จึงตรวจย้อนหลังได้ว่าใครเปลี่ยนอะไรตอนไหนและด้วยเหตุผลอะไร

type Tab = 'overview' | 'members' | 'audit' | 'reports';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const me = useMe();

  // อาจารย์ (lecturer) ใช้สิทธิ์ชุดเดียวกับเจ้าหน้าที่ (standards 1.6.0+)
  const canSeePanel = isStaffLike(me.coreRole);

  if (!canSeePanel) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex items-start gap-3 csmju-surface p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <h1 className="font-semibold">ไม่มีสิทธิ์เข้าแผงนี้</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              เฉพาะบุคลากรและผู้ดูแลระดับองค์กร · สลับตัวตนที่มุมซ้ายล่างเพื่อลอง
              ในโหมดพัฒนา
            </p>
          </div>
        </div>
      </div>
    );
  }

  const TABS: { value: Tab; label: string; adminOnly: boolean }[] = [
    { value: 'overview', label: 'ภาพรวม', adminOnly: false },
    { value: 'members', label: 'สมาชิกและสิทธิ์', adminOnly: false },
    { value: 'reports', label: 'เรื่องร้องเรียน', adminOnly: false },
    { value: 'audit', label: 'Audit log', adminOnly: true },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-csmju-display">แผงผู้ดูแล</h1>
        <p className="text-sm text-muted-foreground">
          แก้ได้เฉพาะสิทธิ์ในระบบย่อยนี้ (Layer 2) · สิทธิ์ระดับองค์กรแก้ที่
          Admin Panel กลาง
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setTab(option.value)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              tab === option.value
                ? 'border-primary bg-secondary text-secondary-foreground'
                : 'border-border hover:bg-accent'
            }`}
          >
            {option.label}
            {option.adminOnly && me.coreRole !== 'admin' && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                admin
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'members' && (
        <div className="overflow-hidden rounded-xl border border-border">
          <MemberList />
        </div>
      )}
      {tab === 'reports' && <Reports />}
      {tab === 'audit' && <AuditTrail />}
    </div>
  );
}

function formatBytes(value: string): string {
  const bytes = Number(value);

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;

  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function Panel({
  error,
  loading,
  children,
}: {
  error: string | null;
  loading: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        กำลังโหลด…
      </p>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }

  return <>{children}</>;
}

function Overview() {
  const {
    data,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.get<AdminOverview>('/admin-overview'),
  });

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดภาพรวมไม่สำเร็จ'
    : null;

  return (
    <Panel loading={loading} error={error}>
      {data && (
        <>
          <dl className="grid gap-2 sm:grid-cols-3">
            {[
              { label: 'สมาชิกระบบย่อย', value: data.memberCount },
              { label: 'คลิป', value: data.reelCount },
              { label: 'กระทู้', value: data.postCount },
              { label: 'ข้อความ', value: data.messageCount },
              { label: 'ห้อง', value: data.channelCount },
              { label: 'ห้องเสียงที่เปิดอยู่', value: data.activeVoiceSessionCount },
            ].map((stat) => (
              <div
                key={stat.label}
                className="csmju-surface px-3 py-2.5"
              >
                <dd className="text-xl font-semibold tabular-nums">
                  {stat.value}
                </dd>
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              </div>
            ))}
          </dl>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="csmju-surface px-3 py-2.5">
              <p className="text-xs text-muted-foreground">พื้นที่ที่ใช้ไป</p>
              <p className="text-lg font-semibold">
                {formatBytes(data.storageUsedBytes)}
              </p>
            </div>

            <div
              className={`rounded-xl border px-3 py-2.5 ${
                data.openReportCount > 0
                  ? 'border-warning/40 bg-warning/5'
                  : 'border-border bg-card'
              }`}
            >
              <p className="text-xs text-muted-foreground">เรื่องร้องเรียนค้าง</p>
              <p className="text-lg font-semibold tabular-nums">
                {data.openReportCount}
              </p>
            </div>
          </div>

          <div className="mt-3 csmju-surface p-3">
            <p className="text-sm font-medium">
              การแปลงสิทธิ์ Layer 1 → Layer 2
            </p>
            <p className="mb-2 text-xs text-muted-foreground">
              ต้องตรงกับ default_role_mapping ใน subsystem.yaml ที่ยื่นให้ PM
            </p>

            <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
              {Object.entries(data.defaultRoleMapping).map(([from, to]) => (
                <li key={from} className="rounded bg-muted px-2 py-1">
                  <span className="font-mono text-xs">{from}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-mono text-xs">{to}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            ระบบย่อย {data.subsystem} · มาตรฐานรุ่น {data.standardsVersion}
          </p>
        </>
      )}
    </Panel>
  );
}

function Reports() {
  const queryClient = useQueryClient();
  const reportsKey = ['reports'] as const;

  const {
    data: reports = [],
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: reportsKey,
    queryFn: async () => {
      const page = await api.list<Report>('/reports?limit=50');

      return page.items;
    },
  });

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดคิวไม่สำเร็จ'
    : null;

  function setReports(update: (prev: Report[]) => Report[]) {
    queryClient.setQueryData<Report[]>(reportsKey, (current) =>
      update(current ?? []),
    );
  }

  async function resolve(report: Report, status: 'RESOLVED' | 'REJECTED') {
    const updated = await api.patch<Report>(`/reports/${report.id}`, {
      status,
      note: 'ปิดจากแผงผู้ดูแล',
    });

    setReports((prev) =>
      prev.map((row) => (row.id === report.id ? updated : row)),
    );
  }

  return (
    <Panel loading={loading} error={error}>
      {reports.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ไม่มีเรื่องค้างในคิว
        </p>
      ) : (
        <ul className="space-y-2">
          {reports.map((report) => (
            <li
              key={report.id}
              className="csmju-surface p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {report.targetKind}
                </span>
                <span className="font-mono">{report.targetId.slice(0, 8)}…</span>
                <span>
                  แจ้งโดย <UserName coreUserId={report.reporterCoreUserId} />
                </span>
                <span className="ml-auto">
                  {new Date(report.createdAt).toLocaleString('th-TH')}
                </span>
              </div>

              <p className="mt-1.5 text-sm">{report.reason}</p>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void resolve(report, 'RESOLVED')}
                  className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                >
                  จัดการแล้ว
                </button>
                <button
                  type="button"
                  onClick={() => void resolve(report, 'REJECTED')}
                  className="rounded-lg border border-border px-3 py-1 text-xs"
                >
                  ไม่เข้าข่าย
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AuditTrail() {
  const [action, setAction] = useState('');
  const {
    data: logs = [],
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['audit-logs', action],
    queryFn: async () => {
      const page = await api.list<AuditLog>(
        `/audit-logs?limit=50${action ? `&action=${encodeURIComponent(action)}` : ''}`,
      );

      return page.items;
    },
  });

  // นักศึกษาและบุคลากรจะได้ 403 ที่นี่ ซึ่งถูกต้องแล้ว
  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'อ่าน audit log ไม่สำเร็จ'
    : null;

  const ACTIONS = [
    '',
    'reel.delete',
    'post.delete',
    'message.delete',
    'report.resolved',
    'report.rejected',
    'member.role_change',
    'member.quota_change',
  ];

  return (
    <>
      <select
        value={action}
        onChange={(event) => setAction(event.target.value)}
        className="mb-3 rounded-lg border border-input bg-card px-2 py-1.5 text-sm"
      >
        {ACTIONS.map((value) => (
          <option key={value} value={value}>
            {value === '' ? 'ทุกการกระทำ' : value}
          </option>
        ))}
      </select>

      <Panel loading={loading} error={error}>
        {logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ยังไม่มีบันทึก
          </p>
        ) : (
          <ul className="space-y-1.5">
            {logs.map((log) => (
              <li
                key={log.id}
                className="csmju-surface px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Trash className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs">{log.action}</span>
                  <span className="text-xs text-muted-foreground">
                    โดย {log.actorCoreUserId} ({log.actorCoreRole})
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('th-TH')}
                  </span>
                </div>

                {log.metadata && (
                  <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] leading-relaxed">
                    {JSON.stringify(log.metadata, null, 1)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
