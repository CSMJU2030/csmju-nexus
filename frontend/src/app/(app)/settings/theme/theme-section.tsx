'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeChoice, type ThemeChoice } from '@/components/csmju/theme-toggle';
import { SettingsHeading } from '../settings-shell';

/// ธีมหน้าจอ — ตัวเลือกเดียวกับปุ่มสลับธีมบนแถบบน แต่เป็นรายการเต็มแบบหน้า
/// ตั้งค่าของ Instagram
///
/// ใช้ `useThemeChoice` ตัวเดียวกับแถบซ้าย ไม่เขียนการสลับคลาส `.dark` ซ้ำ —
/// ถ้ามีสองชุด วันหนึ่งชุดหนึ่งจะลืมเขียน localStorage แล้วรีเฟรชทีธีมเด้งกลับ
const OPTIONS: { value: ThemeChoice; label: string; hint: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'สว่าง', hint: 'พื้นขาว ตัวอักษรเข้ม', Icon: Sun },
  { value: 'dark', label: 'มืด', hint: 'พื้นเข้ม ถนอมสายตาตอนกลางคืน', Icon: Moon },
  { value: 'system', label: 'ตามระบบ', hint: 'ใช้ตามที่ตั้งไว้ในเครื่องของคุณ', Icon: Monitor },
];

export function ThemeSection() {
  const { choice, pick } = useThemeChoice();

  return (
    <>
      <SettingsHeading>ธีมหน้าจอ</SettingsHeading>

      <div
        role="radiogroup"
        aria-label="ธีมหน้าจอ"
        className="overflow-hidden rounded-[20px] border border-border"
      >
        {OPTIONS.map(({ value, label, hint, Icon }) => {
          const active = choice === value;

          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(value)}
              className="flex w-full items-center gap-4 border-t border-border px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-accent"
            >
              <Icon aria-hidden strokeWidth={1.9} className="size-6 shrink-0" />

              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-csmju-label font-semibold">{label}</span>
                <span className="block text-csmju-caption text-muted-foreground">{hint}</span>
              </span>

              <span
                aria-hidden
                className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${
                  active ? 'border-foreground' : 'border-muted-foreground/60'
                }`}
              >
                {active && <span className="size-3 rounded-full bg-foreground" />}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-csmju-caption text-muted-foreground">
        จำไว้ในเบราว์เซอร์นี้ · เครื่องอื่นตั้งแยกกัน
      </p>
    </>
  );
}
