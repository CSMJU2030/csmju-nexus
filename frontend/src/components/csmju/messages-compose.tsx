'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import { useMyFollowing } from '@/components/csmju/profile-follow-list';
import { useSuggestions } from '@/components/csmju/profile-suggestions';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import type { Channel, SearchHit } from '@/lib/csmju/types';

/// กล่อง "ข้อความใหม่" แบบ Instagram — เลือกได้หลายคน แล้วกด "แชท" / "สร้างแชทกลุ่ม"
///
/// ใช้ทั้งหน้า /messages (เป็นกล่องลอย `ComposeDialog`) และแผงข้อความลอย
/// (สลับแผงเป็นหน้า "ข้อความใหม่" ในที่ด้วย `ComposePanel`) — ตัวเดียวกันทุกบรรทัด
///
///   ถึง: [ชิป ×] [ช่องค้นหา]      ← Backspace ในช่องว่างลบชิปตัวท้าย
///   แนะนำ / ผลค้นหา  ○ ●            ← กดแถวเพื่อเลือก/เลิกเลือก
///   [ชื่อกลุ่ม] (เมื่อเลือก ≥ 2 คน)
///   [ แชท | สร้างแชทกลุ่ม ]
///
/// คนที่แนะนำมาจากข้อมูลจริงทั้งหมด: คนที่เคยคุยด้วย → คนที่เราติดตาม →
/// `/follows/suggestions` · ผลค้นหามาจาก `/search?kind=people` ซึ่งหาได้เฉพาะคน
/// ที่เคยปรากฏในระบบนี้ (Core Hub ยังไม่เปิด endpoint ค้นคนให้ระบบย่อย)

/// หลังบ้านรับได้ 31 คน (รวมเราเป็น 32 = เพดานของแชทกลุ่ม)
export const MAX_PEERS = 31;

