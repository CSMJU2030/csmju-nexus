import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import AuthSwitch from './auth-switch';

/// เทสต์แถบสลับเข้าสู่ระบบ/สมัครสมาชิก
///
/// สองเรื่องที่ต้องกันไว้ตลอด:
///   1. ต้องไม่มีช่องรับรหัสผ่าน — ระบบย่อยไม่ใช่ที่เก็บรหัสของมหาวิทยาลัย
///   2. ประกาศตัวเป็น tablist แล้วต้องทำตาม (ลูกศรต้องเลื่อนแท็บได้)
///      ถ้าประกาศแล้วไม่ทำ จะแย่กว่าไม่ประกาศ เพราะคนใช้คีย์บอร์ดจะกดลูกศร
///      แล้วไม่มีอะไรเกิดขึ้น

const CORE = {
  signInUrl: 'https://core.example/login',
  signUpUrl: 'https://core.example/register',
};

describe('AuthSwitch', () => {
  it('ต้องไม่มีช่องรับข้อมูลสักช่อง', () => {
    const { container } = render(<AuthSwitch {...CORE} />);

    const inputs = [...container.querySelectorAll('input')];

    expect(inputs.map((input) => input.type)).not.toContain('password');
    expect(inputs).toHaveLength(0);
  });

  it('เปิดมาอยู่ที่เข้าสู่ระบบ', () => {
    render(<AuthSwitch {...CORE} />);

    expect(screen.getByRole('tab', { name: /เข้าสู่ระบบ/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('มีบัญชี CSMJU2030 อยู่แล้ว')).toBeInTheDocument();
  });

  it('กดสลับไปสมัครสมาชิกแล้วเนื้อหาเปลี่ยนตาม', async () => {
    render(<AuthSwitch {...CORE} />);

    await userEvent.click(screen.getByRole('tab', { name: /สมัครสมาชิก/ }));

    expect(screen.getByText('ยังไม่มีบัญชี CSMJU2030')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /ไปหน้าลงทะเบียนของมหาวิทยาลัย/ }),
    ).toBeInTheDocument();
  });

  it('ลูกศรซ้ายขวาเลื่อนแท็บได้ตามที่ประกาศไว้ว่าเป็น tablist', async () => {
    render(<AuthSwitch {...CORE} />);

    const signin = screen.getByRole('tab', { name: /เข้าสู่ระบบ/ });

    signin.focus();
    await userEvent.keyboard('{ArrowRight}');

    const signup = screen.getByRole('tab', { name: /สมัครสมาชิก/ });

    expect(signup).toHaveAttribute('aria-selected', 'true');
    expect(signup).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');

    expect(
      screen.getByRole('tab', { name: /เข้าสู่ระบบ/ }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('มีแท็บเดียวที่อยู่ในลำดับ Tab — ที่เหลือเข้าถึงด้วยลูกศร', () => {
    // รูปแบบมาตรฐานของ tablist: Tab เข้ามาที่แถบครั้งเดียว แล้วเลื่อนด้วยลูกศร
    // ไม่ใช่ Tab ทีละอันจนกว่าจะเจอตัวที่ต้องการ
    render(<AuthSwitch {...CORE} />);

    const tabs = screen.getAllByRole('tab');
    const reachable = tabs.filter((tab) => tab.getAttribute('tabindex') === '0');

    expect(tabs).toHaveLength(2);
    expect(reachable).toHaveLength(1);
  });

  it('แผงเนื้อหาผูกกับแท็บที่เลือกอยู่', () => {
    // ไม่ผูก = โปรแกรมอ่านหน้าจอไม่รู้ว่าเนื้อหานี้เป็นของแท็บไหน
    render(<AuthSwitch {...CORE} />);

    const panel = screen.getByRole('tabpanel');
    const selected = screen.getByRole('tab', { name: /เข้าสู่ระบบ/ });

    expect(panel).toHaveAttribute('aria-labelledby', selected.id);
    expect(selected).toHaveAttribute('aria-controls', panel.id);
  });

  it('ยังไม่มีปลายทางของ Core = ปุ่มปิดพร้อมบอกเหตุผล', () => {
    // ปุ่มที่กดแล้วพาไปหน้าตาย แย่กว่าปุ่มที่ปิดไว้พร้อมคำอธิบาย
    render(<AuthSwitch />);

    expect(
      screen.getByRole('button', { name: /ไปยืนยันตัวตนที่ CSMJU2030/ }),
    ).toBeDisabled();

    expect(screen.getByRole('status')).toHaveTextContent(/รอ PM ยืนยันโดเมน/);
  });

  it('มีปลายทางแล้วปุ่มกดได้ และไม่ขึ้นคำเตือน', () => {
    render(<AuthSwitch {...CORE} />);

    expect(
      screen.getByRole('button', { name: /ไปยืนยันตัวตนที่ CSMJU2030/ }),
    ).toBeEnabled();

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('บอกผู้ใช้ตรง ๆ ว่าไม่เก็บรหัสผ่าน', () => {
    render(<AuthSwitch {...CORE} />);

    const panel = screen.getByRole('tabpanel');

    expect(within(panel).getByText(/ไม่รับรหัสผ่าน/)).toBeInTheDocument();
  });
});
