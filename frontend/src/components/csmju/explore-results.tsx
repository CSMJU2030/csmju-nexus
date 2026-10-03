'use client';

import Link from 'next/link';
import { Hash, MessageCircle, SearchX } from 'lucide-react';
import { ExploreGrid, ExploreTileById } from '@/components/csmju/explore-grid';
import { FollowButton } from '@/components/csmju/reel-follow-button';
import { Avatar, useProfile } from '@/components/csmju/user-name';
import { igAgo } from '@/lib/csmju/time';
import type { SearchAll, SearchHit } from '@/lib/csmju/types';
import { cn } from '@/lib/utils';

/// ผลค้นหาแบบ Instagram — แถวคนก่อน แล้วตามด้วยกระทู้ คลิป และข้อความแชท
///
/// **ข้อความแชทค้นได้เฉพาะห้องที่ผู้เรียกเป็นสมาชิก** หลังบ้านบังคับไว้
/// ถ้าไม่บังคับ ช่องนี้จะกลายเป็นช่องอ่านแชทส่วนตัวของคนอื่นด้วยการเดาคำ
///
/// โหมด `all` ไม่แบ่งหน้าโดยตั้งใจ — การเรียงผลจากสี่ตารางที่คนละหน่วยวัด
/// ต้องมีคะแนนความเกี่ยวข้องซึ่งเราไม่มี หลังบ้านจึงคืนตัวอย่าง 5 รายการต่อหมวด
/// พร้อมยอดรวม แล้วให้กดแท็บหมวด (หรือ "ดูทั้งหมด") เพื่อดูทั้งหมด

export const SEARCH_KINDS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'people', label: 'คน' },
  { value: 'posts', label: 'กระทู้' },
  { value: 'reels', label: 'คลิป' },
  { value: 'messages', label: 'ข้อความแชท' },
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number]['value'];
type SectionKind = Exclude<SearchKind, 'all'>;

/// ชนิดใน payload (`PERSON`) → ชื่อหมวดใน query (`people`)
const SECTION_OF: Record<string, SectionKind> = {
  PERSON: 'people',
  POST: 'posts',
  REEL: 'reels',
  MESSAGE: 'messages',
};

const SECTION_ORDER: SectionKind[] = ['people', 'posts', 'reels', 'messages'];

export interface SearchResult {
  /// มีเฉพาะโหมด all
  counts: SearchAll['counts'] | null;
  hits: SearchHit[];
  /// ยอดรวมของหมวดเดียว (โหมดไม่ใช่ all)
  total: number;
}

