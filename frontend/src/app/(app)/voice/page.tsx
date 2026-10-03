'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/// หน้าห้องเสียงเดิม — ย้ายไปอยู่ในหน้าห้อง (/chat) แบบ Discord แล้ว
///
/// ของเดิมถือสาย WebRTC ไว้ใน state ของหน้านี้ เปลี่ยนหน้าเมื่อไหร่เสียงหลุดทันที
/// ตอนนี้สายอยู่ใน VoiceRoomProvider ที่ layout และเวทีอยู่ในช่องเสียงของ /chat
/// ลิงก์เก่า (`/voice?channel=…`) จึงพาไปช่องเดียวกันในหน้าใหม่แทน
///
/// พาไปฝั่งเบราว์เซอร์ ไม่ใช่ `redirect()` ของเซิร์ฟเวอร์ — ตัวนั้นโยนกลางการเรนเดอร์
/// แล้ว React (โหมด dev) วัดเวลาของคอมโพเนนต์ไม่ได้ ขึ้น error
/// "cannot have a negative time stamp" ในคอนโซลทุกครั้งที่เปิดลิงก์เก่า
export default function VoicePage() {
  const router = useRouter();

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('channel');

    router.replace(id ? `/chat?channel=${encodeURIComponent(id)}` : '/chat');
  }, [router]);

  return null;
}
