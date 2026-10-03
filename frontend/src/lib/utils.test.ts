import { describe, expect, it } from 'vitest';
import { cn } from './utils';

/// cn() เขียนเองแทน clsx + tailwind-merge — เทสต์นี้ตรึงพฤติกรรมเดิมไว้
///
/// ทุกเคสในไฟล์นี้เทียบกับผลของ `twMerge(clsx(...))` ตัวจริงแล้วตอนเปลี่ยน
/// (รวมถึงลองสุ่มคลาสทุกตัวที่โปรเจกต์ใช้เป็นแสนชุด ได้ผลตรงกันหมด)
/// ถ้าเทสต์ไหนพัง แปลว่าหน้าตาของ component บางตัวกำลังจะเปลี่ยน

describe('cn — ต่อคลาสแบบ clsx', () => {
  it('ข้ามค่าเท็จทุกชนิด', () => {
    expect(cn('a', false, null, undefined, 0, '', 'b')).toBe('a b');
  });

  it('รับอาร์เรย์ซ้อนและอ็อบเจกต์เงื่อนไข', () => {
    expect(cn(['a', ['b', { c: true, d: false }]], { e: 1, f: 0 })).toBe('a b c e');
  });

  it('ยุบช่องว่างเกินและตัดหัวท้าย', () => {
    expect(cn('  a   b ', ' c')).toBe('a b c');
  });

  it('คลาสที่ไม่ใช่ Tailwind ซ้ำได้ ไม่ถูกตัด', () => {
    expect(cn('csmju-surface', 'csmju-surface')).toBe('csmju-surface csmju-surface');
  });
});

describe('cn — ตัวที่มาทีหลังชนะแบบ tailwind-merge', () => {
  it('className ที่ส่งเข้ามาทับค่าตั้งต้นของ component', () => {
    // DialogContent: max-w-lg ตั้งต้น ถูก max-w-[400px] ของผู้เรียกทับ
    expect(cn('w-full max-w-lg p-0', 'max-w-[400px] rounded-xl p-6')).toBe(
      'w-full max-w-[400px] rounded-xl p-6',
    );
  });

  it('variant ต่างกันไม่ชนกัน แต่ variant เดียวกันชน', () => {
    expect(cn('hover:bg-accent bg-card', 'hover:bg-destructive/10')).toBe(
      'bg-card hover:bg-destructive/10',
    );
    expect(cn('md:hover:px-2', 'hover:md:px-4')).toBe('hover:md:px-4');
  });

  it('กลุ่มใหญ่กินกลุ่มย่อยที่อยู่ก่อนหน้า แต่ไม่กลับกัน', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
    expect(cn('p-4', 'px-2')).toBe('p-4 px-2');
    expect(cn('w-4 h-4', 'size-6')).toBe('size-6');
  });

  it('ขนาดตัวอักษรกิน leading ที่อยู่ก่อน (เพราะ text-* ตั้ง line-height มาด้วย)', () => {
    expect(cn('text-lg font-semibold leading-none', 'text-base')).toBe('font-semibold text-base');
  });

  it('สีกับขนาดตัวอักษรอยู่คนละกลุ่ม', () => {
    expect(cn('text-sm text-muted-foreground', 'text-foreground')).toBe('text-sm text-foreground');
  });

  it('text-csmju-* นับเป็นสี เหมือนต้นฉบับ (หน้าจอปัจจุบันอิงพฤติกรรมนี้)', () => {
    expect(cn('text-csmju-label font-semibold', 'text-foreground')).toBe(
      'font-semibold text-foreground',
    );
  });

  it('ความทึบท้าย / ไม่ทำให้กลายเป็นคนละกลุ่ม', () => {
    expect(cn('bg-white/15 text-white', 'bg-white')).toBe('text-white bg-white');
  });

  it('ค่าติดลบอยู่กลุ่มเดียวกับค่าบวก', () => {
    expect(cn('-mt-1', 'mt-2')).toBe('mt-2');
  });

  it('display กับ hidden ทับกัน', () => {
    expect(cn('flex', 'hidden 2xl:flex')).toBe('hidden 2xl:flex');
  });

  it('! (important) แยกกลุ่มจากคลาสปกติ', () => {
    expect(cn('[&>span]:!size-full', '[&>span]:size-4')).toBe('[&>span]:!size-full [&>span]:size-4');
  });

  it('แอนิเมชันป๊อปอัปของเราไม่ชนกับ animate-spin', () => {
    expect(cn('animate-in fade-in-0 zoom-in-95', 'animate-spin')).toBe(
      'animate-in fade-in-0 zoom-in-95 animate-spin',
    );
  });

  it('คำทั่วไปที่หน้าตาคล้ายคลาสไม่ถูกตีความ', () => {
    expect(cn('-mt-1', 'my-following')).toBe('-mt-1 my-following');
  });
});
