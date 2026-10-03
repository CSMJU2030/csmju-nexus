import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsShell } from './settings-shell';

/// เทสต์เมนูหน้าตั้งค่าแบบ Instagram — ทุกแถวพาไปที่ที่ทำงานจริง ช่องค้นหากรองได้
/// และไม่มีรายการที่ระบบนี้ไม่มีฟีเจอร์รองรับ (เช่น "ภาษา")

const pathname = vi.hoisted(() => ({ current: '/settings' }));

vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
// ฟอร์มมี dependency ของมันเอง — เทสต์นี้ใช้แค่ค่าคงที่ CORE_HOME
vi.mock('@/components/csmju/profile-settings-form', () => ({
  CORE_HOME: 'http://core.test',
}));

beforeEach(() => {
  pathname.current = '/settings';
});

describe('เมนูการตั้งค่า', () => {
  it('หมวดและแถวตาม Instagram · /settings นับว่าอยู่ที่ "แก้ไขโปรไฟล์"', () => {
    render(<SettingsShell>เนื้อหา</SettingsShell>);

    for (const caption of [
      'วิธีที่คุณใช้ CS Nexus',
      'ใครบ้างที่สามารถดูเนื้อหาของคุณได้',
      'วิธีที่คนอื่นๆ สามารถโต้ตอบกับคุณได้',
      'ส่วนตัว',
      'บัญชีกลาง CSMJU2030',
    ]) {
      expect(screen.getByText(caption)).toBeInTheDocument();
    }

    expect(screen.getByRole('link', { name: 'แก้ไขโปรไฟล์' })).toHaveAttribute('aria-current', 'page');

    const hrefs: [string, string][] = [
      ['การแจ้งเตือน', '/settings/notifications'],
      ['เพื่อนสนิท', '/settings/close-friends'],
      ['ถูกบล็อก', '/settings/blocked'],
      ['สถานะกิจกรรม', '/settings/activity-status'],
      ['ความคิดเห็น', '/settings/comments'],
      ['ข้อความ', '/messages?view=requests'],
      ['ธีม', '/settings/theme'],
    ];

    for (const [name, href] of hrefs) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }

    // รหัสผ่าน อีเมล ชื่อผู้ใช้ เป็นของบัญชีกลาง — ลิงก์ออกไปที่นั่น ไม่มีฟอร์มปลอมที่นี่
    expect(screen.getByRole('link', { name: /รหัสผ่านและความปลอดภัย/ })).toHaveAttribute('href', 'http://core.test');
    // ทั้งระบบเป็นภาษาไทยอย่างเดียว — ไม่มีรายการภาษาหลอก ๆ
    expect(screen.queryByRole('link', { name: /ภาษา/ })).not.toBeInTheDocument();
  });

  it('แถวของหน้าที่เปิดอยู่ถูกไฮไลต์', () => {
    pathname.current = '/settings/blocked';

    render(<SettingsShell>เนื้อหา</SettingsShell>);

    expect(screen.getByRole('link', { name: 'ถูกบล็อก' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'แก้ไขโปรไฟล์' })).not.toHaveAttribute('aria-current');
  });

  it('ช่องค้นหากรองเมนู และบอกเมื่อไม่เจออะไร', async () => {
    render(<SettingsShell>เนื้อหา</SettingsShell>);

    await userEvent.type(screen.getByRole('searchbox'), 'dark');

    expect(screen.getByRole('link', { name: 'ธีม' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'การแจ้งเตือน' })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'บล็อก');
    expect(screen.getByRole('link', { name: 'ถูกบล็อก' })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'ไม่มีแน่ๆ');

    expect(screen.getByText(/ไม่พบการตั้งค่าที่ตรงกับ/)).toBeInTheDocument();
  });
});
