import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/// รวมคลาส Tailwind โดยให้ตัวที่มาทีหลังชนะ
///
/// เขียนเองสองบรรทัดแทนการพึ่งแพ็กเกจ `cn` จากภายนอก เพราะของที่ต้องใช้จริง
/// (`clsx` กับ `tailwind-merge`) เป็น dependency อยู่แล้ว การมีแพ็กเกจอีกตัว
/// มาห่อสองตัวนี้คือจุดพึ่งพาเพิ่มโดยไม่ได้อะไรกลับมา
///
/// `twMerge` จำเป็น ไม่ใช่แค่ `clsx`: เวลาส่ง `className` เข้ามาทับของเดิม
/// เช่น `cn('px-2', 'px-4')` ถ้าใช้ clsx เฉย ๆ จะได้ทั้งสองคลาสแล้วผลลัพธ์
/// ขึ้นกับลำดับใน CSS ไม่ใช่ลำดับที่เขียน — twMerge ตัดตัวที่ถูกทับทิ้งให้
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
