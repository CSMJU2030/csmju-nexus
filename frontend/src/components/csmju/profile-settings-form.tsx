'use client';

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Loader2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar } from '@/components/csmju/user-name';
import { profileKey, type ProfileData } from '@/components/csmju/profile-data';
import { useCharacterLimit } from '@/components/ui/dialog-utils/use-character-limit';
import { useImageUpload } from '@/components/ui/dialog-utils/use-image-upload';
import { api } from '@/lib/csmju/api';
import { uploadFile } from '@/lib/csmju/upload';
import type { MyProfile } from '@/lib/csmju/types';

/// ฟอร์ม "แก้ไขโปรไฟล์" — ตามหน้า Edit profile ของ Instagram บนเว็บ
///
///   บัตรตัวตน (รูป · ชื่อผู้ใช้ · ปุ่ม "เปลี่ยนรูปภาพ") → เว็บไซต์ → แนะนำตัว n/300
///   → รูปปก → "แสดงการแนะนำบัญชีบนโปรไฟล์" → ปุ่ม "ส่ง"
///
/// **แก้ได้เฉพาะของที่เป็นของระบบย่อยนี้** — รูปโปรไฟล์ ชื่อที่แสดง และชื่อผู้ใช้
/// เป็นตัวตนของบัญชีกลาง (Blueprint หน้า 10) ระบบย่อยห้ามเก็บ ปุ่ม "เปลี่ยนรูปภาพ"
/// จึงพาไปจัดการที่บัญชีกลาง ไม่มีช่องอัปโหลดรูปโปรไฟล์ที่นี่
///
/// ไม่มี "เพศ" · ป้าย Threads · สวิตช์โปรไฟล์ AI ของ Instagram เพราะระบบนี้ไม่มี

/// เพดานต้องตรงกับ `@Length(0, 300)` ของ `UpdateMyProfileDto.bio`
/// ถ้าไม่ตรง ผู้ใช้จะกดบันทึกแล้วได้ 400 ทั้งที่ตัวนับยังบอกว่าเหลือที่
export const BIO_MAX = 300;

/// ความยาวสูงสุดของลิงก์เว็บไซต์ — เผื่อ query string ยาว ๆ แต่ไม่ใช่เรียงความ
export const WEBSITE_MAX = 200;

/// ชื่อไทยของ field ที่ Core เป็นเจ้าของ — ตัวที่ไม่รู้จักแสดงชื่อดิบไปเลย
/// ดีกว่าซ่อน เพราะผู้ใช้ควรรู้ว่ามีอะไรที่แก้ที่นี่ไม่ได้
const CORE_FIELD_LABELS: Record<string, string> = {
  displayName: 'ชื่อที่แสดง',
  avatarUrl: 'รูปโปรไฟล์',
  faculty: 'คณะ',
  coreRole: 'สิทธิ์ระดับองค์กร',
};

/// ศูนย์กลาง CSMJU2030 — ที่เดียวกับที่ผู้ใช้ล็อกอินมา
export const CORE_HOME = (() => {
  try {
    // NEXT_PUBLIC_CORE_LOGIN_URL เป็นชื่อเดิมของ SSO 1.0 — อ่านไว้เผื่อเครื่องที่ยังไม่ได้ตั้งค่าใหม่
    return new URL(
      process.env.NEXT_PUBLIC_CORE_HUB_WEB_URL ?? process.env.NEXT_PUBLIC_CORE_LOGIN_URL ?? '',
    ).origin;
  } catch {
    return null;
  }
})();

/// ตรวจและจัดรูปลิงก์เว็บไซต์ — ว่าง = ลบ (null) · ไม่มี scheme เติม https:// ให้
/// แบบที่ Instagram รับ "example.com" ได้ · รับเฉพาะ http/https เพื่อไม่ให้
/// ลิงก์ `javascript:` ไปโผล่บนโปรไฟล์ให้คนอื่นกด
export function normalizeWebsite(raw: string): { value: string | null; error: string | null } {
  const text = raw.trim();

  if (!text) return { value: null, error: null };
  if ([...text].length > WEBSITE_MAX) return { value: null, error: `ลิงก์ยาวได้ไม่เกิน ${WEBSITE_MAX} ตัวอักษร` };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(withScheme);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { value: null, error: 'ใช้ได้เฉพาะลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://' };
    }

    if (!url.hostname.includes('.')) return { value: null, error: 'ลิงก์ไม่ถูกต้อง เช่น example.com' };

    return { value: url.toString(), error: null };
  } catch {
    return { value: null, error: 'ลิงก์ไม่ถูกต้อง เช่น example.com' };
  }
}

