'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/csmju/api';
import { shownName } from '@/components/csmju/user-name';
import type { MyProfile, ProfileDetail } from '@/lib/csmju/types';

/// หลังบ้านคืน displayName = coreUserId (UUID) ถ้ายังไม่มีชื่อในแคช — ห้ามขึ้นจอ
function named<T extends ProfileDetail>(profile: T): T {
  return { ...profile, displayName: shownName(profile.coreUserId, profile.displayName) };
}

/// ข้อมูลหัวโปรไฟล์ — ใช้ร่วมกันระหว่างหน้าโปรไฟล์กับหน้าตั้งค่า
///
/// สองหน้าใช้คีย์ `['profile', coreUserId]` เดียวกัน บันทึกคำแนะนำตัวที่หน้า
/// ตั้งค่าแล้วกดกลับไปหน้าโปรไฟล์ ต้องเห็นของใหม่ทันทีโดยไม่ต้องรอโหลด —
/// จึงต้องเก็บรูปร่างเดียวกันเป๊ะ ถ้าต่างกัน หน้าหนึ่งจะอ่านแคชของอีกหน้า
/// แล้วได้ field ที่ไม่มีอยู่จริง
///
/// แยก `mine` ออกจาก `profile` แทนการยัดเป็นยูเนียนแล้วแคบด้วย `in`:
/// `MyProfile` สืบทอดจาก `ProfileDetail` TypeScript จึงยุบยูเนียน
/// `ProfileDetail | MyProfile` เหลือ `ProfileDetail` ตัวเดียว แล้วการแคบชนิด
/// ด้วย `'coverUrl' in profile` ก็ได้ `unknown` กลับมาแทนค่าจริง
export type ProfileData = {
  profile: ProfileDetail;
  mine: MyProfile | null;
};

export const profileKey = (coreUserId: string) => ['profile', coreUserId] as const;

export function useProfileData(coreUserId: string, isMe: boolean) {
  return useQuery({
    queryKey: profileKey(coreUserId),
    queryFn: async (): Promise<ProfileData> => {
      // /profiles/me คืน MyProfile ที่มี bio, coverUrl และ managedByCore
      // เพิ่มมา — ของคนอื่นคืน ProfileDetail เฉย ๆ
      if (isMe) {
        const detail = named(await api.get<MyProfile>('/profiles/me'));

        return { profile: detail, mine: detail };
      }

      return {
        profile: named(
          await api.get<ProfileDetail>(`/profiles/${encodeURIComponent(coreUserId)}`),
        ),
        mine: null,
      };
    },
  });
}
