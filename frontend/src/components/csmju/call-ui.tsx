'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useProfile } from '@/components/csmju/user-name';
import { cn } from '@/lib/utils';

/// ชิ้นส่วนที่หน้าจอการโทรทุกหน้าใช้ร่วมกัน (ห้องรอ · กำลังโทร · ในสาย · จบสาย)
///
/// หน้าจอโทรเป็นพื้นมืดเสมอไม่ว่าธีมของแอปจะเป็นอะไร เหมือน Instagram —
/// ภาพวิดีโอดูดีบนพื้นดำ และปุ่มกลมสีขาวโปร่งอ่านได้บนทุกภาพ

/// ชื่อที่แสดงของผู้ใช้หนึ่งคน (ข้อความล้วน ไม่ใช่ลิงก์ — กดแล้วหลุดออกจากสาย)
export function DisplayName({ coreUserId }: { coreUserId: string }) {
  return <>{useProfile(coreUserId).displayName}</>;
}

/// "ก้อง" · "ก้อง, + คนอื่นๆ อีก 2 คน"
export function CallTitle({ members }: { members: readonly string[] }) {
  const [first, ...rest] = members;

  if (!first) return null;

  return (
    <>
      <DisplayName coreUserId={first} />
      {rest.length > 0 && `, + คนอื่นๆ อีก ${rest.length} คน`}
    </>
  );
}

/// ชื่อทุกคนคั่นด้วยจุลภาค — ใช้ในห้องรอของสายกลุ่ม
export function MemberNames({ members }: { members: readonly string[] }) {
  return (
    <>
      {members.map((coreUserId, index) => (
        <span key={coreUserId}>
          {index > 0 && ', '}
          <DisplayName coreUserId={coreUserId} />
        </span>
      ))}
    </>
  );
}

/// รูปโปรไฟล์ในหน้าจอโทร
///
/// ไม่ใช้ `<Avatar>` ของแอปเพราะตัวนั้นเปิดการติดตามสถานะออนไลน์ด้วย —
/// จุดเขียวบนหน้าคนที่กำลังคุยอยู่ไม่มีความหมาย และไม่ควรเปิด socket
/// เพิ่มอีกเส้นทุกครั้งที่หน้าจอโทรวาดใหม่
export function CallAvatar({
  coreUserId,
  size,
  className,
}: {
  coreUserId: string;
  size: number;
  className?: string;
}) {
  const profile = useProfile(coreUserId);

  return (
    <Avatar className={className} style={{ width: size, height: size }}>
      <AvatarImage src={profile.avatarUrl ?? undefined} alt="" />
      <AvatarFallback
        className="bg-white/15 font-semibold text-white"
        style={{ fontSize: size * 0.38 }}
      >
        {profile.displayName.trim().charAt(0).toUpperCase() || '?'}
      </AvatarFallback>
    </Avatar>
  );
}

/// พื้นหลังเบลอเป็นวงจากรูปโปรไฟล์ — ใช้ตอนไม่มีภาพวิดีโอ
export function CallBackdrop({ coreUserId }: { coreUserId: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[3] opacity-50 blur-3xl">
        <CallAvatar coreUserId={coreUserId} size={240} />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,black_75%)]" />
    </div>
  );
}

/// `<video>` ที่ผูกกับ MediaStream
///
/// ปิดเสียงเสมอ — เสียงของทุกคนเล่นผ่าน `<audio>` แยก (เลือกลำโพงได้)
/// ถ้าปล่อย `<video>` มีเสียงด้วย เสียงของอีกฝ่ายจะดังสองรอบซ้อนกัน
export function VideoView({
  stream,
  mirrored = false,
  fit = 'cover',
  className,
  label,
}: {
  stream: MediaStream | null;
  mirrored?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      aria-label={label}
      className={cn(
        'size-full bg-black',
        fit === 'cover' ? 'object-cover' : 'object-contain',
        mirrored && '-scale-x-100',
        className,
      )}
    />
  );
}

/// เสียงของอีกฝ่ายหนึ่งคน — ซ่อนตัวเล่น และส่งออกลำโพงที่เลือกไว้
export function RemoteAudio({
  stream,
  sinkId,
  muted,
  coreUserId,
}: {
  stream: MediaStream | null;
  sinkId: string | null;
  muted: boolean;
  coreUserId: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const element = ref.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;

    if (!element?.setSinkId || !sinkId) return;

    // อุปกรณ์ถูกถอดระหว่างทาง = ปล่อยให้ดังที่ค่าเริ่มต้นต่อไป ดีกว่าเงียบ
    void element.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);

  return (
    <audio ref={ref} autoPlay playsInline className="hidden">
      <track kind="captions" label={`เสียงของ ${coreUserId}`} />
    </audio>
  );
}

/// ปุ่มกลมบนหน้าจอโทร
///
/// `tone`:
///   plain  = ปกติ (ขาวโปร่ง)
///   on     = สลับอยู่ (พื้นขาว ไอคอนดำ) เช่น ปิดไมค์อยู่ · กำลังแชร์จอ
///   danger = วางสาย
export function RoundButton({
  label,
  onClick,
  tone = 'plain',
  pressed,
  disabled,
  size = 'md',
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'plain' | 'on' | 'danger';
  pressed?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-40',
        size === 'md' ? 'size-12' : 'size-10',
        tone === 'plain' && 'bg-white/15 text-white hover:bg-white/25',
        tone === 'on' && 'bg-white text-black hover:bg-white/90',
        tone === 'danger' && 'bg-destructive text-white hover:bg-destructive/90',
      )}
    >
      {children}
    </button>
  );
}
