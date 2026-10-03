import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/// ชื่อที่แสดง — **ห้ามแสดง coreUserId ให้ผู้ใช้เห็น**
///
/// coreUserId จาก Core Hub ตัวจริงเป็น UUID ไม่ใช่รหัสที่คนอ่านออก เดิมทุกจุดที่ยังโหลด
/// ชื่อไม่เสร็จ หรือหลังบ้านไม่มีชื่อในแคช (คืน displayName = coreUserId) โชว์ UUID
/// ตรง ๆ ทั้งหัวแชท รายชื่อ และ tooltip

const UUID = 'e2b39ea5-d4ff-467b-89a2-4e90f401947f';
const NAMED = '19a63df8-16df-4619-99d3-70e341836dfb';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({ api: { get: apiGet } }));
vi.mock('@/components/csmju/user-badge', () => ({
  UserAvatar: () => <span />,
  VerifiedBadge: () => null,
}));

const { UNKNOWN_NAME, UserName, hasKnownName, shownName, useProfile } = await import('./user-name');

function Name({ id }: { id: string }) {
  return <p data-testid={id}>{useProfile(id).displayName}</p>;
}

describe('shownName', () => {
  it('ชื่อจริงผ่าน · ว่างหรือเท่ากับ coreUserId = ชื่อสำรอง', () => {
    expect(shownName(NAMED, 'somsak.j')).toBe('somsak.j');
    expect(shownName(UUID, UUID)).toBe(UNKNOWN_NAME);
    expect(shownName(UUID, '   ')).toBe(UNKNOWN_NAME);
    expect(shownName(UUID, null)).toBe(UNKNOWN_NAME);
  });
});

describe('useProfile', () => {
  it('ระหว่างโหลดและเมื่อหลังบ้านไม่มีชื่อ (คืน coreUserId) แสดงชื่อสำรอง ไม่ใช่ UUID', async () => {
    apiGet.mockResolvedValue([
      { coreUserId: UUID, displayName: UUID, avatarUrl: null, syncedAt: null, badge: null },
      { coreUserId: NAMED, displayName: 'somsak.j', avatarUrl: null, syncedAt: null, badge: null },
    ]);

    render(
      <>
        <Name id={UUID} />
        <Name id={NAMED} />
        <UserName coreUserId={NAMED} />
      </>,
    );

    // ก่อนคำตอบมาถึง
    expect(screen.getByTestId(UUID)).toHaveTextContent(UNKNOWN_NAME);

    expect(await screen.findAllByText('somsak.j')).toHaveLength(2);
    expect(screen.getByTestId(UUID)).toHaveTextContent(UNKNOWN_NAME);
    // ข้อความที่ผู้ใช้เห็น (data-testid กับ href เป็นของเทสต์/ลิงก์ ไม่ขึ้นจอ)
    expect(document.body.textContent).not.toContain(UUID);
    expect(document.body.textContent).not.toContain(NAMED);
    // ลิงก์ชื่อไม่มี tooltip เป็น UUID แล้ว
    expect(screen.getByRole('link', { name: 'somsak.j' })).not.toHaveAttribute('title');
    expect(hasKnownName({ coreUserId: UUID, displayName: UNKNOWN_NAME, avatarUrl: null, syncedAt: null, badge: null })).toBe(false);
  });
});