export function ComposeDialog({
  open,
  recent = [],
  onClose,
  onStarted,
}: {
  open: boolean;
  /// คนที่เคยคุยด้วยล่าสุด (จากรายการห้อง) — ขึ้นเป็นคำแนะนำอันดับแรก
  recent?: string[];
  onClose: () => void;
  onStarted: (channel: Channel) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[548px]" showCloseButton={false}>
        {/* ถอดเนื้อในออกตอนปิด (DialogContent ทำให้) — เปิดใหม่ได้กล่องว่าง */}
        <div className="flex h-[min(640px,calc(100dvh-2rem))] flex-col">
          <ComposePanel recent={recent} onBack={onClose} onClose={onClose} onStarted={onStarted} inDialog />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/// หน้า "ข้อความใหม่" — ใส่ในกล่องลอยหรือในแผงข้อความลอยก็ได้ (เต็มความสูงของกรอบแม่)
export function ComposePanel({
  recent = [],
  onBack,
  onClose,
  onStarted,
  inDialog = false,
}: {
  recent?: string[];
  /// ← กลับ (แผงลอย: กลับไปรายการแชท)
  onBack?: () => void;
  onClose: () => void;
  onStarted: (channel: Channel) => void;
  /// อยู่ใน Dialog — หัวข้อต้องเป็น DialogTitle ให้โปรแกรมอ่านหน้าจอประกาศชื่อกล่อง
  inDialog?: boolean;
}) {
  const me = useMe();
  const id = useId();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const following = useMyFollowing();
  const suggestions = useSuggestions(me.id);

  // โฟกัสช่อง "ถึง:" เอง ไม่ใช้ autoFocus — effect ของลูกทำงานก่อนของแม่
  // แล้ว showModal() ของกล่องจะแย่งโฟกัสไปที่ปุ่ม X จึงรอให้เฟรมนั้นจบก่อน
  useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);

  /// ผลค้นหา **พร้อมคำค้นที่ใช้หามัน** — รู้ได้ว่าผลชุดนี้ตรงกับที่พิมพ์อยู่
  /// หรือยัง จึงคำนวณ "กำลังค้นหา" จาก state ที่มีได้ ไม่ต้อง setState ในตัว
  /// effect (กฎ react-hooks ของ React Compiler ห้าม เพราะวาดซ้ำรอบพิเศษ)
  const [results, setResults] = useState<{ term: string; items: string[] } | null>(null);

  const term = q.trim();
  const longEnough = term.length >= 2;

  useEffect(() => {
    if (!longEnough) return;

    // หน่วงก่อนยิง ไม่งั้นพิมพ์ชื่อหนึ่งชื่อ = ยิงหลังบ้านทุกตัวอักษร
    const timer = setTimeout(() => {
      void api
        .list<SearchHit>(`/search${qs({ q: term, kind: 'people', limit: 20 })}`)
        .then((page) => {
          setError(null);
          setResults({
            term,
            // ตัดตัวเองออก — คุยกับตัวเองไม่ได้ และหลังบ้านก็ปฏิเสธอยู่แล้ว
            items: page.items.map((hit) => hit.id).filter((hit) => hit !== me.id),
          });
        })
        .catch(() => {
          setError('ค้นหาไม่สำเร็จ');
          setResults({ term, items: [] });
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [longEnough, term, me.id]);

  const suggested = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const person of [
      ...recent,
      ...(following.data ? [...following.data] : []),
      ...suggestions.people.map((row) => row.coreUserId),
    ]) {
      if (person !== me.id && !seen.has(person)) {
        seen.add(person);
        out.push(person);
      }
    }

    return out.slice(0, 30);
  }, [recent, following.data, suggestions.people, me.id]);

  const fresh = results?.term === term;
  const searching = longEnough && !fresh;
  const people = longEnough ? (fresh ? results.items : []) : suggested;
  const loadingSuggestions = !longEnough && people.length === 0 && (following.isPending || suggestions.isPending);

  function toggle(person: string) {
    setError(null);

    if (!picked.includes(person) && picked.length >= MAX_PEERS) {
      setError(`เลือกได้สูงสุด ${MAX_PEERS} คนต่อแชทกลุ่ม`);

      return;
    }

    // ใช้ updater — กดสองคนติดกันเร็ว ๆ ก่อนหน้าจอวาดใหม่ ต้องได้ทั้งสองคน
    // ไม่ใช่คนหลังทับคนแรก (ค่าจาก closure ยังเป็นของรอบวาดก่อน)
    setPicked((current) =>
      current.includes(person)
        ? current.filter((row) => row !== person)
        : [...current, person],
    );
  }

  const group = picked.length >= 2;

  async function start() {
    if (picked.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      // คนเดียว = หาห้องเดิมก่อนสร้างใหม่ (กดซ้ำไม่ได้ห้องซ้ำ) · สองคนขึ้นไป = กลุ่มใหม่เสมอ
      const channel = await api.post<Channel>(
        '/direct-channels',
        group
          ? {
              peerCoreUserIds: picked,
              ...(groupName.trim() ? { name: groupName.trim() } : {}),
            }
          : { peerCoreUserId: picked[0] },
      );

      onStarted(channel);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เริ่มแชทไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-150">
      <div className="relative flex h-[51px] shrink-0 items-center justify-center border-b border-border">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="กลับ"
            className="absolute left-2 grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
          >
            <ArrowLeft className="size-6" strokeWidth={1.9} />
          </button>
        )}
        {inDialog ? (
          <DialogTitle className="text-base font-bold">ข้อความใหม่</DialogTitle>
        ) : (
          <h2 className="text-base font-bold">ข้อความใหม่</h2>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="absolute right-2 grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
        >
          <X className="size-6" strokeWidth={1.9} />
        </button>
      </div>

      {inDialog ? (
        <DialogDescription className="sr-only">
          ค้นหาและเลือกคนที่ต้องการคุยด้วย เลือกสองคนขึ้นไปเพื่อสร้างแชทกลุ่ม
        </DialogDescription>
      ) : (
        <p className="sr-only">ค้นหาและเลือกคนที่ต้องการคุยด้วย เลือกสองคนขึ้นไปเพื่อสร้างแชทกลุ่ม</p>
      )}

      <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-2">
        <label htmlFor={`${id}-to`} className="pt-1 text-base font-semibold">
          ถึง:
        </label>
        {/* ชิปขึ้นหลายบรรทัดได้ และเลื่อนในตัวเมื่อเลือกหลายคน ไม่ดันรายการหายจากจอ */}
        <div className="flex max-h-24 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto">
          {picked.map((person) => (
            <Chip key={person} coreUserId={person} onRemove={() => toggle(person)} />
          ))}
          <input
            id={`${id}-to`}
            ref={searchRef}
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              // Backspace ในช่องว่าง = ลบชิปตัวท้าย แบบช่อง "ถึง:" ของอีเมลและ IG
              if (event.key === 'Backspace' && q === '' && picked.length > 0) {
                setPicked((current) => current.slice(0, -1));
              }
            }}
            placeholder="ค้นหา…"
            autoComplete="off"
            aria-label="ค้นหาคน"
            className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {!longEnough && people.length > 0 && (
          <p className="px-6 pb-1 pt-2 text-sm font-semibold">แนะนำ</p>
        )}

        {error && <p role="alert" className="px-6 py-3 text-sm text-destructive">{error}</p>}

        {(searching || loadingSuggestions) && (
          <p className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {searching ? 'กำลังค้นหา…' : 'กำลังโหลด…'}
          </p>
        )}

        {!searching && !loadingSuggestions && people.length === 0 && (
          <p className="px-6 py-4 text-sm leading-6 text-muted-foreground">
            {longEnough
              ? 'ไม่พบบัญชี — ค้นได้เฉพาะคนที่เคยใช้งานระบบนี้แล้ว'
              : 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหาคน'}
          </p>
        )}

        <ul aria-label={longEnough ? 'ผลการค้นหา' : 'แนะนำ'}>
          {people.map((person) => (
            <li key={person}>
              <PersonRow
                coreUserId={person}
                selected={picked.includes(person)}
                onToggle={() => toggle(person)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0 space-y-2 px-4 pb-4 pt-2">
        {group && (
          <div>
            <label htmlFor={`${id}-name`} className="sr-only">
              ชื่อกลุ่ม
            </label>
            <input
              id={`${id}-name`}
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              maxLength={80}
              placeholder="ชื่อกลุ่ม (ไม่บังคับ)"
              className="h-10 w-full rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => void start()}
          disabled={picked.length === 0 || busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {group ? 'สร้างแชทกลุ่ม' : 'แชท'}
        </button>
      </div>
    </div>
  );
}

function Chip({ coreUserId, onRemove }: { coreUserId: string; onRemove: () => void }) {
  const profile = useProfile(coreUserId);

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-link/15 py-0.5 pl-3 pr-1 text-sm font-semibold text-link animate-in fade-in-0 zoom-in-95 duration-100">
      {profile.displayName}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`เอา ${profile.displayName} ออก`}
        className="grid size-5 place-items-center rounded-full hover:bg-link/20"
      >
        <X aria-hidden className="size-3.5" strokeWidth={2.6} />
      </button>
    </span>
  );
}

function PersonRow({
  coreUserId,
  selected,
  onToggle,
}: {
  coreUserId: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const profile = useProfile(coreUserId);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 px-6 py-2 text-left transition-colors hover:bg-accent"
    >
      {/* พื้นกล่องเป็นสีเดียวกับวงกลมตัวอักษรย่อของคนที่ไม่มีรูป — เปลี่ยนพื้น
          ของวงกลมเป็นสีหน้า ไม่งั้นเห็นแค่ตัว "S" ลอยอยู่ */}
      <span className="inline-flex shrink-0 rounded-full [&_[data-slot=avatar]>span]:bg-background [&_[data-slot=avatar]]:bg-background">
        <Avatar coreUserId={coreUserId} size={44} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{profile.displayName}</span>
        <span className="block truncate text-sm text-muted-foreground">{coreUserId}</span>
      </span>

      <span
        aria-hidden
        className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${
          selected ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground'
        }`}
      >
        {selected && <Check className="size-4" strokeWidth={3} />}
      </span>
    </button>
  );
}
