'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Hash, MessagesSquare, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Avatar, useProfile } from '@/components/csmju/user-name';

/// "ค้นหาล่าสุด" แบบ Instagram — คน · ห้อง · แฮชแท็ก · คำค้น ที่เคยกดเปิด
///
/// เก็บใน localStorage ของเครื่องนี้ (`csmju:search-recent`) **แยกตาม id ผู้ใช้**
/// — เครื่องเดียวกันสลับบัญชีได้ (ห้องแล็บ) ถ้าเก็บรวมกัน คนถัดไปจะเห็นว่าคนก่อน
/// ค้นหาใครไว้บ้าง ส่วนหลังบ้านไม่ต้องรู้เรื่องนี้เลย มันเป็นความสะดวกเฉพาะเครื่อง
///
/// ทุกการแตะ localStorage ห่อ try/catch — หน้าต่างส่วนตัว/ปิด cookie แล้วมัน
/// โยน error ได้ทั้งตอนอ่านและเขียน หน้าค้นหาต้องยังใช้ได้ แค่ไม่มีรายการล่าสุด

export const RECENT_KEY = 'csmju:search-recent';
const RECENT_MAX = 20;

export type RecentItem =
  | { kind: 'person'; id: string; title: string; subtitle: string | null }
  | { kind: 'room'; id: string; title: string }
  | { kind: 'hashtag'; id: string }
  | { kind: 'query'; id: string };

function isRecent(value: unknown): value is RecentItem {
  if (!value || typeof value !== 'object') return false;

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === 'string' &&
    (item.kind === 'hashtag' ||
      item.kind === 'query' ||
      ((item.kind === 'person' || item.kind === 'room') && typeof item.title === 'string'))
  );
}

function readAll(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '{}');

    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readFor(coreUserId: string): RecentItem[] {
  const list = readAll()[coreUserId];

  // ข้อมูลในเครื่องแก้มือได้ — กรองรูปที่ไม่รู้จักทิ้ง ดีกว่าหน้าพังเพราะแถวเสีย
  return Array.isArray(list) ? list.filter(isRecent).slice(0, RECENT_MAX) : [];
}

function writeFor(coreUserId: string, items: RecentItem[]) {
  try {
    const all = readAll();

    if (items.length === 0) delete all[coreUserId];
    else all[coreUserId] = items;

    window.localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    // จำไม่ได้ก็แค่ไม่มีรายการล่าสุดในรอบหน้า
  }
}

const same = (a: RecentItem, b: RecentItem) => a.kind === b.kind && a.id === b.id;

/// คำค้นที่ขึ้นต้นด้วย # จำเป็นแฮชแท็ก (ไอคอน #) ที่เหลือจำเป็นคำค้น
export function recentFromQuery(text: string): RecentItem {
  const id = text.trim();

  return id.startsWith('#') ? { kind: 'hashtag', id } : { kind: 'query', id };
}

export function useSearchRecents(coreUserId: string) {
  const [items, setItems] = useState<RecentItem[]>(() => readFor(coreUserId));

  const commit = useCallback(
    (next: RecentItem[]) => {
      setItems(next);
      writeFor(coreUserId, next);
    },
    [coreUserId],
  );

  return {
    items,
    /// ขึ้นบนสุด — กดของเดิมซ้ำ = ย้ายขึ้นบน ไม่ซ้ำสองแถว
    add: (item: RecentItem) =>
      commit([item, ...items.filter((row) => !same(row, item))].slice(0, RECENT_MAX)),
    remove: (item: RecentItem) => commit(items.filter((row) => !same(row, item))),
    clear: () => commit([]),
  };
}

