'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import type { ActivityFilterParams, ActivityOrder } from '@/lib/csmju/types';

/// แถบเครื่องมือบนทุกรายการของ "กิจกรรมของคุณ" — ลำดับ · กรอง · เลือกหลายชิ้น
///
/// ตัวกรองแมปตรงกับพารามิเตอร์ของหลังบ้าน (`order`, `authorCoreUserId`,
/// `from`, `to`) ไม่มีการกรองซ้ำที่หน้าบ้าน — ถ้ากรองที่หน้าบ้าน หน้าที่แบ่งมา
/// 24 ชิ้นอาจเหลือศูนย์ชิ้นทั้งที่หน้าถัดไปมีของตรงเงื่อนไขเต็มไปหมด

export interface ActivityFilters {
  order: ActivityOrder;
  author: string | null;
  /// `YYYY-MM-DD` จากช่องวันที่ — แปลงเป็นเวลาจริงตอนส่งด้วย `filterParams`
  from: string | null;
  to: string | null;
}

export const DEFAULT_FILTERS: ActivityFilters = { order: 'newest', author: null, from: null, to: null };

export const ORDER_LABEL: Record<ActivityOrder, string> = {
  newest: 'ใหม่สุดไปเก่าสุด',
  oldest: 'เก่าสุดไปใหม่สุด',
};

/// ส่งวันที่ตามช่อง (`YYYY-MM-DD`) ไปตรง ๆ — หลังบ้านตีความว่า "ทั้งวันนั้นตามเวลา
/// กรุงเทพฯ" ให้เองทั้งสองปลาย ถ้าแปลงเป็นเวลา UTC ที่หน้าบ้าน กิจกรรมช่วง
/// 00:00-07:00 ของวันที่เลือกจะหลุดไปอยู่วันก่อนหน้า
export function filterParams(filters: ActivityFilters): ActivityFilterParams {
  return {
    order: filters.order,
    authorCoreUserId: filters.author ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  };
}

export function isFiltered(filters: ActivityFilters) {
  return filters.author !== null || filters.from !== null || filters.to !== null;
}

