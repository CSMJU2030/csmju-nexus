'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserAvatar, VerifiedBadge } from '@/components/csmju/user-badge';
import { api } from '@/lib/csmju/api';
import type { ProfileSummary } from '@/lib/csmju/types';

/// แคชชื่อที่แสดงในหน่วยความจำของแท็บ + รวบคำขอเป็นชุด
///
/// ปัญหาที่แก้: ฟีดหนึ่งหน้ามี 20 รายการจาก 5 คน ถ้าแต่ละ <UserName> ยิง
/// คำขอของตัวเอง จะได้ 20 คำขอที่ถามเรื่องเดิมซ้ำ ๆ
///
/// วิธีแก้: ทุกตัวที่ mount ในเฟรมเดียวกันจะถูกรวบเป็นคำขอเดียว
/// (`GET /profiles?coreUserIds=a,b,c`) ด้วยการหน่วง 20 มิลลิวินาที ซึ่งสั้นพอ
/// ที่ผู้ใช้ไม่รู้สึก แต่นานพอให้ทุกตัวใน render รอบเดียวกันมารวมกันทัน
const cache = new Map<string, ProfileSummary>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (timer) return;

  timer = setTimeout(() => {
    timer = null;

    const batch = [...waiting].slice(0, 100);

    if (batch.length === 0) return;

    for (const name of batch) {
      waiting.delete(name);
    }

    void api
      .get<ProfileSummary[]>(
        `/profiles?coreUserIds=${batch.map(encodeURIComponent).join(',')}`,
      )
      .then((rows) => {
        for (const row of rows) {
          cache.set(row.coreUserId, row);
        }

        for (const notify of listeners) {
          notify();
        }
      })
      .catch(() => {
        // ถ้าดึงไม่ได้ ปล่อยให้แสดง coreUserId ไปก่อน — ดีกว่าช่องว่าง
        for (const name of batch) {
          cache.set(name, {
            coreUserId: name,
            displayName: name,
            avatarUrl: null,
            syncedAt: null,
            badge: null,
          });
        }

        for (const notify of listeners) {
          notify();
        }
      });
  }, 20);
}

export function useProfile(coreUserId: string): ProfileSummary {
  const [, force] = useState(0);

  useEffect(() => {
    // รหัสว่าง = ไม่มีเจ้าของ (เช่นแจ้งเตือนจากระบบ) — ไม่ต้องถามหลังบ้าน
    if (!coreUserId || cache.has(coreUserId)) return;

    waiting.add(coreUserId);
    scheduleFlush();

    const notify = () => force((n) => n + 1);

    listeners.add(notify);

    return () => {
      listeners.delete(notify);
    };
  }, [coreUserId]);

  return (
    cache.get(coreUserId) ?? {
      coreUserId,
      displayName: coreUserId,
      avatarUrl: null,
      syncedAt: null,
      badge: null,
    }
  );
}

/// ชื่อผู้ใช้ที่กดไปหน้าโปรไฟล์ได้
export function UserName({
  coreUserId,
  className = '',
}: {
  coreUserId: string;
  className?: string;
}) {
  const profile = useProfile(coreUserId);

  return (
    <Link
      href={`/profile/${encodeURIComponent(coreUserId)}`}
      className={`inline-flex items-center gap-1 font-medium hover:underline ${className}`}
      title={coreUserId}
    >
      {profile.displayName}
      <VerifiedBadge badge={profile.badge} className="size-3.5" />
    </Link>
  );
}

/// รูปโปรไฟล์ที่ดึงชื่อและ badge มาให้เอง
///
/// ห่อ UserAvatar เพื่อให้ที่เรียกไม่ต้องส่ง displayName/badge เอง —
/// hook แคชด้านบนรู้อยู่แล้วจากการแปลงชื่อเป็นชุด
export function Avatar({
  coreUserId,
  size = 36,
  showOnline = true,
}: {
  coreUserId: string;
  size?: number;
  showOnline?: boolean;
}) {
  const profile = useProfile(coreUserId);

  return (
    <UserAvatar
      coreUserId={coreUserId}
      displayName={profile.displayName}
      avatarUrl={profile.avatarUrl}
      badge={profile.badge}
      size={size}
      showOnline={showOnline}
    />
  );
}
