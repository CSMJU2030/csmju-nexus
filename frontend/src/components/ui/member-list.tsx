'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HardDrive,
  Loader2,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  UserAvatar,
  useOnlineSet,
  VerifiedBadge,
  type Badge,
} from '@/components/csmju/user-badge';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Layer2Role, ProfileSummary } from '@/lib/csmju/types';

/// รายชื่อสมาชิกของระบบย่อยสำหรับผู้ดูแล
///
/// ต่อกับ GET /subsystem-members ที่คืนสิทธิ์และโควตาของทุกคน
/// (บุคลากรดูได้ · เปลี่ยนสิทธิ์กับโควตาได้เฉพาะผู้ดูแลระดับองค์กร)
///
/// `layer2RoleExplicit` ที่หลังบ้านส่งมาสำคัญกว่าที่คิด: มันแยก
/// "ผู้ดูแลตั้งค่านี้ด้วยมือ" ออกจาก "ค่านี้แปลงมาจากสิทธิ์องค์กรอัตโนมัติ"
/// ถ้าไม่แสดง ผู้ดูแลจะไม่รู้ว่าค่าที่เห็นเป็นการตัดสินใจของใคร

interface MemberRow {
  coreUserId: string;
  layer2Role: Layer2Role;
  layer2RoleExplicit: boolean;
  storageUsedBytes: string;
  storageQuotaBytes: string;
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABEL: Record<Layer2Role, string> = {
  ADMIN: 'ผู้ดูแล',
  EDITOR: 'อาจารย์/บุคลากร',
  GUEST: 'สมาชิกทั่วไป',
};

const badgeFor = (role: Layer2Role): Badge =>
  role === 'ADMIN' ? 'ADMIN' : role === 'EDITOR' ? 'STAFF' : null;

function formatBytes(value: string): string {
  const bytes = Number(value);

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;

  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function MemberList() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [names, setNames] = useState<Map<string, ProfileSummary>>(new Map());
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Layer2Role | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const online = useOnlineSet();
  const me = useMe();
  const isAdmin = me.coreRole === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const page = await api.list<MemberRow>(
        `/subsystem-members${qs({
          limit: 100,
          q: query.trim() || undefined,
          layer2Role: roleFilter || undefined,
        })}`,
      );

      setMembers(page.items);

      // แปลง coreUserId เป็นชื่อจริงในคำขอเดียว ไม่ยิงทีละคน
      if (page.items.length > 0) {
        const profiles = await api.get<ProfileSummary[]>(
          `/profiles?coreUserIds=${page.items
            .map((row) => encodeURIComponent(row.coreUserId))
            .join(',')}`,
        );

        setNames(new Map(profiles.map((row) => [row.coreUserId, row])));
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'โหลดรายชื่อสมาชิกไม่สำเร็จ',
      );
    } finally {
      setLoading(false);
    }
  }, [query, roleFilter]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);

    return () => clearTimeout(timer);
  }, [load]);

  async function changeRole(member: MemberRow, role: Layer2Role) {
    setNotice(null);

    try {
      const updated = await api.patch<MemberRow>(
        `/subsystem-members/${encodeURIComponent(member.coreUserId)}/role`,
        { layer2Role: role, reason: 'เปลี่ยนจากรายชื่อสมาชิก' },
      );

      setMembers((prev) =>
        prev.map((row) => (row.coreUserId === member.coreUserId ? updated : row)),
      );
    } catch (caught) {
      // เช่น "คุณเป็นผู้ดูแลคนสุดท้ายของระบบย่อยนี้"
      setNotice(caught instanceof Error ? caught.message : 'เปลี่ยนไม่สำเร็จ');
    }
  }

  async function changeQuota(member: MemberRow, megabytes: number) {
    setNotice(null);

    try {
      const updated = await api.patch<MemberRow>(
        `/subsystem-members/${encodeURIComponent(member.coreUserId)}/storage-quota`,
        {
          storageQuotaBytes: megabytes * 1024 * 1024,
          reason: 'ตั้งจากรายชื่อสมาชิก',
        },
      );

      setMembers((prev) =>
        prev.map((row) => (row.coreUserId === member.coreUserId ? updated : row)),
      );
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'ตั้งโควตาไม่สำเร็จ');
    }
  }

  const summary = useMemo(() => {
    const counts = { ADMIN: 0, EDITOR: 0, GUEST: 0 };

    for (const member of members) {
      counts[member.layer2Role] += 1;
    }

    return counts;
  }, [members]);

  return (
    <div className="flex h-full flex-col bg-card">
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users className="size-4 text-muted-foreground" />
            สมาชิกระบบย่อย
          </h2>

          <p className="text-xs text-muted-foreground">
            ผู้ดูแล {summary.ADMIN} · อาจารย์ {summary.EDITOR} · ทั่วไป{' '}
            {summary.GUEST}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาจากรหัสผู้ใช้"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(event) =>
              setRoleFilter(event.target.value as Layer2Role | '')
            }
            aria-label="กรองตามสิทธิ์"
            className="rounded-lg border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="">ทุกสิทธิ์</option>
            <option value="ADMIN">ผู้ดูแล</option>
            <option value="EDITOR">อาจารย์/บุคลากร</option>
            <option value="GUEST">สมาชิกทั่วไป</option>
          </select>
        </div>

        {!isAdmin && (
          <p className="mt-2 text-xs text-muted-foreground">
            คุณดูได้แต่แก้ไม่ได้ — การเปลี่ยนสิทธิ์และโควตาสงวนให้ผู้ดูแลระดับองค์กร
          </p>
        )}

        {notice && (
          <p className="mt-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
            {notice}
          </p>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {loading && (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            กำลังโหลด…
          </p>
        )}

        {error && (
          <p className="px-4 py-8 text-sm text-destructive">{error}</p>
        )}

        {!loading && !error && members.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            ไม่พบสมาชิกที่ตรงกับเงื่อนไข
          </p>
        )}

        <ul className="divide-y divide-border">
          {members.map((member) => {
            const profile = names.get(member.coreUserId);
            const usedPercent =
              Number(member.storageQuotaBytes) > 0
                ? (Number(member.storageUsedBytes) /
                    Number(member.storageQuotaBytes)) *
                  100
                : 0;

            return (
              <li
                key={member.coreUserId}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <UserAvatar
                  coreUserId={member.coreUserId}
                  displayName={profile?.displayName}
                  avatarUrl={profile?.avatarUrl}
                  badge={badgeFor(member.layer2Role)}
                  size={44}
                />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {profile?.displayName ?? member.coreUserId}
                    <VerifiedBadge badge={badgeFor(member.layer2Role)} />
                    {online.has(member.coreUserId) && (
                      <span className="text-[11px] font-normal text-success">
                        ออนไลน์
                      </span>
                    )}
                  </p>

                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {member.coreUserId}
                  </p>

                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <HardDrive className="size-3 shrink-0" />
                    {formatBytes(member.storageUsedBytes)} /{' '}
                    {formatBytes(member.storageQuotaBytes)}
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-border">
                      <span
                        className={`block h-full rounded-full ${
                          usedPercent > 90 ? 'bg-destructive' : 'bg-primary'
                        }`}
                        style={{ width: `${Math.min(100, usedPercent)}%` }}
                      />
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {isAdmin ? (
                    <select
                      value={member.layer2Role}
                      onChange={(event) =>
                        void changeRole(member, event.target.value as Layer2Role)
                      }
                      // ไม่มีชื่อ = โปรแกรมอ่านหน้าจออ่านว่า "กล่องตัวเลือก"
                      // เฉย ๆ ในหน้าที่มีสมาชิกหลายสิบคน ผู้ใช้จึงไม่รู้ว่า
                      // กำลังเปลี่ยนสิทธิ์ของใครอยู่
                      aria-label={`สิทธิ์ของ ${member.coreUserId}`}
                      className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                    >
                      <option value="GUEST">สมาชิกทั่วไป</option>
                      <option value="EDITOR">อาจารย์/บุคลากร</option>
                      <option value="ADMIN">ผู้ดูแล</option>
                    </select>
                  ) : (
                    <span className="rounded-lg bg-muted px-2 py-1 text-xs">
                      {ROLE_LABEL[member.layer2Role]}
                    </span>
                  )}

                  <span
                    className="flex items-center gap-1 text-[10px] text-muted-foreground"
                    title={
                      member.layer2RoleExplicit
                        ? 'ผู้ดูแลตั้งค่านี้ด้วยมือ — ระบบจะไม่เขียนทับ'
                        : 'ค่านี้แปลงมาจากสิทธิ์ระดับองค์กรอัตโนมัติ และจะปรับตามถ้า Core เปลี่ยน'
                    }
                  >
                    {member.layer2RoleExplicit ? (
                      <>
                        <UserCog className="size-3" />
                        ตั้งเอง
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-3" />
                        ตามสิทธิ์องค์กร
                      </>
                    )}
                  </span>

                  {isAdmin && (
                    <span className="flex gap-1">
                      {[200, 1024, 5120].map((mb) => (
                        <button
                          key={mb}
                          type="button"
                          onClick={() => void changeQuota(member, mb)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent"
                        >
                          {mb >= 1024 ? `${mb / 1024}G` : `${mb}M`}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
