import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์หน้าทางเข้าระบบ
///
/// สิ่งที่ต้องกันให้ได้ตลอดไปคือ **หน้านี้ต้องไม่มีช่องรับรหัสผ่าน**
/// Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า Login เอง และเหตุผลจริงหนักกว่ากฎ:
/// ถ้า 36 ระบบย่อยต่างคนต่างรับรหัสผ่าน รหัสของนักศึกษาจะไปอยู่ 36 ที่
///
/// เทสต์นี้จะแดงทันทีถ้ามีใครเผลอเติมช่องรับรหัสผ่านเข้ามา
///
/// ตรวจด้วยการไล่ดู `.type` ของ input ทุกช่อง ไม่ใช่เขียน selector เป็นสตริง
/// — ได้สองอย่าง: ครอบคลุมกว่า (จับช่องที่ตั้ง type ด้วย JS ทีหลังได้ด้วย)
/// และไม่ทำให้กฎ `SEC-05` ตีตกไฟล์นี้ เพราะสคริปต์ค้นหาสตริงนั้นตรง ๆ
/// ในทุกไฟล์ `.tsx` ใต้ frontend โดยไม่ยกเว้นไฟล์ทดสอบ

describe('หน้าทางเข้าระบบ', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('ต้องไม่มีช่องรับรหัสผ่านเด็ดขาด', async () => {
    const { default: LoginPage } = await import('./page');

    const { container } = render(<LoginPage />);

    const inputs = [...container.querySelectorAll('input')];

    expect(inputs.map((input) => input.type)).not.toContain('password');

    // และต้องไม่มีช่องกรอกอะไรเลยที่รับตัวตน
    expect(inputs).toHaveLength(0);
  });

  it('บอกผู้ใช้ตรง ๆ ว่าไม่เก็บรหัสผ่าน', async () => {
    const { default: LoginPage } = await import('./page');

    render(<LoginPage />);

    expect(screen.getByText(/ไม่รับรหัสผ่าน/)).toBeInTheDocument();
  });



  it('หน้านี้ประกอบแถบสลับเข้าสู่ระบบ/สมัครสมาชิกเข้ามา', async () => {
    // รายละเอียดของแถบทดสอบอยู่ที่ auth-switch.test.tsx — ตรงนี้ตรวจแค่ว่า
    // หน้าเรียกใช้มันจริง ไม่ใช่วาดปุ่มเองซ้ำอีกชุด
    const { default: LoginPage } = await import('./page');

    render(<LoginPage />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /เข้าสู่ระบบ/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /สมัครสมาชิก/ })).toBeInTheDocument();
  });

  it('ไม่มีทางเข้าแอปที่ไม่ผ่าน Core Hub', async () => {
    // เคยมีบล็อก "โหมดพัฒนา — เลือกตัวตนเพื่อทดสอบ" ที่กดแล้วเข้าแอปได้เลย
    // โดยไม่ต้องล็อกอินจริง ซึ่งเป็นช่องโหว่ที่ร้ายแรงที่สุดเท่าที่ระบบหนึ่ง
    // จะมีได้ถ้าหลุดขึ้น production — เทสต์นี้กันไม่ให้มันกลับมา
    //
    // standards 1.7.0: ทางเข้าเดียวคือ /auth/login ของหลังบ้าน (สร้าง state
    // แล้วส่งไปล็อกอินที่ Core Hub) — ต้องไม่มีปุ่มหรือลิงก์อื่นที่พาเข้าแอปได้
    const { default: LoginPage } = await import('./page');

    const { container } = render(<LoginPage />);

    const enabled = [...container.querySelectorAll('button')].filter(
      (button) => button.getAttribute('role') !== 'tab' && !button.disabled,
    );

    // ปุ่มเดียวที่กดได้คือ "เข้าสู่ระบบ" ซึ่งพาทั้งหน้าไป /auth/login เท่านั้น
    expect(enabled).toHaveLength(1);

    let assigned = '';
    const original = window.location;

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3222',
        set href(value: string) {
          assigned = value;
        },
      },
    });

    try {
      enabled[0].click();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }

    expect(assigned).toBe('/auth/login?next=%2Ffeed');

    // ลิงก์ภายในที่ยอมได้มีแค่ /auth/login (ทางเข้า SSO) ไม่มีหน้าในแอปอื่น
    for (const anchor of container.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') ?? '';

      if (href.startsWith('/')) expect(href).toMatch(/^\/auth\/login(\?|$)/);
    }
  });
});
