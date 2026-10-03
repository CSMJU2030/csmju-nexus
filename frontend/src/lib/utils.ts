import { mergeClasses } from './merge-classes';

/// ค่าที่ส่งเข้า cn() ได้ — สตริง ตัวเลข อาร์เรย์ (ซ้อนได้) หรืออ็อบเจกต์
/// `{ 'คลาส': เงื่อนไข }` ค่าเท็จทุกชนิด (false, null, undefined, 0, '') ถูกข้าม
export type ClassDictionary = Record<string, unknown>;
export type ClassArray = ClassValue[];
export type ClassValue =
  | ClassArray
  | ClassDictionary
  | string
  | number
  | bigint
  | null
  | boolean
  | undefined;

/// ต่อคลาสที่ "เป็นจริง" ด้วยช่องว่าง ตามกติกาเดียวกับ clsx
function join(value: ClassValue): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object') return '';

  let out = '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const part = join(item);
      if (part) out += (out && ' ') + part;
    }
  } else {
    for (const key in value) {
      if (value[key]) out += (out && ' ') + key;
    }
  }
  return out;
}

/// รวมคลาส Tailwind โดยให้ตัวที่มาทีหลังชนะ
///
/// เขียนเองทั้งหมดแทน `clsx` + `tailwind-merge` ที่อยู่นอกรายชื่อ dependency
/// ที่มาตรฐานอนุญาต (ARC-02) พฤติกรรมเหมือนเดิมทุกอย่าง:
///
///   - รับสตริง/อาร์เรย์/อ็อบเจกต์ปนกันได้ ข้ามค่าเท็จ เหมือน clsx
///   - ตัดคลาสที่ถูกทับ เช่น `cn('px-2', 'px-4')` → `px-4` เหมือน tailwind-merge
///
/// ข้อสองจำเป็น ไม่ใช่แค่ต่อสตริง: เวลาส่ง `className` เข้ามาทับของเดิม
/// ถ้าได้ทั้งสองคลาส ผลลัพธ์จะขึ้นกับลำดับใน CSS ไม่ใช่ลำดับที่เขียน
/// รายละเอียดการจัดกลุ่มอยู่ที่ `merge-classes.ts`
export function cn(...inputs: ClassValue[]): string {
  return mergeClasses(join(inputs));
}
