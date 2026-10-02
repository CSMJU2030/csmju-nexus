'use client';

import { useId, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/csmju/api';

/// ชิ้นส่วนร่วมของหน้าตั้งค่า — สวิตช์ · แถวตัวเลือก · หมวดพร้อมเส้นคั่น
/// และ hook อ่าน/เขียนการตั้งค่าแบบบันทึกทันที (optimistic)
///
/// Instagram ไม่มีปุ่ม "บันทึก" ในหน้าตั้งค่าเหล่านี้ — แตะแล้วมีผลเลย
/// หน้าบ้านจึงเปลี่ยนค่าบนจอก่อน แล้วค่อยยืนยันกับหลังบ้าน ถ้าหลังบ้านปฏิเสธ
/// ค่าบนจอต้องย้อนกลับ ไม่ใช่ค้างค่าที่ไม่ได้บันทึกจริงไว้ให้ผู้ใช้เข้าใจผิด

/// อ่านการตั้งค่าหนึ่งก้อน (`GET path`) แล้วแก้ทีละช่องด้วย `PATCH path`
export function useSettings<T extends object>(key: readonly unknown[], path: string) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api.get<T>(path) });

  const mutation = useMutation({
    mutationFn: ({ patch }: { patch: Partial<T> | Record<string, unknown>; optimistic?: Partial<T> }) =>
      api.patch<T>(path, patch),
    onMutate: async ({ patch, optimistic }) => {
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<T>(key);

      // ค่าที่เดาไว้ให้จอ (optimistic) แยกจากตัวคำขอ — บางช่องเขียนไม่ได้ตรง ๆ เช่น
      // pausedUntil ที่หลังบ้านคำนวณเองจาก pauseMinutes (ส่งไปตรง ๆ จะได้ 400)
      queryClient.setQueryData<T>(key, (current) =>
        current ? { ...current, ...(optimistic ?? patch) } : current,
      );

      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    // คำตอบของหลังบ้านคือค่าจริงล่าสุด — ทับค่าที่เดาไว้ด้วยค่านั้น
    onSuccess: (next) => queryClient.setQueryData(key, next),
  });

  return {
    data: query.data,
    loading: query.isPending,
    loadError: query.error,
    save: (patch: Partial<T> | Record<string, unknown>, optimistic?: Partial<T>) =>
      mutation.mutate({ patch, optimistic }),
    /// รอผล — สำหรับฟอร์มที่ต้องรู้ว่าสำเร็จก่อนบอก "บันทึกแล้ว"
    saveAsync: async (patch: Partial<T> | Record<string, unknown>) => {
      await mutation.mutateAsync({ patch });
    },
    saving: mutation.isPending,
    saveError: mutation.error,
  };
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

/// สวิตช์แบบ Instagram — `role="switch"` ให้โปรแกรมอ่านหน้าจอบอกเปิด/ปิดได้
export function IgSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
        checked ? 'bg-foreground' : 'bg-muted-foreground/40'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-[left] ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

/// แถวสวิตช์พร้อมคำอธิบายใต้ชื่อ
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-csmju-label">{title}</p>
        {description && <p className="mt-1 text-csmju-caption leading-snug text-muted-foreground">{description}</p>}
      </div>
      <IgSwitch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

/// หมวดตัวเลือกแบบวิทยุ — ชื่อตัวหนา · แถวตัวเลือก · บรรทัดตัวอย่าง · เส้นคั่น
export function ChoiceSection<V extends string>({
  title,
  value,
  options,
  onChange,
  example,
  disabled,
}: {
  title: string;
  value: V | undefined;
  options: { value: V; label: ReactNode }[];
  onChange: (next: V) => void;
  example?: ReactNode;
  disabled?: boolean;
}) {
  const name = useId();

  return (
    <fieldset className="border-b border-border py-5 first:pt-0 last:border-b-0">
      <legend className="float-left w-full pb-2 text-base font-bold">{title}</legend>
      <div className="clear-both">
        {options.map((option) => (
          <RadioRow
            key={option.value}
            name={name}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          >
            {option.label}
          </RadioRow>
        ))}
        {example && <p className="mt-1 text-csmju-caption text-muted-foreground">{example}</p>}
      </div>
    </fieldset>
  );
}

export function RadioRow({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2.5 text-csmju-label has-[:disabled]:cursor-default has-[:disabled]:opacity-60">
      <span className="min-w-0 flex-1">{children}</span>
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`grid size-6 shrink-0 place-items-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
          checked ? 'border-foreground' : 'border-muted-foreground/60'
        }`}
      >
        {checked && <span className="size-3 rounded-full bg-foreground" />}
      </span>
    </label>
  );
}

export function SettingsLoading() {
  return (
    <p className="flex items-center gap-2 py-10 text-csmju-label text-muted-foreground">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      กำลังโหลด…
    </p>
  );
}

export function SettingsError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive">
      {children}
    </p>
  );
}
