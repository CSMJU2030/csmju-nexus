'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { api } from '@/lib/csmju/api';
import {
  bindSocket,
  connectSocket,
  onSocketReconnect,
} from '@/lib/csmju/socket';
import { cn } from '@/lib/utils';

/// สถานะออนไลน์ที่แชร์กันทั้งแอป
///
/// เก็บใน module scope ไม่ใช่ใน context เพราะทุก avatar ในหน้าต้องอ่านค่านี้
/// ถ้าใช้ context แล้ว state เปลี่ยน ทุก consumer จะ re-render พร้อมกัน —
/// ในหน้าที่มีร้อย avatar (รายการสมาชิก) นั่นคือการวาดใหม่ทั้งหน้าทุกครั้ง
/// ที่มีคนเปิด-ปิดแท็บ
const onlineUsers = new Set<string>();

/// ผู้ฟังแยกตาม coreUserId + ผู้ฟังที่สนใจทั้งชุด
///
/// เดิมมีชุดเดียวแล้วเรียกทุกตัวเมื่อมีใครเปิด-ปิดแท็บ — หน้าที่มี 100 avatar
/// จะ re-render ทั้ง 100 ตัวทุกครั้งที่ใครสักคนออนไลน์ ทั้งที่มีตัวเดียว
/// ที่ค่าเปลี่ยนจริง
const perUser = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();

let started = false;

function notify(coreUserId?: string) {
  if (coreUserId) {
    for (const listener of perUser.get(coreUserId) ?? []) {
      listener();
    }
  } else {
    // โหลดครั้งแรกจาก REST — ค่าเปลี่ยนพร้อมกันหลายคน จึงแจ้งทุกคน
    for (const listeners of perUser.values()) {
      for (const listener of listeners) {
        listener();
      }
    }
  }

  for (const listener of globalListeners) {
    listener();
  }
}

/// เริ่มติดตามสถานะออนไลน์ครั้งเดียวต่อแท็บ
///
/// ต้องมีทั้งสองทาง: REST ให้ภาพตั้งต้น (คนที่ออนไลน์อยู่ก่อนเราเปิดหน้า)
/// และ event ทำให้มันสดต่อ — ถ้ามีแค่ event จะไม่เห็นใครเลยจนกว่าจะมีคน
/// เปิดหรือปิดแท็บ
/// event ที่เข้ามาระหว่างที่ยังรอผลของ /presence อยู่
///
/// จำเป็นเพราะ snapshot จาก REST ถูก "ถ่าย" ไว้ตั้งแต่ตอนเริ่มยิงคำขอ แต่มา
/// ถึงทีหลัง ถ้าเอามาทับดื้อ ๆ event ที่เกิดระหว่างนั้น (ซึ่งใหม่กว่า) จะหายไป
/// อาการคือคนที่เพิ่งออนไลน์ตอนเราต่อกลับ จุดเขียวติดแวบเดียวแล้วดับ
let pendingEdits: Map<string, boolean> | null = null;

async function refreshPresence(): Promise<void> {
  const edits = new Map<string, boolean>();

  pendingEdits = edits;

  try {
    const data = await api.get<{
      onlineCoreUserIds: string[];
      totalOnline: number;
    }>('/presence');

    // มีการดึงรอบใหม่กว่าเริ่มไปแล้ว = ผลของรอบนี้เก่าแล้ว ทิ้งไป
    if (pendingEdits !== edits) return;

    // ล้างก่อนเติม — ตอนดึงซ้ำหลังต่อกลับ คนที่ออฟไลน์ไประหว่างที่เราหลุด
    // จะยังค้างเป็นจุดเขียวอยู่ถ้าเติมทับอย่างเดียว
    onlineUsers.clear();

    for (const coreUserId of data.onlineCoreUserIds) {
      onlineUsers.add(coreUserId);
    }

    // แล้วค่อยทับด้วย event ที่เข้ามาระหว่างรอ เพราะมันใหม่กว่า snapshot
    for (const [coreUserId, online] of edits) {
      if (online) {
        onlineUsers.add(coreUserId);
      } else {
        onlineUsers.delete(coreUserId);
      }
    }

    notify();
  } catch {
    // ดึงไม่ได้ = จุดออนไลน์ไม่อัปเดต แต่ทั้งหน้าต้องไม่พัง
  } finally {
    if (pendingEdits === edits) {
      pendingEdits = null;
    }
  }
}

function startPresence() {
  if (started) return;

  started = true;

  void refreshPresence();

  void connectSocket()
    .then((socket) => {
      // ต้องผ่าน bindSocket ไม่ใช่ socket.on ดิบ
      //
      // การต่อใหม่สร้าง Socket ตัวใหม่ ผู้ฟังที่ผูกกับตัวเก่าจึงตายไปด้วย
      // และ `started` ที่ล็อกไว้ตลอดกาลทำให้ไม่มีใครมาผูกใหม่ —
      // จุดออนไลน์ทั้งหน้าจะค้างแช่อยู่อย่างนั้นจนกว่าผู้ใช้จะรีเฟรชเอง
      bindSocket<{ coreUserId: string; online: boolean }>(
        socket,
        'presence:changed',
        (payload) => {
          if (payload.online) {
            onlineUsers.add(payload.coreUserId);
          } else {
            onlineUsers.delete(payload.coreUserId);
          }

          // จดไว้ด้วยถ้ากำลังรอ snapshot อยู่ — ไม่งั้นมันจะถูกทับหาย
          pendingEdits?.set(payload.coreUserId, payload.online);

          // แจ้งเฉพาะ avatar ของคนที่สถานะเปลี่ยน
          notify(payload.coreUserId);
        },
      );

      // ระหว่างที่หลุด เราพลาด event ไปหมด ภาพที่ถืออยู่จึงเก่าแล้ว
      onSocketReconnect(() => void refreshPresence());
    })
    .catch(() => undefined);
}

