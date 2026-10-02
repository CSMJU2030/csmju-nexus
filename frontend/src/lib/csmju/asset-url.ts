'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/csmju/api';

/// ลิงก์อ่านไฟล์แนบแบบมีอายุ
///
/// หลังบ้านไม่มี URL ถาวรให้ไฟล์แนบโดยตั้งใจ — ต้องขอลิงก์ที่เซ็นไว้ทีละครั้ง
/// และลิงก์นั้นอายุสองนาที เพื่อไม่ให้ลิงก์ที่หลุดออกไปใช้ได้ตลอดกาล
///
/// ปัญหาที่ตามมา: ข้อความหนึ่งห้องมีไฟล์แนบได้หลายสิบไฟล์ ถ้าแต่ละรูปขอลิงก์
/// ของตัวเองทุกครั้งที่ React วาดใหม่ จะยิงคำขอเป็นร้อยครั้งต่อการเลื่อนหน้าจอ
/// หนึ่งครั้ง — จึงแคชไว้ระดับโมดูล และแชร์คำขอที่กำลังบินอยู่

interface CachedUrl {
  url: string;
  /// เวลาที่ถือว่าหมดอายุแล้ว (ก่อนของจริงเล็กน้อย)
  staleAt: number;
}

const cache = new Map<string, CachedUrl>();
const inflight = new Map<string, Promise<string>>();

/// เผื่อเวลาไว้ก่อนหมดอายุจริง
///
/// ถ้ารอจนหมดอายุพอดี ลิงก์ที่เพิ่งหยิบจากแคชอาจตายระหว่างที่รูปกำลังโหลด
const SAFETY_MS = 15_000;

export function assetUrlCacheForTests() {
  return { cache, inflight };
}

async function fetchUrl(assetId: string): Promise<string> {
  const result = await api.get<{
    downloadUrl: string;
    expiresAt: string;
    asAttachment: boolean;
  }>(`/assets/${assetId}/download-url`);

  const expiresAt = Date.parse(result.expiresAt);

  cache.set(assetId, {
    url: result.downloadUrl,
    staleAt:
      (Number.isFinite(expiresAt) ? expiresAt : Date.now() + 120_000) -
      SAFETY_MS,
  });

  return result.downloadUrl;
}

/// ขอลิงก์ โดยใช้ของในแคชถ้ายังไม่หมดอายุ
export function assetUrl(assetId: string): Promise<string> {
  const cached = cache.get(assetId);

  if (cached && cached.staleAt > Date.now()) {
    return Promise.resolve(cached.url);
  }

  const pending = inflight.get(assetId);

  if (pending) return pending;

  const request = fetchUrl(assetId).finally(() => inflight.delete(assetId));

  inflight.set(assetId, request);

  return request;
}

/// ลิงก์อ่านไฟล์สำหรับใช้ใน <img> / <video>
///
/// คืน null ระหว่างที่ยังขอไม่เสร็จ และคืน error ถ้าขอไม่ได้ (เช่นถูกลบไปแล้ว
/// หรือเราไม่ได้อยู่ในห้องนั้นแล้ว) — ต้องบอกผู้ใช้ ไม่ใช่ปล่อยกรอบว่าง
export function useAssetUrl(assetId: string | null) {
  /// เก็บคู่ (ไฟล์ไหน, ลิงก์ของไฟล์นั้น) ไม่ใช่ลิงก์เปล่า ๆ
  ///
  /// ถ้าเก็บแค่ลิงก์ พอ `assetId` เปลี่ยน คอมโพเนนต์จะเอาลิงก์ของไฟล์เก่า
  /// ไปแสดงหนึ่งเฟรมก่อนที่ของใหม่จะมา — คือเห็นรูปคนอื่นแวบหนึ่ง
  ///
  /// เก็บเป็นคู่แล้วค่อยกรองตอน render ยังทำให้ไม่ต้อง setState ในตัว effect
  /// ซึ่ง React Compiler ห้ามไว้ (react-hooks/set-state-in-effect)
  const [resolved, setResolved] = useState<{
    assetId: string;
    url: string;
  } | null>(null);
  const [failure, setFailure] = useState<{
    assetId: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!assetId) return;

    let cancelled = false;

    assetUrl(assetId)
      .then((url) => {
        if (!cancelled) setResolved({ assetId, url });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;

        setFailure({
          assetId,
          message:
            caught instanceof Error ? caught.message : 'เปิดไฟล์ไม่ได้',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (!assetId) return { url: null, error: null };

  return {
    url:
      resolved?.assetId === assetId
        ? resolved.url
        : (cache.get(assetId)?.url ?? null),
    error: failure?.assetId === assetId ? failure.message : null,
  };
}