export function SearchRecents({
  items,
  onRemove,
  onClear,
  onOpen,
  onSearch,
}: {
  items: RecentItem[];
  onRemove: (item: RecentItem) => void;
  onClear: () => void;
  /// กดเปิดแถว (คน/ห้อง) — ย้ายขึ้นบนสุด
  onOpen: (item: RecentItem) => void;
  /// กดแถวคำค้น/แฮชแท็ก — ค้นคำนั้นอีกครั้ง
  onSearch: (text: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-labelledby="search-recent-title" className="mx-auto max-w-195">
      <header className="flex items-center justify-between px-4 pb-2 lg:px-0">
        <h2 id="search-recent-title" className="text-csmju-body font-semibold">
          ล่าสุด
        </h2>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-csmju-label font-semibold text-link hover:opacity-70"
          >
            ล้างทั้งหมด
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <p className="py-16 text-center text-csmju-label font-semibold text-muted-foreground">
          ไม่มีการค้นหาล่าสุด
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <RecentRow
              key={`${item.kind}-${item.id}`}
              item={item}
              onRemove={() => onRemove(item)}
              onOpen={() => onOpen(item)}
              onSearch={onSearch}
            />
          ))}
        </ul>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false} className="max-w-sm rounded-xl">
          <div className="px-6 pb-5 pt-7 text-center">
            <DialogTitle className="text-csmju-body font-semibold">
              ล้างประวัติการค้นหาใช่ไหม
            </DialogTitle>
            <p className="mt-2 text-csmju-label text-muted-foreground">
              คุณจะไม่สามารถยกเลิกการกระทำนี้ได้ และหากคุณล้างประวัติการค้นหา
              คุณอาจยังคงเห็นบัญชีที่คุณเคยค้นหาเป็นบัญชีที่แนะนำ
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClear();
              setConfirming(false);
            }}
            className="block w-full border-t border-border px-4 py-3.5 text-center text-csmju-label font-bold text-destructive transition-colors hover:bg-accent"
          >
            ล้างทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="block w-full border-t border-border px-4 py-3.5 text-center text-csmju-label transition-colors hover:bg-accent"
          >
            ไม่ใช่ตอนนี้
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RecentRow({
  item,
  onRemove,
  onOpen,
  onSearch,
}: {
  item: RecentItem;
  onRemove: () => void;
  onOpen: () => void;
  onSearch: (text: string) => void;
}) {
  const body =
    item.kind === 'person' ? (
      <PersonLabel item={item} />
    ) : (
      <>
        <span className="grid size-11 shrink-0 place-items-center rounded-full border border-border">
          {item.kind === 'room' ? (
            <MessagesSquare className="size-5" strokeWidth={1.9} aria-hidden />
          ) : item.kind === 'hashtag' ? (
            <Hash className="size-5" strokeWidth={1.9} aria-hidden />
          ) : (
            <Search className="size-5" strokeWidth={1.9} aria-hidden />
          )}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-csmju-label font-semibold">
            {item.kind === 'room' ? item.title : item.id}
          </span>
          {item.kind === 'room' && (
            <span className="block truncate text-csmju-label text-muted-foreground">ห้องแชท</span>
          )}
        </span>
      </>
    );

  const label = item.kind === 'person' || item.kind === 'room' ? item.title : item.id;
  const rowClass = 'flex min-w-0 flex-1 items-center gap-3 text-left';

  return (
    <li className="flex items-center gap-3 rounded-lg px-4 py-2 transition-colors hover:bg-accent lg:px-2">
      {item.kind === 'person' ? (
        <Link href={`/profile/${encodeURIComponent(item.id)}`} onClick={onOpen} className={rowClass}>
          {body}
        </Link>
      ) : item.kind === 'room' ? (
        <Link href={`/chat?channel=${encodeURIComponent(item.id)}`} onClick={onOpen} className={rowClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={() => onSearch(item.id)} className={rowClass}>
          {body}
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`ลบ ${label} ออกจากรายการล่าสุด`}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-5" strokeWidth={1.9} />
      </button>
    </li>
  );
}

/// ชื่อคนอ่านสดจากแคชโปรไฟล์ — เปลี่ยนชื่อไปแล้วรายการล่าสุดต้องไม่ค้างชื่อเก่า
/// (ชื่อที่จำไว้ใช้แค่ระหว่างรอแคชโหลด)
function PersonLabel({ item }: { item: Extract<RecentItem, { kind: 'person' }> }) {
  const profile = useProfile(item.id);
  const name = profile.displayName === item.id ? item.title : profile.displayName;

  return (
    <>
      <Avatar coreUserId={item.id} size={44} showOnline={false} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-csmju-label font-semibold">{name}</span>
        <span className="block truncate text-csmju-label text-muted-foreground">
          {item.subtitle ?? item.id}
        </span>
      </span>
    </>
  );
}