export function ActivityToolbar({
  filters,
  onChange,
  people,
  showAuthor = false,
  showDates = true,
  selecting,
  onSelecting,
  canSelect = true,
}: {
  filters: ActivityFilters;
  onChange: (next: ActivityFilters) => void;
  /// ผู้เขียนที่เลือกกรองได้ — คนจริงที่เจอในรายการนี้และคนที่เราติดตาม
  people?: string[];
  showAuthor?: boolean;
  showDates?: boolean;
  selecting: boolean;
  onSelecting: (next: boolean) => void;
  canSelect?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-3 px-4 py-3 md:px-6">
      <p className="text-csmju-label font-semibold">{ORDER_LABEL[filters.order]}</p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`flex h-8 items-center gap-1 rounded-full border px-3 text-csmju-caption font-semibold transition-colors hover:bg-accent ${
          isFiltered(filters) ? 'border-foreground' : 'border-border'
        }`}
      >
        เรียงลำดับและกรอง
        <ChevronDown aria-hidden className="size-3.5" />
      </button>

      <span className="flex-1" />

      {canSelect && (
        <button
          type="button"
          onClick={() => onSelecting(!selecting)}
          aria-pressed={selecting}
          className="text-csmju-label font-semibold text-link hover:text-foreground"
        >
          {selecting ? 'ยกเลิก' : 'เลือก'}
        </button>
      )}

      {open && (
        <FilterDialog
          filters={filters}
          people={people ?? []}
          showAuthor={showAuthor}
          showDates={showDates}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/// กล่อง "เรียงลำดับและกรอง" — แก้ค่าในกล่องก่อน แล้วค่อยใช้จริงเมื่อกด "ใช้"
/// (แบบ Instagram) ไม่ยิงคำขอใหม่ทุกครั้งที่แตะตัวเลือก
export function FilterDialog({
  filters,
  people,
  showAuthor,
  showDates,
  onClose,
  onApply,
}: {
  filters: ActivityFilters;
  people: string[];
  showAuthor: boolean;
  showDates: boolean;
  onClose: () => void;
  onApply: (next: ActivityFilters) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(filters);
  const badRange = Boolean(draft.from && draft.to && draft.from > draft.to);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[400px] rounded-xl border-0 bg-card">
        <DialogTitle className="flex h-[43px] items-center justify-center border-b border-border text-base font-bold">
          เรียงลำดับและกรอง
        </DialogTitle>
        <DialogDescription className="sr-only">เลือกลำดับ ผู้เขียน และช่วงวันที่ของรายการ</DialogDescription>

        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-2">
          <Group title="เรียงตาม">
            {(['newest', 'oldest'] as const).map((order) => (
              <RadioRow
                key={order}
                name={`${id}-order`}
                checked={draft.order === order}
                onChange={() => setDraft({ ...draft, order })}
              >
                {ORDER_LABEL[order]}
              </RadioRow>
            ))}
          </Group>

          {showAuthor && (
            <Group title="ผู้เขียน">
              <RadioRow
                name={`${id}-author`}
                checked={draft.author === null}
                onChange={() => setDraft({ ...draft, author: null })}
              >
                ทุกคน
              </RadioRow>
              {people.map((person) => (
                <PersonRadio
                  key={person}
                  name={`${id}-author`}
                  coreUserId={person}
                  checked={draft.author === person}
                  onChange={() => setDraft({ ...draft, author: person })}
                />
              ))}
              {people.length === 0 && (
                <p className="py-2 text-csmju-caption text-muted-foreground">
                  ยังไม่มีผู้เขียนให้เลือกในรายการนี้
                </p>
              )}
            </Group>
          )}

          {showDates && (
            <Group title="วันที่">
              <div className="grid grid-cols-2 gap-3 py-1">
                <label className="text-csmju-caption text-muted-foreground">
                  วันที่เริ่มต้น
                  <input
                    type="date"
                    value={draft.from ?? ''}
                    max={draft.to ?? undefined}
                    onChange={(event) => setDraft({ ...draft, from: event.target.value || null })}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-csmju-label text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                  />
                </label>
                <label className="text-csmju-caption text-muted-foreground">
                  วันที่สิ้นสุด
                  <input
                    type="date"
                    value={draft.to ?? ''}
                    min={draft.from ?? undefined}
                    onChange={(event) => setDraft({ ...draft, to: event.target.value || null })}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-csmju-label text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                  />
                </label>
              </div>
              {badRange && (
                <p role="alert" className="text-csmju-caption text-destructive">
                  วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด
                </p>
              )}
            </Group>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_FILTERS })}
            className="h-9 flex-1 rounded-lg bg-muted text-csmju-label font-semibold hover:bg-accent"
          >
            ล้างค่า
          </button>
          <button
            type="button"
            disabled={badRange}
            onClick={() => onApply(draft)}
            className="h-9 flex-1 rounded-lg bg-primary text-csmju-label font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            ใช้
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-b border-border py-3 last:border-b-0">
      <legend className="float-left mb-1 w-full text-csmju-label font-semibold">{title}</legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

function RadioRow({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2 text-csmju-label">
      <span className="min-w-0 flex-1">{children}</span>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="peer sr-only" />
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

function PersonRadio({
  name,
  coreUserId,
  checked,
  onChange,
}: {
  name: string;
  coreUserId: string;
  checked: boolean;
  onChange: () => void;
}) {
  const profile = useProfile(coreUserId);

  return (
    <RadioRow name={name} checked={checked} onChange={onChange}>
      <span className="flex items-center gap-3 [&_[data-slot=avatar]>span]:!bg-background">
        <Avatar coreUserId={coreUserId} size={32} showOnline={false} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-semibold">{profile.displayName}</span>
        </span>
      </span>
    </RadioRow>
  );
}

/// แถบล่างตอนเลือกหลายชิ้น — "เลือกแล้ว n รายการ" + ปุ่มสีแดงของหมวดนั้น
export function SelectBar({
  count,
  actionLabel,
  busy,
  onAction,
  onCancel,
}: {
  count: number;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-background px-4 py-3 md:px-6">
      <p role="status" className="flex-1 text-csmju-label font-semibold">
        เลือกแล้ว {count} รายการ
      </p>
      <button type="button" onClick={onCancel} className="h-8 rounded-lg px-3 text-csmju-label font-semibold hover:bg-accent">
        ยกเลิก
      </button>
      <button
        type="button"
        disabled={count === 0 || busy}
        onClick={onAction}
        className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-csmju-label font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40"
      >
        {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
        {actionLabel}
      </button>
    </div>
  );
}

/// ถามก่อนลบถาวร (ความคิดเห็น · โพสต์ · คลิป · ไฮไลต์) — เลิกถูกใจไม่ต้องถาม
/// เพราะกดถูกใจใหม่ได้ทุกเมื่อ ส่วนของที่ลบแล้วกู้คืนไม่ได้
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
        <div className="px-6 pb-4 pt-7 text-center">
          <DialogTitle className="text-lg font-semibold leading-snug">{title}</DialogTitle>
          <DialogDescription className="mt-1.5">{body}</DialogDescription>
          {error && (
            <p role="alert" className="mt-2 text-csmju-caption text-destructive">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="flex min-h-12 w-full items-center justify-center gap-1.5 border-t border-border text-csmju-label font-bold text-destructive hover:bg-accent disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label hover:bg-accent disabled:opacity-60"
        >
          ยกเลิก
        </button>
      </DialogContent>
    </Dialog>
  );
}
