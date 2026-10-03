'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

/// สลับธีม สว่าง / มืด / ตามระบบ
///
/// **ก่อนหน้านี้โหมดมืดไม่เคยทำงานเลย** — `globals.css` นิยามสีครบทั้งสองชุด
/// และ `subsystem.yaml` ประกาศว่า `theme: light+dark` แต่ไม่มีโค้ดไหนใส่คลาส
/// `.dark` ให้เลย สีชุดมืดจึงเป็นโค้ดที่ไม่มีวันถูกใช้
///
/// ค่าเริ่มต้นคือ "ตามระบบ" เพราะผู้ใช้ตั้งค่านั้นไว้ที่เครื่องแล้ว การบังคับ
/// เป็นสว่างเสมอคือการเพิกเฉยต่อสิ่งที่เขาเลือกไว้

export type ThemeChoice = 'light' | 'dark' | 'system';

/// คีย์เดียวกับที่สคริปต์กันจอกะพริบใน app/layout.tsx อ่าน — ถ้าสองที่
/// ไม่ตรงกัน หน้าจะกะพริบขาวหนึ่งเฟรมทุกครั้งที่โหลดในโหมดมืด
export const THEME_KEY = 'csmju:theme';

const OPTIONS: ReadonlyArray<{
  value: ThemeChoice;
  label: string;
  Icon: typeof Sun;
}> = [
  { value: 'light', label: 'สว่าง', Icon: Sun },
  { value: 'system', label: 'ตามระบบ', Icon: Monitor },
  { value: 'dark', label: 'มืด', Icon: Moon },
];

/// ลงมือเปลี่ยนคลาสบน `<html>` จริง ๆ
///
/// ตรรกะเดียวกับสคริปต์กันจอกะพริบใน layout.tsx ซึ่งต้องเขียนซ้ำที่นั่น
/// เพราะมันต้องรันก่อน JavaScript ของแอปจะถูกโหลดด้วยซ้ำ
function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === 'dark' ||
    (choice === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/// ────────────────────────────────────────────────────────────────
/// อ่านค่าที่เลือกไว้แบบ external store
///
/// ใช้ `useSyncExternalStore` ไม่ใช่ `useState` + `useEffect` เพราะค่านี้
/// **ไม่ได้อยู่ใน React** — มันอยู่ใน localStorage และการตั้งค่าของ
/// ระบบปฏิบัติการ การอ่านมันด้วย setState ในตัว effect ทำให้เกิดการวาดซ้ำ
/// รอบพิเศษทุกครั้งที่ component ขึ้นจอ ซึ่งกฎ react-hooks ของ React
/// Compiler ห้ามไว้ตรง ๆ
///
/// ผลพลอยได้: `getServerSnapshot` ทำให้ฝั่งเซิร์ฟเวอร์กับเบราว์เซอร์เรนเดอร์
/// ตรงกันเสมอ จึงไม่มีคำเตือน hydration
/// ────────────────────────────────────────────────────────────────
function subscribe(onChange: () => void): () => void {
  // แท็บอื่นเปลี่ยนธีม — แท็บนี้ต้องตามด้วย
  window.addEventListener('storage', onChange);

  // ผู้ใช้สลับธีมที่ระบบปฏิบัติการขณะเลือก "ตามระบบ" อยู่
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const follow = () => {
    if (readChoice() === 'system') applyTheme('system');
    onChange();
  };

  media.addEventListener('change', follow);

  return () => {
    window.removeEventListener('storage', onChange);
    media.removeEventListener('change', follow);
  };
}

function readChoice(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);

    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    // โหมดส่วนตัวของเบราว์เซอร์บล็อก localStorage ได้
    return 'system';
  }
}

/// ฝั่งเซิร์ฟเวอร์ไม่มี localStorage และเดาธีมของผู้ใช้ไม่ได้
const serverChoice = (): ThemeChoice => 'system';

/// ธีมปัจจุบันสำหรับที่อื่นที่ไม่ใช่ปุ่มสามตัว — เช่นสวิตช์ "โหมดมืด" ในเมนู ≡
/// แบบ Instagram · `dark` คือผลจริงบนหน้าจอ (รวมกรณี "ตามระบบ" ที่ OS เป็นมืด)
export function useThemeChoice() {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice);
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );

  return { choice, dark, pick: pickTheme };
}

function pickTheme(next: ThemeChoice): void {
  applyTheme(next);

  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // เปลี่ยนธีมได้อยู่ แค่จำไม่ได้เมื่อรีเฟรช ไม่ใช่เรื่องคอขาดบาดตาย
  }

  // `storage` ไม่ยิงให้แท็บที่เป็นคนเขียนเอง ต้องปลุก store ด้วยมือ
  window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
}

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice);

  const pick = useCallback((next: ThemeChoice) => {
    applyTheme(next);

    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // เปลี่ยนธีมได้อยู่ แค่จำไม่ได้เมื่อรีเฟรช ไม่ใช่เรื่องคอขาดบาดตาย
    }

    // `storage` ไม่ยิงให้แท็บที่เป็นคนเขียนเอง ต้องปลุก store ด้วยมือ
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="ธีมของหน้าจอ"
      className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = choice === value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => pick(value)}
            className={`grid size-6 place-items-center rounded-md transition-colors ${
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
