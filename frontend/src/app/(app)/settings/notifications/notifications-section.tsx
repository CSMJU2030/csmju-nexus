'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProfile } from '@/components/csmju/user-name';
import { api } from '@/lib/csmju/api';
import type { FollowEdge } from '@/lib/csmju/types';
import { SettingsHeading } from '../settings-shell';
import type {
  NotificationPreferences,
  NotifyAudience,
  NotifyMessages,
  NotifyToggle,
  PauseMinutes,
} from '../settings-types';
import {
  ChoiceSection,
  errorText,
  SettingsError,
  SettingsLoading,
  SwitchRow,
  useSettings,
} from '../settings-ui';

/// การแจ้งเตือนแบบพุช — ตามหน้า Push notifications ของ Instagram
///
/// "พุช" ในที่นี้คือการแจ้งเตือนในแอป (กระดิ่ง + แผงการแจ้งเตือน) ระบบนี้ไม่ส่ง
/// การแจ้งเตือนของระบบปฏิบัติการ · ทุกการแตะบันทึกทันที
///
/// ตัดแถวของ Instagram ที่ระบบนี้ไม่มีฟีเจอร์รองรับออกทั้งหมด (ไลฟ์ ระดมทุน
/// วันเกิด ตำแหน่ง โฆษณา รีมิกซ์ ช่อง ฯลฯ) — สวิตช์ที่ไม่มีผลอะไรคือการหลอกผู้ใช้

export const NOTIFICATION_PREFS_KEY = ['notification-preferences'] as const;

const AUDIENCE: { value: NotifyAudience; label: string }[] = [
  { value: 'OFF', label: 'ปิด' },
  { value: 'FOLLOWING', label: 'จากโปรไฟล์ที่ฉันติดตาม' },
  { value: 'EVERYONE', label: 'จากทุกคน' },
];

const TOGGLE: { value: NotifyToggle; label: string }[] = [
  { value: 'OFF', label: 'ปิด' },
  { value: 'ON', label: 'เปิด' },
];

const MESSAGES: { value: NotifyMessages; label: string }[] = [
  { value: 'OFF', label: 'ปิด' },
  { value: 'PRIMARY', label: 'จากกล่องข้อความหลักเท่านั้น' },
  { value: 'PRIMARY_GENERAL', label: 'จากกล่องข้อความหลักและกล่องข้อความทั่วไป' },
];

const PAUSE_CHOICES: { minutes: PauseMinutes; label: string }[] = [
  { minutes: 15, label: '15 นาที' },
  { minutes: 60, label: '1 ชั่วโมง' },
  { minutes: 120, label: '2 ชั่วโมง' },
  { minutes: 480, label: '8 ชั่วโมง' },
];

/// ชื่อจริงของคนที่เราติดตามคนแรก — ใช้ในบรรทัดตัวอย่างแบบที่ Instagram ใช้ชื่อจริง
/// ยังไม่ได้ติดตามใครเลย = ใช้คำกลาง ๆ ไม่แต่งชื่อคนขึ้นมาเอง
function useExamplePerson() {
  const { data } = useQuery({
    queryKey: ['my-following-first'],
    queryFn: async () => (await api.list<FollowEdge>('/follows/following?limit=1')).items[0]?.coreUserId ?? null,
  });

  return data ?? null;
}

function Named({ coreUserId }: { coreUserId: string }) {
  return <>{useProfile(coreUserId).displayName}</>;
}

function Who({ coreUserId }: { coreUserId: string | null }) {
  return coreUserId ? <Named coreUserId={coreUserId} /> : <>คนที่คุณติดตาม</>;
}

export function isPaused(prefs: Pick<NotificationPreferences, 'pausedUntil'> | undefined, now = Date.now()) {
  return Boolean(prefs?.pausedUntil && Date.parse(prefs.pausedUntil) > now);
}

