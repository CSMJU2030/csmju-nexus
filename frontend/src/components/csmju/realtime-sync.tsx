'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bindSocket, connectSocket, onSocketReconnect } from '@/lib/csmju/socket';
import { isSyncTopic, keyMatches, type SyncTopic } from '@/lib/csmju/realtime-sync';

/// ตัวรับ `sync:changed` ของทั้งแอป (อยู่ที่ layout) — ทุกหน้าเห็นของใหม่ทันทีโดยไม่ต้องรีเฟรช
///
///   - รวบสัญญาณที่มาติด ๆ กันในเสี้ยววินาทีเป็นการดึงรอบเดียว (กดไลก์รัว ๆ ไม่ทำให้ยิงซ้ำ)
///   - ต่อกลับหลังเน็ตหลุด/เครื่องหลับ → ดึงทุกอย่างที่เปิดอยู่ใหม่ (สัญญาณระหว่างหลุดหายไปแล้ว)
const COALESCE_MS = 300;

export function RealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | null = null;
    const pending = new Set<SyncTopic>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;

      const topics = new Set(pending);

      pending.clear();
      void queryClient.invalidateQueries({ predicate: (query) => keyMatches(query.queryKey, topics) });
    };

    void connectSocket()
      .then((socket) => {
        if (cancelled) return;

        unbind = bindSocket<{ topic?: unknown }>(socket, 'sync:changed', (payload) => {
          if (!isSyncTopic(payload?.topic)) return;
          pending.add(payload.topic);
          timer ??= setTimeout(flush, COALESCE_MS);
        });
      })
      // ต่อไม่ได้ตอนนี้ — socket.ts นัดต่อใหม่เอง แล้ว onSocketReconnect ข้างล่างจะดึงของที่พลาดให้
      .catch(() => undefined);

    const offReconnect = onSocketReconnect(() => void queryClient.invalidateQueries());

    return () => {
      cancelled = true;
      unbind?.();
      offReconnect();
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  return null;
}
