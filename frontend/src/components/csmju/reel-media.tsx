'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/csmju/api';
import { assetUrl } from '@/lib/csmju/asset-url';

/// ของที่หน้าคลิปสั้นกับหน้าสำรวจใช้ร่วมกัน — ลิงก์วิดีโอ และตัวบอกว่าอยู่ใกล้จอไหม

/// ลิงก์วิดีโอแบบมีอายุ ขอเฉพาะตอน `enabled` และขอใหม่ได้เมื่อเล่นไม่ขึ้น
///
/// ใช้ `assetUrl()` (แคชระดับโมดูลของ asset-url.ts) เป็นทางหลัก เพื่อให้กริด
/// สำรวจกับหน้าดูคลิปแชร์ลิงก์เดียวกัน — กดจากกริดเข้าไปดูจึงไม่ต้องขอซ้ำ
///
/// แต่แคชนั้นเชื่อ `expiresAt` ของหลังบ้าน ถ้า `<video>` ฟ้อง error แปลว่าลิงก์
/// ตายก่อนกำหนด (นาฬิกาเครื่องเพี้ยน หรือ storage หมุน key) — `refresh()` จึง
/// ข้ามแคชไปถามหลังบ้านตรง ๆ ไม่งั้นจะได้ลิงก์ตายตัวเดิมกลับมาวนไม่รู้จบ
///
/// staleTime 90 วินาที ต่ำกว่าอายุจริง (120) แต่ **ไม่ refetch เองตอนสลับแท็บ**
/// เพราะลิงก์ใหม่ = src ใหม่ = วิดีโอที่กำลังเล่นกระตุกกลับไปเริ่มต้น
export function useSignedVideoUrl(assetId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = ['reel-video-url', assetId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => assetUrl(assetId),
    enabled,
    staleTime: 90_000,
    gcTime: 110_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  /// คืนลิงก์ใหม่ หรือ null ถ้าขอไม่ได้ — ผู้เรียกใช้เทียบกับลิงก์เดิม:
  /// ได้ลิงก์เดิมกลับมา (หลังบ้านเซ็นซ้ำได้ค่าเดิม) src ไม่เปลี่ยน วิดีโอจะไม่
  /// ลองโหลดใหม่และไม่ยิง error อีก — ต้องสรุปเองว่าไฟล์เปิดไม่ได้
  async function refresh(): Promise<string | null> {
    try {
      const fresh = await api.get<{ downloadUrl: string }>(
        `/assets/${assetId}/download-url`,
      );

      queryClient.setQueryData(queryKey, fresh.downloadUrl);

      return fresh.downloadUrl;
    } catch {
      // ขอใหม่ก็ไม่ได้ (ถูกลบ/ไม่มีสิทธิ์แล้ว) — ปล่อยให้ผู้เรียกแสดงข้อความ
      queryClient.setQueryData(queryKey, null);

      return null;
    }
  }

  return {
    url: query.data ?? null,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : 'เปิดคลิปไม่ได้'
      : null,
    refresh,
  };
}

/// บอกว่า element อยู่ใกล้จอแล้วหรือยัง — ใช้ขอลิงก์เฉพาะช่องที่กำลังจะเห็น
///
/// กริดสำรวจมีหลายสิบช่อง ถ้าทุกช่องขอลิงก์ตอนโหลดหน้า ช่องท้าย ๆ จะหมดอายุ
/// ก่อนผู้ใช้เลื่อนไปถึง และยิงคำขอฟรี ๆ อีกหลายสิบครั้ง
///
/// "เคยใกล้แล้ว" ติดค้างเป็น true — เลื่อนผ่านไปแล้วไม่ต้องถอดวิดีโอทิ้ง
/// (ถอดแล้วเลื่อนกลับมาจะเห็นช่องดำกระพริบก่อนภาพขึ้นใหม่)
export function useNearViewport(
  ref: RefObject<Element | null>,
  rootMargin = '300px',
): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element || near) return;

    // เบราว์เซอร์เก่า/สภาพแวดล้อมทดสอบที่ไม่มี IntersectionObserver
    // — โหลดเลยดีกว่าไม่แสดงอะไร
    if (typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(() => setNear(true), 0);

      return () => clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root: scrollParent(element), rootMargin },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, rootMargin, near]);

  return near;
}

/// กล่องเลื่อนที่ใกล้ที่สุด — ใช้เป็น root ของ IntersectionObserver
///
/// เนื้อหาทั้งแอปเลื่อนอยู่ใน `<main overflow-y-auto>` ไม่ใช่ทั้งหน้าต่าง ถ้าใช้
/// root เป็นหน้าต่าง (ค่าเริ่มต้น) ช่องที่อยู่นอกขอบ main ถูกตัดทิ้งก่อนเทียบ
/// rootMargin จึงไม่มีผล — ลิงก์จะถูกขอตอนช่องโผล่เข้าจอพอดี ไม่ใช่ล่วงหน้า
export function scrollParent(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);

    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }

  return null;
}

/// ตัวเลขแบบย่อของ Instagram ภาษาไทย — 1,234 → "1.2 พัน" · 11,000 → "1.1 หมื่น"
///
/// ปัดลงไม่ปัดขึ้น (9,999 = "9.9 พัน" ไม่ใช่ "10 พัน") แบบ IG — ตัวเลขที่ย่อแล้ว
/// ต้องไม่เกินของจริง · ".0" ตัดทิ้ง ("2 พัน" ไม่ใช่ "2.0 พัน")
const THAI_UNITS: Array<[number, string]> = [
  [1_000_000, 'ล้าน'],
  [100_000, 'แสน'],
  [10_000, 'หมื่น'],
  [1_000, 'พัน'],
];

export function compactCount(value: number): string {
  for (const [size, unit] of THAI_UNITS) {
    if (value >= size) {
      const scaled = Math.floor((value / size) * 10) / 10;

      return `${scaled.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ${unit}`;
    }
  }

  return String(value);
}
