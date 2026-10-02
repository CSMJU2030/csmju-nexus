'use client';

import { MotionConfig } from 'framer-motion';

/// ให้ framer-motion เคารพการตั้งค่า "ลดการเคลื่อนไหว" ของระบบปฏิบัติการ
///
/// กฎ CSS ใน globals.css คุมได้เฉพาะ animation และ transition ของ CSS
/// แต่ framer-motion ขยับค่าด้วย JavaScript แล้วเขียนลง inline style
/// เป็นเฟรม ๆ — CSS ไปห้ามมันไม่ได้เลย
///
/// `reducedMotion="user"` ทำให้ทุก <motion.*> ในแอปข้ามการเคลื่อนที่และ
/// การหมุน/ย่อขยาย แต่ยังคงการเปลี่ยนความทึบไว้ (ซึ่งไม่กระตุ้นอาการเวียน
/// ศีรษะ) ผู้ใช้จึงยังเห็นว่าอะไรเปลี่ยนไป โดยไม่ต้องทนภาพที่เลื่อนไปมา
///
/// เป็น Client Component ชิ้นเล็ก ๆ เพื่อให้ layout ยังเป็น Server Component
/// ได้เหมือนเดิม
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
