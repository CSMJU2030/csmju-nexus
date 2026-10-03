'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/csmju/api';
import { SettingsHeading } from './settings-shell';
import type { AudienceCounts, CommentsFrom, PrivacySettings } from './settings-types';
import {
  ChoiceSection,
  errorText,
  SettingsError,
  SettingsLoading,
  SwitchRow,
  useSettings,
} from './settings-ui';

/// ความคิดเห็น · สถานะกิจกรรม — สองหน้าที่อ่านก้อนเดียวกัน (`/me/privacy`)
///
/// ใช้คีย์แคชเดียวกันทั้งสองหน้าและฟอร์มแก้ไขโปรไฟล์ (สวิตช์ "แสดงการแนะนำบัญชี")
/// สลับหน้าไปมาแล้วต้องเห็นค่าเดียวกันเสมอ

export const PRIVACY_KEY = ['privacy'] as const;

export function usePrivacy() {
  return useSettings<PrivacySettings>(PRIVACY_KEY, '/me/privacy');
}

const count = (n: number | undefined) => (n === undefined ? '…' : n.toLocaleString('th-TH'));

export function CommentsSection() {
  const privacy = usePrivacy();
  const counts = useQuery({
    queryKey: ['audience-counts'],
    queryFn: () => api.get<AudienceCounts>('/me/audience-counts'),
  });
  const c = counts.data;

  const options: { value: CommentsFrom; label: string }[] = [
    { value: 'EVERYONE', label: 'ทุกคน' },
    { value: 'FOLLOWING', label: `คนที่คุณติดตาม · ${count(c?.following)} คน` },
    { value: 'FOLLOWERS', label: `ผู้ติดตามของคุณ · ${count(c?.followers)} คน` },
    { value: 'MUTUAL', label: `คนที่คุณติดตามและผู้ติดตามของคุณ · ${count(c?.mutual)} คน` },
    { value: 'OFF', label: 'ปิด' },
  ];

  return (
    <>
      <SettingsHeading>ความคิดเห็น</SettingsHeading>

      {privacy.loadError ? (
        <SettingsError>{errorText(privacy.loadError, 'โหลดการตั้งค่าไม่สำเร็จ')}</SettingsError>
      ) : !privacy.data ? (
        <SettingsLoading />
      ) : (
        <>
          {privacy.saveError && <SettingsError>{errorText(privacy.saveError, 'บันทึกไม่สำเร็จ — ค่าถูกย้อนกลับแล้ว')}</SettingsError>}
          <ChoiceSection
            title="อนุญาตความคิดเห็นจาก"
            value={privacy.data.commentsFrom}
            options={options}
            onChange={(commentsFrom) => privacy.save({ commentsFrom })}
            example="ใช้กับคลิปและกระทู้ของคุณทุกชิ้น · ความคิดเห็นที่มีอยู่แล้วยังอยู่"
          />
        </>
      )}
    </>
  );
}

export function ActivityStatusSection() {
  const privacy = usePrivacy();

  return (
    <>
      <SettingsHeading>สถานะกิจกรรม</SettingsHeading>

      {privacy.loadError ? (
        <SettingsError>{errorText(privacy.loadError, 'โหลดการตั้งค่าไม่สำเร็จ')}</SettingsError>
      ) : !privacy.data ? (
        <SettingsLoading />
      ) : (
        <>
          {privacy.saveError && <SettingsError>{errorText(privacy.saveError, 'บันทึกไม่สำเร็จ — ค่าถูกย้อนกลับแล้ว')}</SettingsError>}
          <div className="divide-y divide-border">
            <SwitchRow
              title="แสดงสถานะกิจกรรม"
              description="อนุญาตให้บัญชีที่คุณติดตามและทุกคนที่คุณส่งข้อความถึงเห็นว่าคุณใช้งานอยู่ครั้งล่าสุดเมื่อใด เมื่อปิดการตั้งค่านี้ คุณจะไม่เห็นสถานะกิจกรรมของบัญชีอื่นๆ ด้วย"
              checked={privacy.data.showActivityStatus}
              onChange={(showActivityStatus) => privacy.save({ showActivityStatus })}
            />
            <SwitchRow
              title="แสดงบัญชีของคุณในคำแนะนำ"
              description="เลือกว่าจะให้บัญชีของคุณปรากฏใน “แนะนำสำหรับคุณ” ของคนอื่นหรือไม่"
              checked={privacy.data.showInSuggestions}
              onChange={(showInSuggestions) => privacy.save({ showInSuggestions })}
            />
          </div>
        </>
      )}
    </>
  );
}
