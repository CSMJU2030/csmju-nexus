import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile } from '@/lib/csmju/types';
import { normalizeWebsite, ProfileSettingsForm } from './profile-settings-form';

/// เทสต์ฟอร์ม "แก้ไขโปรไฟล์" แบบ Instagram
///
/// แก้ได้แค่ของระบบย่อยนี้ (เว็บไซต์ · แนะนำตัว · รูปปก · สวิตช์คำแนะนำ) · รูปโปรไฟล์
/// เป็นของบัญชีกลาง ปุ่ม "เปลี่ยนรูปภาพ" จึงพาไปที่นั่น · ปุ่ม "ส่ง" กดได้เมื่อมีอะไรเปลี่ยน

const apiPatch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csmju/api', () => ({ api: { patch: apiPatch } }));
vi.mock('@/lib/csmju/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({ id: 'user-002', email: 'student@core.local', coreRole: 'student', subsystemRole: 'GUEST' }),
}));
vi.mock('@/components/csmju/user-name', async (original) => ({
  ...(await original<typeof import('@/components/csmju/user-name')>()),
  Avatar: ({ coreUserId }: { coreUserId: string }) => <span>{coreUserId}</span>,
}));

type Mine = MyProfile & { website?: string | null };

const mine = (overrides: Partial<Mine> = {}): Mine => ({
  coreUserId: 'user-002',
  displayName: 'นักศึกษา ทดสอบ',
  avatarUrl: null,
  syncedAt: null,
  badge: null,
  stats: { reelCount: 0, postCount: 0, followerCount: 0, followingCount: 0 },
  relation: { following: false, followedBy: false, mutual: false },
  layer2Role: 'GUEST',
  joinedAt: null,
  bio: 'เดิม',
  coverUrl: null,
  managedByCore: ['displayName', 'avatarUrl'],
  website: null,
  ...overrides,
});

function renderForm(profile = mine(), suggestions?: { value: boolean; save: (next: boolean) => Promise<void> }) {
  const client = new QueryClient();

  render(
    <QueryClientProvider client={client}>
      <ProfileSettingsForm profile={profile} suggestions={suggestions} />
    </QueryClientProvider>,
  );

  return client;
}

beforeEach(() => {
  apiPatch.mockReset();
});

describe('normalizeWebsite', () => {
  it('ว่าง = ลบ · เติม https:// ให้ · ปฏิเสธลิงก์ที่ไม่ใช่ http(s)', () => {
    expect(normalizeWebsite('  ')).toEqual({ value: null, error: null });
    expect(normalizeWebsite('example.com').value).toBe('https://example.com/');
    expect(normalizeWebsite('http://a.b/c?d=1').value).toBe('http://a.b/c?d=1');
    expect(normalizeWebsite('javascript:alert(1)').error).toMatch(/http/);
    expect(normalizeWebsite('ไม่ใช่ลิงก์').error).toBeTruthy();
  });
});

