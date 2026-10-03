'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { ProfileDetail, Relation } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// ปุ่ม "ติดตาม" ข้างชื่อเจ้าของคลิป และในแถวผลค้นหาคน
///
/// **ซ่อนเมื่อเป็นตัวเองหรือติดตามอยู่แล้ว** — ตาม Instagram ที่แสดงปุ่มนี้
/// เฉพาะตอนที่กดแล้วมีผล สถานะจริงมาจาก `GET /profiles/:id` (`relation`)
/// ไม่เดาจากฟีด เพราะฟีด "ทั้งหมด" มีทั้งคนที่ติดตามและไม่ได้ติดตามปนกัน
///
/// `enabled` ให้ผู้เรียกคุมว่าจะถามหลังบ้านเมื่อไร — หน้าคลิปมีได้ 20 คลิป
/// ถามเฉพาะคลิปที่อยู่ใกล้จอพอ ไม่ต้องยิง 20 คำขอตอนโหลดหน้า
export function FollowButton({
  coreUserId,
  enabled = true,
  variant = 'solid',
  className,
}: {
  coreUserId: string;
  enabled?: boolean;
  /// solid = ปุ่มฟ้าในรายการคน · overlay = ปุ่มขอบขาวบนวิดีโอ
  variant?: 'solid' | 'overlay';
  className?: string;
}) {
  const me = useMe();
  const isSelf = me.id === coreUserId;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: relation } = useQuery({
    queryKey: ['relation', coreUserId],
    queryFn: async () =>
      (await api.get<ProfileDetail>(`/profiles/${encodeURIComponent(coreUserId)}`))
        .relation,
    enabled: enabled && !isSelf,
    staleTime: 60_000,
  });

  // ยังไม่รู้สถานะ = ยังไม่แสดง ดีกว่าโชว์ "ติดตาม" ให้คนที่ติดตามอยู่แล้วแวบหนึ่ง
  if (isSelf || !relation || relation.following) return null;

  async function follow() {
    setBusy(true);

    try {
      const next = await api.post<Relation>('/follows', { coreUserId });

      queryClient.setQueryData(['relation', coreUserId], next);
      // หน้าโปรไฟล์และฟีด "คนที่ติดตาม" ต้องเห็นผลทันที
      void queryClient.invalidateQueries({ queryKey: ['profile', coreUserId] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['following', 'mine'] });
    } catch {
      // ปุ่มยังอยู่ให้กดซ้ำได้ — การติดตามพลาดไม่ใช่เรื่องที่ต้องเด้งกล่องเตือน
    } finally {
      setBusy(false);
    }
  }

  // บนวิดีโอ = ลิงก์ตัวหนา "• ติดตาม" ต่อท้ายชื่อแบบ Reels · ในรายการ = ปุ่มฟ้า
  if (variant === 'overlay') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-label="ติดตาม"
        onClick={(event) => {
          // ปุ่มอยู่บนวิดีโอ — คลิกต้องไม่ทะลุไปสั่งหยุด/เล่น
          event.stopPropagation();
          void follow();
        }}
        className={cn(
          'shrink-0 text-csmju-label font-semibold text-white transition-opacity hover:opacity-70 disabled:opacity-50',
          className,
        )}
      >
        <span aria-hidden className="mr-1.5">•</span>
        ติดตาม
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(event) => {
        // ปุ่มอยู่บนวิดีโอ — คลิกต้องไม่ทะลุไปสั่งหยุด/เล่น
        event.stopPropagation();
        void follow();
      }}
      className={cn(
        'shrink-0 rounded-lg text-csmju-label font-semibold transition-opacity disabled:opacity-50',
        'bg-primary px-4 py-1.5 text-primary-foreground hover:opacity-90',
        className,
      )}
    >
      ติดตาม
    </button>
  );
}
