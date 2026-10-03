'use client';

import { Loader2 } from 'lucide-react';
import { useProfileData } from '@/components/csmju/profile-data';
import { ProfileSettingsForm } from '@/components/csmju/profile-settings-form';
import { ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { usePrivacy } from './privacy-sections';
import { SettingsHeading } from './settings-shell';

/// หน้า "แก้ไขโปรไฟล์" — อ่านแคชเดียวกับหน้าโปรไฟล์ของตัวเอง
///
/// วาดฟอร์มหลังได้ข้อมูลแล้วเท่านั้น เพราะฟอร์มจำค่าตั้งต้นของช่องคำแนะนำตัว
/// ตั้งแต่ครั้งแรกที่วาด — วาดก่อนข้อมูลมา ช่องจะว่างทั้งที่มีคำแนะนำตัวอยู่
export function EditProfileSection() {
  const me = useMe();
  const { data, error } = useProfileData(me.id, true);
  const privacy = usePrivacy();

  return (
    <>
      <SettingsHeading>แก้ไขโปรไฟล์</SettingsHeading>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-csmju-label text-destructive">
          {error instanceof ApiError ? error.message : 'โหลดโปรไฟล์ไม่สำเร็จ'}
        </p>
      ) : data?.mine ? (
        <ProfileSettingsForm
          key={data.mine.coreUserId}
          profile={data.mine}
          suggestions={
            privacy.data
              ? {
                  value: privacy.data.showInSuggestions,
                  save: async (next) => privacy.saveAsync({ showInSuggestions: next }),
                }
              : undefined
          }
        />
      ) : (
        <p className="flex items-center gap-2 text-csmju-label text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          กำลังโหลด…
        </p>
      )}
    </>
  );
}
