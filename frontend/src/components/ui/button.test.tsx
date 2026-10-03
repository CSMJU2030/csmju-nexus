import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';
import { Label } from './label';

/// ปุ่มและป้ายเขียนเองแทน shadcn (cva + Radix) — ตรึงพฤติกรรมเดิมไว้

describe('Button', () => {
  it('ไม่ส่งตัวเลือก = ใช้ variant/size ตั้งต้น', () => {
    render(<Button>บันทึก</Button>);

    const button = screen.getByRole('button', { name: 'บันทึก' });

    expect(button).toHaveClass('bg-primary', 'h-10', 'px-4');
  });

  it('className ของผู้เรียกทับคลาสตั้งต้นที่ชนกัน', () => {
    render(
      <Button variant="ghost" className="text-destructive hover:bg-destructive/10">
        ลบ
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'ลบ' });

    expect(button).toHaveClass('text-destructive', 'hover:bg-destructive/10');
    expect(button).not.toHaveClass('hover:bg-accent');
  });

  it('null = ไม่ใส่คลาสของกลุ่มนั้นเลย (กติกาเดียวกับ cva)', () => {
    expect(buttonVariants({ variant: null, size: null })).not.toMatch(/bg-primary|h-10/);
  });

  it('asChild สวม props ลงบนลูก — คลาสต่อกัน handler เรียกทั้งคู่ ref ถึงลูก', () => {
    const order: string[] = [];
    const ref = createRef<HTMLButtonElement>();

    render(
      <Button asChild ref={ref} onClick={() => order.push('slot')}>
        <a href="/x" className="underline" onClick={() => order.push('child')}>
          ไป
        </a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'ไป' });

    fireEvent.click(link);

    expect(link).toHaveClass('bg-primary', 'underline');
    expect(order).toEqual(['child', 'slot']);
    expect(ref.current).toBe(link);
  });
});

describe('Label', () => {
  it('เป็น <label> ที่ผูกกับช่องกรอกได้', () => {
    render(
      <>
        <Label htmlFor="name">ชื่อ</Label>
        <input id="name" />
      </>,
    );

    expect(screen.getByLabelText('ชื่อ')).toBeInstanceOf(HTMLInputElement);
  });

  it('ดับเบิลคลิกที่ป้ายไม่คลุมดำข้อความ แต่ยังเรียก onMouseDown ของผู้เรียก', () => {
    const onMouseDown = vi.fn();

    render(<Label onMouseDown={onMouseDown}>ชื่อ</Label>);

    const label = screen.getByText('ชื่อ');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 });

    label.dispatchEvent(event);

    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
});