describe('แก้ไขโปรไฟล์', () => {
  it('"เปลี่ยนรูปภาพ" เปิดกล่องที่พาไปจัดการรูปที่บัญชีกลาง (ระบบนี้ไม่เก็บรูปโปรไฟล์)', async () => {
    renderForm();

    await userEvent.click(screen.getByRole('button', { name: 'เปลี่ยนรูปภาพ' }));

    expect(await screen.findByRole('heading', { name: 'เปลี่ยนรูปโปรไฟล์' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/อัปโหลดรูปโปรไฟล์/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'เปลี่ยนรูปโปรไฟล์' })).not.toBeInTheDocument());
  });

  it('ปุ่ม "ส่ง" กดไม่ได้จนกว่าจะแก้อะไรจริง และตัวนับบอก n / 300', async () => {
    renderForm();

    const submit = screen.getByRole('button', { name: 'ส่ง' });

    expect(submit).toBeDisabled();
    // นับแบบเดียวกับหลังบ้าน: "เดิม" = เ ด ิ ม = 4 ตัว
    expect(screen.getByText('4 / 300')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('แนะนำตัว'), 'ๆ');
    expect(submit).toBeEnabled();

    await userEvent.type(screen.getByLabelText('แนะนำตัว'), '{Backspace}');
    expect(submit).toBeDisabled();
  });

  it('ตัวนับกันไม่ให้เกิน 300 ตัวอักษรตามเพดานของหลังบ้าน', async () => {
    renderForm(mine({ bio: 'ก'.repeat(300) }));

    await userEvent.type(screen.getByLabelText('แนะนำตัว'), 'ข');

    expect(screen.getByLabelText('แนะนำตัว')).toHaveValue('ก'.repeat(300));
  });

  it('เว็บไซต์ผิดรูปแบบ → บอกทันทีและส่งไม่ได้ · ถูกต้อง → ส่งแบบจัดรูปแล้ว', async () => {
    apiPatch.mockImplementation((_path: string, body: { website?: string }) =>
      Promise.resolve(mine({ website: body.website ?? null })),
    );

    renderForm();

    await userEvent.type(screen.getByLabelText('เว็บไซต์'), 'javascript:x');
    expect(screen.getByText(/ใช้ได้เฉพาะลิงก์ที่ขึ้นต้นด้วย/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่ง' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('เว็บไซต์'));
    await userEvent.type(screen.getByLabelText('เว็บไซต์'), 'csmju.ac.th');
    await userEvent.click(screen.getByRole('button', { name: 'ส่ง' }));

    expect(apiPatch).toHaveBeenCalledWith('/profiles/me', { bio: 'เดิม', website: 'https://csmju.ac.th/' });
  });

  it('ส่งแค่ bio (ไม่ส่ง website/cover ถ้าไม่ได้แตะ) แล้วเขียนแคชโปรไฟล์ให้หน้าโปรไฟล์เห็นทันที', async () => {
    apiPatch.mockImplementation((_path: string, body: { bio: string }) => Promise.resolve(mine({ bio: body.bio })));

    const client = renderForm();

    await userEvent.clear(screen.getByLabelText('แนะนำตัว'));
    await userEvent.type(screen.getByLabelText('แนะนำตัว'), 'ใหม่');
    await userEvent.click(screen.getByRole('button', { name: 'ส่ง' }));

    expect(apiPatch).toHaveBeenCalledWith('/profiles/me', { bio: 'ใหม่' });
    expect(await screen.findByText('บันทึกแล้ว')).toBeInTheDocument();
    await waitFor(() =>
      expect(client.getQueryData(['profile', 'user-002'])).toMatchObject({ mine: { bio: 'ใหม่' } }),
    );
  });

  it('สวิตช์ "แสดงการแนะนำบัญชีบนโปรไฟล์" บันทึกไปที่การตั้งค่าความเป็นส่วนตัวตอนกด "ส่ง"', async () => {
    apiPatch.mockResolvedValue(mine());
    const save = vi.fn().mockResolvedValue(undefined);

    renderForm(mine(), { value: true, save });

    const toggle = screen.getByRole('switch', { name: 'แสดงการแนะนำบัญชีบนโปรไฟล์' });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'ส่ง' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(false));
  });

  it('ไม่มีข้อมูลความเป็นส่วนตัว = ไม่วาดสวิตช์ (ไม่เดาค่า)', () => {
    renderForm();

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('กดเอารูปปกเดิมออก → ส่ง coverAssetId: null', async () => {
    apiPatch.mockResolvedValue(mine());

    renderForm(mine({ coverUrl: 'https://files.test/cover.png' }));

    await userEvent.click(screen.getByRole('button', { name: 'เอารูปปกออก' }));
    await userEvent.click(screen.getByRole('button', { name: 'ส่ง' }));

    expect(apiPatch).toHaveBeenCalledWith('/profiles/me', { bio: 'เดิม', coverAssetId: null });
  });

  it('ข้อความผิดพลาดจากหลังบ้านแสดงตามจริง', async () => {
    apiPatch.mockRejectedValue(new Error('คำแนะนำตัวยาวได้ไม่เกิน 300 ตัวอักษร'));

    renderForm();

    await userEvent.type(screen.getByLabelText('แนะนำตัว'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'ส่ง' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('คำแนะนำตัวยาวได้ไม่เกิน 300 ตัวอักษร');
  });
});