type WithWebsite = MyProfile & { website?: string | null };

export function ProfileSettingsForm({
  profile,
  suggestions,
}: {
  profile: WithWebsite;
  /// สวิตช์ "แสดงการแนะนำบัญชีบนโปรไฟล์" อยู่ใน `/me/privacy` ไม่ใช่ในโปรไฟล์
  /// — undefined = ยังโหลดไม่เสร็จหรือหลังบ้านยังไม่มี จึงยังไม่วาดสวิตช์
  suggestions?: { value: boolean; save: (next: boolean) => Promise<void> };
}) {
  const id = useId();
  const queryClient = useQueryClient();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoDialog, setPhotoDialog] = useState(false);
  /// ผู้ใช้กด X บนรูปปกเดิม — ส่ง `coverAssetId: null` ตอนบันทึก
  const [removeCover, setRemoveCover] = useState(false);
  /// ค่าที่บันทึกล่าสุด — ใช้ตัดสินว่า "มีอะไรเปลี่ยนไหม" หลังส่งไปแล้วรอบหนึ่ง
  const [savedBio, setSavedBio] = useState(profile.bio ?? '');
  const [savedWebsite, setSavedWebsite] = useState(profile.website ?? '');
  const [website, setWebsite] = useState(profile.website ?? '');
  const [suggest, setSuggest] = useState<boolean | null>(null);

  const bio = useCharacterLimit({ maxLength: BIO_MAX, initialValue: profile.bio ?? '' });
  const cover = useImageUpload();
  const { previewUrl, fileInputRef, handleThumbnailClick, handleFileChange, handleRemove } = cover;

  const currentCover = previewUrl ?? (removeCover ? null : profile.coverUrl);
  const websiteCheck = normalizeWebsite(website);
  const suggestValue = suggest ?? suggestions?.value ?? false;
  const suggestChanged = suggestions !== undefined && suggest !== null && suggest !== suggestions.value;
  const dirty =
    bio.value !== savedBio ||
    website.trim() !== savedWebsite.trim() ||
    cover.file !== null ||
    removeCover ||
    suggestChanged;

  function touch() {
    setSaved(false);
  }

  async function save() {
    if (websiteCheck.error) return;

    setBusy('กำลังส่ง…');
    setError(null);
    setSaved(false);

    try {
      let coverAssetId: string | null | undefined;

      if (cover.file) {
        const asset = await uploadFile(cover.file, 'attachments', setBusy);

        coverAssetId = asset.assetId;
      } else if (removeCover) {
        coverAssetId = null;
      }

      setBusy('กำลังส่ง…');

      const websiteChanged = website.trim() !== savedWebsite.trim();
      const next = await api.patch<WithWebsite>('/profiles/me', {
        bio: bio.value,
        ...(websiteChanged ? { website: websiteCheck.value } : {}),
        ...(coverAssetId !== undefined ? { coverAssetId: coverAssetId } : {}),
      });

      if (suggestChanged && suggestions) await suggestions.save(suggestValue);

      // หน้าโปรไฟล์อ่านแคชนี้ — กลับไปแล้วต้องเห็นของใหม่ทันที
      queryClient.setQueryData<ProfileData>(profileKey(next.coreUserId), { profile: next, mine: next });

      setSavedBio(next.bio ?? '');
      setSavedWebsite(next.website ?? '');
      setWebsite(next.website ?? '');
      setSuggest(null);
      setRemoveCover(false);
      handleRemove();
      setSaved(true);
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น "รูปปกต้องเป็นไฟล์รูปภาพ"
      setError(caught instanceof Error ? caught.message : 'ส่งไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  const locked = profile.managedByCore.map((field) => CORE_FIELD_LABELS[field] ?? field);

  return (
    <>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !busy && !websiteCheck.error) void save();
      }}
    >
      {/* ─── บัตรตัวตน ─── */}
      <div className="flex items-center gap-4 rounded-[20px] bg-muted p-4">
        {/* ตัวอักษรสำรองของรูปใช้สีเดียวกับการ์ด — เปลี่ยนพื้นให้วงกลมยังมองเห็น */}
        <span className="shrink-0 [&_[data-slot=avatar]>span]:!bg-background">
          <Avatar coreUserId={profile.coreUserId} size={56} showOnline={false} />
        </span>

        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-base font-bold">{profile.coreUserId}</p>
          <p className="truncate text-csmju-label text-muted-foreground">{profile.displayName}</p>
        </div>

        <button
          type="button"
          onClick={() => setPhotoDialog(true)}
          aria-haspopup="dialog"
          className="h-8 shrink-0 rounded-lg bg-primary px-4 text-csmju-label font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          เปลี่ยนรูปภาพ
        </button>
      </div>

      {/* ─── เว็บไซต์ ─── */}
      <label htmlFor={`${id}-website`} className="mt-8 block text-base font-bold">
        เว็บไซต์
      </label>
      <input
        id={`${id}-website`}
        type="text"
        inputMode="url"
        autoComplete="url"
        value={website}
        onChange={(event) => {
          touch();
          setWebsite(event.target.value);
        }}
        placeholder="เว็บไซต์"
        aria-invalid={Boolean(websiteCheck.error)}
        aria-describedby={`${id}-website-help`}
        className={`mt-3 h-12 w-full rounded-xl border bg-background px-4 text-csmju-label outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40 ${
          websiteCheck.error ? 'border-destructive' : 'border-border'
        }`}
      />
      <p
        id={`${id}-website-help`}
        className={`mt-2 text-csmju-caption ${websiteCheck.error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {websiteCheck.error ?? 'ลิงก์นี้จะแสดงใต้คำแนะนำตัวบนโปรไฟล์ของคุณ'}
      </p>

      {/* ─── แนะนำตัว ─── */}
      <label htmlFor={`${id}-bio`} className="mt-8 block text-base font-bold">
        แนะนำตัว
      </label>
      <div className="relative mt-3">
        <textarea
          id={`${id}-bio`}
          value={bio.value}
          onChange={(event) => {
            touch();
            bio.handleChange(event);
          }}
          rows={3}
          placeholder="แนะนำตัว"
          aria-describedby={`${id}-bio-count`}
          className="block min-h-[88px] w-full resize-none rounded-xl border border-border bg-background px-4 pb-8 pt-3 text-csmju-label outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
        />
        <span
          id={`${id}-bio-count`}
          className="pointer-events-none absolute bottom-2.5 right-4 text-csmju-caption tabular-nums text-muted-foreground"
        >
          {bio.characterCount} / {BIO_MAX}
        </span>
      </div>

      {/* ─── รูปปก (ของระบบย่อยนี้ ไม่ใช่ของ Instagram) ─── */}
      <p className="mt-8 text-base font-bold">รูปปก</p>
      <input
        type="file"
        ref={fileInputRef}
        onChange={(event) => {
          touch();
          setRemoveCover(false);
          handleFileChange(event);
        }}
        className="hidden"
        accept="image/png,image/jpeg,image/webp"
        aria-label="เลือกไฟล์รูปปก"
      />
      {currentCover ? (
        <div className="relative mt-3 h-32 overflow-hidden rounded-[20px] bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentCover}
            alt={previewUrl ? 'รูปปกที่เลือกไว้ (ยังไม่ส่ง)' : 'รูปปกปัจจุบัน'}
            className="size-full object-cover"
          />
          <div className="absolute right-2 top-2 flex gap-2">
            <button
              type="button"
              onClick={handleThumbnailClick}
              aria-label="เปลี่ยนรูปปก"
              className="grid size-8 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            >
              <ImagePlus aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                touch();
                if (previewUrl) handleRemove();
                else setRemoveCover(true);
              }}
              aria-label="เอารูปปกออก"
              className="grid size-8 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleThumbnailClick}
          className="mt-3 flex h-20 w-full items-center justify-center gap-2 rounded-[20px] border border-dashed border-border text-csmju-label text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ImagePlus aria-hidden strokeWidth={1.9} className="size-5" />
          เพิ่มรูปปกบนหน้าโปรไฟล์ของคุณ
        </button>
      )}

      {/* ─── แสดงการแนะนำบัญชี ─── */}
      {suggestions && (
        <>
          <p className="mt-8 text-base font-bold">แสดงการแนะนำบัญชีบนโปรไฟล์</p>
          <div className="mt-3 flex items-start gap-4 rounded-[20px] border border-border p-4">
            <div className="min-w-0 flex-1">
              <p className="text-csmju-label">แสดงการแนะนำบัญชีบนโปรไฟล์</p>
              <p className="mt-1 text-csmju-caption leading-snug text-muted-foreground">
                เลือกว่าจะให้ผู้คนเห็นคำแนะนำบัญชีที่คล้ายกันบนโปรไฟล์ของคุณ และบัญชีของคุณจะแสดงในคำแนะนำบนโปรไฟล์อื่นๆ ได้หรือไม่
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={suggestValue}
              aria-label="แสดงการแนะนำบัญชีบนโปรไฟล์"
              onClick={() => {
                touch();
                setSuggest(!suggestValue);
              }}
              className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                suggestValue ? 'bg-foreground' : 'bg-muted-foreground/40'
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-[left] ${
                  suggestValue ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </>
      )}

      <p className="mt-8 text-csmju-caption text-muted-foreground">
        {locked.length > 0 && <>ระบบกลางเป็นเจ้าของ: {locked.join(' · ')} — แก้ที่บัญชีกลางแล้วระบบนี้จะซิงก์ตามภายใน 6 ชั่วโมง </>}
        {CORE_HOME && (
          <a
            href={CORE_HOME}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-link hover:underline"
          >
            ไปที่บัญชีกลาง
            <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive">
          {error}
        </p>
      )}

      <div className="mt-8 flex items-center justify-end gap-4">
        <span role="status" className="text-csmju-label text-muted-foreground">
          {saved && !dirty ? 'บันทึกแล้ว' : ''}
        </span>

        <button
          type="submit"
          disabled={!dirty || busy !== null || Boolean(websiteCheck.error)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-csmju-label font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 sm:w-[250px]"
        >
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {busy ?? 'ส่ง'}
        </button>
      </div>
    </form>

    {/* นอก <form> — กล่องนี้ไม่ได้ส่งข้อมูลอะไร และไม่ควรถูก Enter ของฟอร์มกดโดยบังเอิญ */}
    {photoDialog && <ChangePhotoDialog onClose={() => setPhotoDialog(false)} />}
    </>
  );
}

/// กล่อง "เปลี่ยนรูปโปรไฟล์" แบบ Instagram — แต่รูปโปรไฟล์เป็นตัวตนของบัญชีกลาง
/// ระบบย่อยนี้เก็บเองไม่ได้ จึงมีทางเดียวคือไปจัดการที่บัญชีกลาง
export function ChangePhotoDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
        <div className="px-6 pb-5 pt-7 text-center">
          <DialogTitle className="text-xl font-semibold">เปลี่ยนรูปโปรไฟล์</DialogTitle>
          <DialogDescription className="mt-2">
            รูปโปรไฟล์เป็นของบัญชีกลาง CSMJU2030 และใช้ร่วมกันทุกระบบ — เปลี่ยนที่นั่นแล้วระบบนี้จะแสดงรูปใหม่เอง
          </DialogDescription>
        </div>
        {CORE_HOME && (
          <a
            href={CORE_HOME}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
            className="flex min-h-12 w-full items-center justify-center border-t border-border px-4 text-center text-csmju-label font-bold text-link hover:bg-accent"
          >
            จัดการรูปโปรไฟล์ที่บัญชีกลาง CSMJU2030
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label hover:bg-accent"
        >
          ยกเลิก
        </button>
      </DialogContent>
    </Dialog>
  );
}