export function useOnline(coreUserId: string): boolean {
  const [, force] = useState(0);

  useEffect(() => {
    startPresence();

    const listener = () => force((value) => value + 1);
    const set = perUser.get(coreUserId) ?? new Set<() => void>();

    set.add(listener);
    perUser.set(coreUserId, set);

    return () => {
      set.delete(listener);

      if (set.size === 0) {
        perUser.delete(coreUserId);
      }
    };
  }, [coreUserId]);

  return onlineUsers.has(coreUserId);
}

/// สำหรับหน้าจอที่ต้องรู้ทั้งชุด (เช่นรายชื่อสมาชิก) — วาดใหม่เมื่อมีใครเปลี่ยน
export function useOnlineSet(): Set<string> {
  const [, force] = useState(0);

  useEffect(() => {
    startPresence();

    const listener = () => force((value) => value + 1);

    globalListeners.add(listener);

    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  return onlineUsers;
}

export type Badge = 'ADMIN' | 'STAFF' | null;

/// เครื่องหมายยืนยันข้างชื่อ
///
/// **มาจาก layer2Role ของระบบย่อย ไม่ใช่ coreRole** เพราะ Blueprint
/// หน้า 10 ห้ามเราเก็บ coreRole — เรารู้ role ของผู้เรียกเองจาก header
/// แต่ไม่มีทางรู้ของคนอื่น ส่วน layer2Role เป็น Local Data ที่เรานิยามเองได้
/// (หน้า 11) และตรงกับความหมายที่เครื่องหมายถูกควรสื่อในชุมชนนี้อยู่แล้ว
///
/// สองระดับ: โล่ = ผู้ดูแลระบบย่อย · เครื่องหมายถูก = อาจารย์/บุคลากร
export function VerifiedBadge({
  badge,
  className,
}: {
  badge: Badge;
  className?: string;
}) {
  if (!badge) {
    return null;
  }

  // ห่อด้วย <span title> เพราะไอคอนของ lucide ไม่รับ prop `title`
  // (มันส่ง prop ที่ไม่รู้จักต่อไปที่ <svg> ซึ่ง TypeScript ปฏิเสธ)
  if (badge === 'ADMIN') {
    return (
      <span
        title="ผู้ดูแลระบบย่อยนี้"
        className="inline-flex shrink-0 items-center"
      >
        <ShieldCheck
          className={cn('size-4 text-primary', className)}
          aria-label="ผู้ดูแลระบบ"
        />
      </span>
    );
  }

  return (
    <span
      title="อาจารย์หรือบุคลากรของสาขา"
      className="inline-flex shrink-0 items-center"
    >
      <BadgeCheck
        className={cn('size-4 text-primary', className)}
        aria-label="อาจารย์หรือบุคลากร"
      />
    </span>
  );
}

/// รูปโปรไฟล์ + จุดออนไลน์ + เครื่องหมายยืนยัน
///
/// รวมสามอย่างไว้ใน component เดียวเพราะทั้งสามผูกกับคนคนเดียวกัน
/// ถ้าแยกกัน ทุกที่ที่แสดงรูปคนจะต้องประกอบเองสามชิ้น แล้วบางที่จะลืมชิ้นใดชิ้นหนึ่ง
export function UserAvatar({
  coreUserId,
  displayName,
  avatarUrl,
  badge = null,
  size = 40,
  showOnline = true,
  className,
}: {
  coreUserId: string;
  displayName?: string;
  avatarUrl?: string | null;
  badge?: Badge;
  size?: number;
  showOnline?: boolean;
  className?: string;
}) {
  const online = useOnline(coreUserId);
  const name = displayName ?? coreUserId;

  return (
    <span className={cn('relative inline-block shrink-0', className)}>
      <Avatar style={{ width: size, height: size }}>
        <AvatarImage src={avatarUrl ?? undefined} alt="" />
        <AvatarFallback style={{ fontSize: size * 0.36 }}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </AvatarFallback>
      </Avatar>

      {showOnline && online && (
        <span
          className="absolute bottom-0 end-0 rounded-full border-2 border-background bg-success"
          style={{
            width: Math.max(8, size * 0.28),
            height: Math.max(8, size * 0.28),
          }}
        >
          <span className="sr-only">ออนไลน์</span>
        </span>
      )}

      {badge && (
        <span className="absolute -right-0.5 -top-0.5 grid place-items-center rounded-full bg-background">
          <VerifiedBadge
            badge={badge}
            className={size < 32 ? 'size-3' : 'size-3.5'}
          />
        </span>
      )}
    </span>
  );
}
