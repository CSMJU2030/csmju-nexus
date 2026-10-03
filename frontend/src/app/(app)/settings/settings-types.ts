/// ชนิดของหน้าตั้งค่า — ทั้งหมดมาจาก lib/csmju/types.ts (สัญญาของหลังบ้าน)
/// ไฟล์นี้แค่รวมชื่อไว้ที่เดียวและตั้งชื่อย่อที่หน้าตั้งค่าใช้

import type { BlockRow, UpdateNotificationPreferencesBody } from '@/lib/csmju/types';

export type {
  AudienceCounts,
  CommentsFrom,
  NotificationPreferences,
  NotifyAudience,
  NotifyMessages,
  NotifyToggle,
  PrivacySettings,
} from '@/lib/csmju/types';

export type PauseMinutes = NonNullable<UpdateNotificationPreferencesBody['pauseMinutes']>;

/// แถวของ GET /close-friends และ GET /blocks — รูปเดียวกัน
export type PersonEdge = BlockRow;