export function NotificationsSection() {
  const prefs = useSettings<NotificationPreferences>(NOTIFICATION_PREFS_KEY, '/me/notification-preferences');
  const person = useExamplePerson();
  const [picking, setPicking] = useState(false);

  const data = prefs.data;
  const paused = isPaused(data);

  return (
    <>
      <SettingsHeading back={{ href: '/settings', label: 'กลับไปการตั้งค่า' }}>การแจ้งเตือนแบบพุช</SettingsHeading>

      {prefs.loadError ? (
        <SettingsError>{errorText(prefs.loadError, 'โหลดการตั้งค่าการแจ้งเตือนไม่สำเร็จ')}</SettingsError>
      ) : !data ? (
        <SettingsLoading />
      ) : (
        <>
          {prefs.saveError && <SettingsError>{errorText(prefs.saveError, 'บันทึกไม่สำเร็จ — ค่าถูกย้อนกลับแล้ว')}</SettingsError>}

          <div className="border-b border-border pb-5">
            <SwitchRow
              title="หยุดชั่วคราวทั้งหมด"
              description={
                paused && data.pausedUntil
                  ? `หยุดการแจ้งเตือนไว้ถึง ${new Date(data.pausedUntil).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })} น.`
                  : undefined
              }
              checked={paused}
              onChange={(next) => (next ? setPicking(true) : prefs.save({ pauseMinutes: null }, { pausedUntil: null }))}
            />
          </div>

          <div className="pt-5">
            <ChoiceSection
              title="การกดถูกใจ"
              value={data.likes}
              options={AUDIENCE}
              onChange={(likes) => prefs.save({ likes })}
              example={<><Who coreUserId={person} /> ถูกใจคลิปของคุณ</>}
            />
            <ChoiceSection
              title="ความคิดเห็น"
              value={data.comments}
              options={AUDIENCE}
              onChange={(comments) => prefs.save({ comments })}
              example={<><Who coreUserId={person} /> แสดงความคิดเห็นในคลิปของคุณ</>}
            />
            <ChoiceSection
              title="การกดถูกใจความคิดเห็น"
              value={data.commentLikes}
              options={TOGGLE}
              onChange={(commentLikes) => prefs.save({ commentLikes })}
              example={<><Who coreUserId={person} /> ถูกใจความคิดเห็นของคุณ</>}
            />
            <ChoiceSection
              title="ผู้ติดตามใหม่"
              value={data.newFollowers}
              options={TOGGLE}
              onChange={(newFollowers) => prefs.save({ newFollowers })}
              example={<><Who coreUserId={person} /> เริ่มติดตามคุณแล้ว</>}
            />
            <ChoiceSection
              title="การกล่าวถึง"
              value={data.mentions}
              options={AUDIENCE}
              onChange={(mentions) => prefs.save({ mentions })}
              example={<><Who coreUserId={person} /> กล่าวถึงคุณในความคิดเห็น</>}
            />
            <ChoiceSection
              title="รีโพสต์"
              value={data.reposts}
              options={TOGGLE}
              onChange={(reposts) => prefs.save({ reposts })}
              example={<><Who coreUserId={person} /> รีโพสต์คลิปของคุณ</>}
            />
            <ChoiceSection
              title="การตอบกลับสตอรี่"
              value={data.storyReplies}
              options={TOGGLE}
              onChange={(storyReplies) => prefs.save({ storyReplies })}
              example={<><Who coreUserId={person} /> ตอบกลับสตอรี่ของคุณ</>}
            />
            <ChoiceSection
              title="คำขอส่งข้อความ"
              value={data.messageRequests}
              options={TOGGLE}
              onChange={(messageRequests) => prefs.save({ messageRequests })}
              example={<><Who coreUserId={person} /> ต้องการส่งข้อความถึงคุณ</>}
            />
            <ChoiceSection
              title="คำขอสำหรับกลุ่ม"
              value={data.groupRequests}
              options={TOGGLE}
              onChange={(groupRequests) => prefs.save({ groupRequests })}
              example={<><Who coreUserId={person} /> ต้องการเพิ่มคุณเข้ากลุ่มแชท</>}
            />
            <ChoiceSection
              title="ข้อความจากแชทเดี่ยวและแชทกลุ่ม"
              value={data.messages}
              options={MESSAGES}
              onChange={(messages) => prefs.save({ messages })}
              example={<><Who coreUserId={person} /> ส่งข้อความถึงคุณ</>}
            />
          </div>
        </>
      )}

      {picking && (
        <PausePicker
          onClose={() => setPicking(false)}
          onPick={(minutes) => {
            setPicking(false);
            prefs.save(
              { pauseMinutes: minutes },
              // ค่าคาดการณ์ให้สวิตช์ติดทันที — คำตอบของหลังบ้านจะทับด้วยเวลาจริง
              { pausedUntil: new Date(Date.now() + minutes * 60_000).toISOString() },
            );
          }}
        />
      )}
    </>
  );
}

function PausePicker({ onClose, onPick }: { onClose: () => void; onPick: (minutes: PauseMinutes) => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-[400px] rounded-xl border-0 bg-card">
        <div className="px-6 pb-3 pt-6 text-center">
          <DialogTitle className="text-lg font-semibold">หยุดชั่วคราวทั้งหมด</DialogTitle>
          <DialogDescription className="mt-1">ระหว่างนี้จะไม่มีการแจ้งเตือนใหม่เด้งขึ้นมา</DialogDescription>
        </div>
        {PAUSE_CHOICES.map((choice) => (
          <button
            key={choice.minutes}
            type="button"
            onClick={() => onPick(choice.minutes)}
            className="flex min-h-12 w-full items-center justify-center border-t border-border text-csmju-label hover:bg-accent"
          >
            {choice.label}
          </button>
        ))}
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