export function SearchKindTabs({
  kind,
  counts,
  onKind,
}: {
  kind: SearchKind;
  counts: SearchAll['counts'] | null;
  onKind: (kind: SearchKind) => void;
}) {
  return (
    <div role="tablist" aria-label="หมวดผลค้นหา" className="flex gap-2 overflow-x-auto scrollbar-none">
      {SEARCH_KINDS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={kind === option.value}
          onClick={() => onKind(option.value)}
          className={cn(
            'shrink-0 rounded-lg px-4 py-1.5 text-csmju-label font-semibold transition-colors',
            kind === option.value
              ? 'bg-foreground text-background'
              : 'bg-muted text-foreground hover:bg-accent',
          )}
        >
          {option.label}
          {counts && option.value !== 'all' && (
            <span className="ml-1.5 font-normal tabular-nums opacity-70">
              {counts[option.value]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ExploreResults({
  result,
  kind,
  onKind,
  onPick,
}: {
  result: SearchResult;
  kind: SearchKind;
  onKind: (kind: SearchKind) => void;
  /// กดเปิดผลลัพธ์จริง — หน้าค้นหาใช้บันทึก "ค้นหาล่าสุด"
  onPick?: (hit: SearchHit) => void;
}) {
  const groups = new Map<SectionKind, SearchHit[]>();

  for (const hit of result.hits) {
    const section = SECTION_OF[hit.kind];

    if (!section) continue;

    groups.set(section, [...(groups.get(section) ?? []), hit]);
  }

  if (result.hits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <SearchX className="size-12 text-muted-foreground" strokeWidth={1.3} aria-hidden />
        <p className="text-csmju-title">ไม่พบผลลัพธ์</p>
        <p className="text-csmju-label text-muted-foreground">ลองคำค้นอื่น หรือเลือกหมวดอื่น</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {SECTION_ORDER.filter((section) => groups.has(section)).map((section) => {
        const hits = groups.get(section) ?? [];
        const total =
          kind === 'all' ? (result.counts?.[section] ?? hits.length) : result.total;

        return (
          <section key={section} aria-labelledby={`search-${section}`}>
            <header className="mb-2 flex items-baseline justify-between px-4 sm:px-0">
              <h2 id={`search-${section}`} className="text-csmju-body font-semibold">
                {SEARCH_KINDS.find((option) => option.value === section)?.label}
                <span className="ml-2 text-csmju-label font-normal tabular-nums text-muted-foreground">
                  {total}
                </span>
              </h2>
              {kind === 'all' && total > hits.length && (
                <button
                  type="button"
                  onClick={() => onKind(section)}
                  className="text-csmju-label font-semibold text-link hover:opacity-70"
                >
                  ดูทั้งหมด
                </button>
              )}
            </header>

            {section === 'reels' ? (
              <ExploreGrid>
                {hits.map((hit) => (
                  <ExploreTileById key={hit.id} reelId={hit.id} onOpen={() => onPick?.(hit)} />
                ))}
              </ExploreGrid>
            ) : (
              <ul>
                {hits.map((hit) =>
                  section === 'people' ? (
                    <PersonRow key={hit.id} hit={hit} onPick={onPick} />
                  ) : (
                    <TextRow key={`${hit.kind}-${hit.id}`} hit={hit} onPick={onPick} />
                  ),
                )}
              </ul>
            )}

            {kind !== 'all' && hits.length < result.total && (
              <p className="mt-3 px-4 text-center text-csmju-caption text-muted-foreground sm:px-0">
                แสดง {hits.length} จาก {result.total} รายการ
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PersonRow({ hit, onPick }: { hit: SearchHit; onPick?: (hit: SearchHit) => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-4 py-2 transition-colors hover:bg-accent sm:px-2">
      <Link
        href={`/profile/${encodeURIComponent(hit.id)}`}
        onClick={() => onPick?.(hit)}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Avatar coreUserId={hit.id} size={44} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-csmju-label font-semibold">{hit.title}</span>
          <span className="block truncate text-csmju-label text-muted-foreground">
            {hit.snippet ?? hit.id}
          </span>
        </span>
      </Link>
      <FollowButton coreUserId={hit.id} />
    </li>
  );
}

/// แถวกระทู้/ข้อความแชท — ไอคอนหมวดในกรอบ + ชื่อ + ข้อความรอบคำค้น + ใคร·เมื่อไร
function TextRow({ hit, onPick }: { hit: SearchHit; onPick?: (hit: SearchHit) => void }) {
  const isMessage = hit.kind === 'MESSAGE';
  // กระทู้เปิดหน้าโพสต์ของมันเอง (/p/:id) · ข้อความพาไปห้องที่ถูกต้อง
  const href =
    isMessage && hit.channelId
      ? `/chat?channel=${encodeURIComponent(hit.channelId)}`
      : isMessage
        ? '/chat'
        : `/p/${encodeURIComponent(hit.id)}`;
  const Icon = isMessage ? MessageCircle : Hash;

  return (
    <li>
      <Link
        href={href}
        onClick={() => onPick?.(hit)}
        className="flex items-start gap-3 rounded-lg px-4 py-2.5 transition-colors hover:bg-accent sm:px-2"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-full border border-border">
          <Icon className="size-5" strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-csmju-label font-semibold">{hit.title}</span>
          {hit.snippet && (
            <span className="mt-0.5 line-clamp-2 block text-csmju-label text-muted-foreground">
              {hit.snippet}
            </span>
          )}
          <span className="mt-1 block truncate text-csmju-caption text-muted-foreground">
            {hit.authorCoreUserId && <AuthorLabel coreUserId={hit.authorCoreUserId} />}
            {hit.authorCoreUserId && hit.createdAt && ' · '}
            {hit.createdAt && igAgo(hit.createdAt)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function AuthorLabel({ coreUserId }: { coreUserId: string }) {
  return <>{useProfile(coreUserId).displayName}</>;
}
