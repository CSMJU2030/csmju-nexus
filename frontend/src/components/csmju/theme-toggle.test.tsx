import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, ThemeToggle } from './theme-toggle';

/// เทสต์ปุ่มสลับธีม
///
/// สิ่งที่ต้องกันไว้คือ **คลาส `.dark` ต้องถูกใส่ที่ `<html>` จริง ๆ**
/// เพราะ `globals.css` ผูกสีชุดมืดทั้งหมดไว้กับคลาสนั้น ถ้าไม่มีใครใส่
/// สีชุดมืดจะกลายเป็นโค้ดที่ไม่มีวันถูกใช้ — ซึ่งเป็นสภาพก่อนหน้านี้จริง ๆ

function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );

  return listeners;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ปุ่มสลับธีม', () => {
  it('มีสามตัวเลือกและอ่านออกด้วยเครื่องอ่านหน้าจอ', () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    expect(screen.getByRole('radiogroup', { name: 'ธีมของหน้าจอ' })).toBeInTheDocument();

    for (const label of ['สว่าง', 'ตามระบบ', 'มืด']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('ค่าเริ่มต้นคือ "ตามระบบ" — ไม่บังคับทับสิ่งที่ผู้ใช้ตั้งไว้ที่เครื่อง', () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    expect(screen.getByRole('radio', { name: 'ตามระบบ' })).toBeChecked();
  });

  it('เลือก "มืด" แล้ว <html> ต้องได้คลาส dark จริง', async () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole('radio', { name: 'มืด' }));

    // ถ้าบรรทัดนี้แดง แปลว่าสีชุดมืดทั้งหมดใน globals.css ใช้ไม่ได้
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // บอกเบราว์เซอร์ด้วย เพื่อให้แถบเลื่อนและช่องกรอกของระบบเป็นโทนมืดตาม
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('เลือก "สว่าง" แล้วต้องถอดคลาส dark ออก', async () => {
    mockMatchMedia(true);
    document.documentElement.classList.add('dark');
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole('radio', { name: 'สว่าง' }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('"ตามระบบ" ตามการตั้งค่าของเครื่อง ไม่ใช่ค่าที่ฮาร์ดโค้ดไว้', async () => {
    mockMatchMedia(true);
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole('radio', { name: 'ตามระบบ' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('จำค่าที่เลือกไว้ และคีย์ต้องตรงกับสคริปต์กันจอกะพริบ', async () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole('radio', { name: 'มืด' }));

    // คีย์นี้ถูกเขียนซ้ำเป็นสตริงตรง ๆ ในสคริปต์ที่ app/layout.tsx ฝังใน
    // <head> (มันรันก่อน JavaScript ของแอปถูกโหลด จึง import ไม่ได้)
    // ถ้าสองที่ไม่ตรงกัน หน้าจะกะพริบขาวหนึ่งเฟรมทุกครั้งที่โหลด
    expect(THEME_KEY).toBe('csmju:theme');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('อ่านค่าที่จำไว้ตอนเปิดหน้าใหม่', () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_KEY, 'dark');

    render(<ThemeToggle />);

    expect(screen.getByRole('radio', { name: 'มืด' })).toBeChecked();
  });

  it('localStorage ใช้ไม่ได้ก็ยังเปลี่ยนธีมได้ แค่จำไม่ได้', async () => {
    mockMatchMedia(false);
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('โหมดส่วนตัวบล็อกไว้');
      });

    render(<ThemeToggle />);

    // ต้องไม่โยน error ออกมาทำให้ทั้งหน้าพัง
    await userEvent.click(screen.getByRole('radio', { name: 'มืด' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);

    setItem.mockRestore();
  });
});
