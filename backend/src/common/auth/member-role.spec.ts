import { describe, expect, it, vi } from 'vitest';
import {
  canAdministerChannel,
  defaultLayer2Role,
  ensureProfileName,
  nameFromEmail,
  resolveMember,
} from './member-role.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CoreHubUser } from './core-user.js';

const user = (over: Partial<CoreHubUser> = {}): CoreHubUser => ({
  coreUserId: 'user-002',
  email: 'student@core.local',
  coreRole: 'student',
  ...over,
});

describe('defaultLayer2Role — ต้องตรงกับ default_role_mapping ใน subsystem.yaml', () => {
  /// ถ้าตารางนี้เพี้ยนจาก subsystem.yaml ผู้ใช้จะเข้าระบบได้แต่กดอะไรไม่ได้
  /// และ Core Hub จะปฏิเสธคนที่ควรเข้าได้ (key ของ mapping คือรายชื่อคนที่เข้าได้)
  it.each([
    ['student', 'GUEST'],
    ['alumni', 'GUEST'],
    ['staff', 'EDITOR'],
    ['lecturer', 'EDITOR'],
    ['guest', 'GUEST'],
    ['admin', 'ADMIN'],
  ] as const)('%s → %s', (coreRole, expected) => {
    expect(defaultLayer2Role(coreRole)).toBe(expected);
  });
});

describe('canAdministerChannel', () => {
  it('ผู้ดูแลห้องทำได้', () => {
    expect(canAdministerChannel('MODERATOR', user())).toBe(true);
  });

  it('อาจารย์และผู้ดูแลระบบทำได้แม้เป็นสมาชิกธรรมดา', () => {
    expect(canAdministerChannel('MEMBER', user({ coreRole: 'staff' }))).toBe(true);
    expect(canAdministerChannel('MEMBER', user({ coreRole: 'lecturer' }))).toBe(true);
    expect(canAdministerChannel('MEMBER', user({ coreRole: 'admin' }))).toBe(true);
  });

  it('นักศึกษาและศิษย์เก่าที่เป็นสมาชิกธรรมดาทำไม่ได้', () => {
    // เคยเป็นบั๊ก: เงื่อนไขเดิมห้ามเฉพาะ student ศิษย์เก่าจึงดึงใครเข้าห้อง
    // ส่วนตัวก็ได้ แล้วคนที่ถูกดึงเข้ามาอ่านประวัติแชททั้งห้องทันที
    expect(canAdministerChannel('MEMBER', user())).toBe(false);
    expect(canAdministerChannel('MEMBER', user({ coreRole: 'guest' }))).toBe(false);
    expect(canAdministerChannel('MEMBER', user({ coreRole: 'alumni' }))).toBe(false);
  });
});

describe('nameFromEmail — ชื่อที่พออ่านออกระหว่างรอ endpoint จาก Core Hub', () => {
  it('ตัดโดเมนออก', () => {
    expect(nameFromEmail('staff@core.local')).toBe('staff');
  });

  it('อีเมลมหาวิทยาลัยได้รหัสนักศึกษาจริง', () => {
    // นี่คือเหตุผลที่วิธีนี้คุ้มค่า: `6700001382` อ่านรู้เรื่องกว่า `user-002` มาก
    expect(nameFromEmail('6700001382@mju.ac.th')).toBe('6700001382');
  });

  it('อีเมลที่ใช้ไม่ได้คืน null แทนการคืนสตริงว่าง', () => {
    // คืนสตริงว่างจะทำให้หน้าจอแสดงช่องว่างโดยไม่มีใครรู้ว่าเป็นบั๊ก
    expect(nameFromEmail('')).toBeNull();
    expect(nameFromEmail('@core.local')).toBeNull();
  });
});

describe('ensureProfileName', () => {
  it('เขียนชื่อครั้งแรกเท่านั้น — ห้ามทับของที่ซิงก์มาจาก Core', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = { profileCache: { upsert } } as unknown as PrismaService;

    await ensureProfileName(prisma, user({ email: 'staff@core.local' }));

    expect(upsert).toHaveBeenCalledWith({
      where: { coreUserId: 'user-002' },
      create: { coreUserId: 'user-002', displayName: 'staff' },
      // `update: {}` คือหัวใจ — วันที่ Core Hub เปิดให้ซิงก์ชื่อจริงได้แล้ว
      // ชื่อนั้นต้องชนะชื่อที่เดาจากอีเมล
      update: {},
    });
  });

  it('ไม่ตั้ง syncedAt — null แปลว่ายังไม่เคยซิงก์จริง', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = { profileCache: { upsert } } as unknown as PrismaService;

    await ensureProfileName(prisma, user());

    const arg = upsert.mock.calls[0][0] as { create: Record<string, unknown> };

    // ตั้ง syncedAt เมื่อไหร่ หน้าบ้านจะเลิกบอกผู้ใช้ว่า "ยังไม่เคยซิงก์ชื่อจริง"
    // ทั้งที่ชื่อที่เห็นมาจากอีเมล ไม่ใช่ชื่อจริงของคน
    expect(arg.create).not.toHaveProperty('syncedAt');
  });

  it('อีเมลใช้ไม่ได้ก็ไม่แตะฐานข้อมูลเลย', async () => {
    const upsert = vi.fn();
    const prisma = { profileCache: { upsert } } as unknown as PrismaService;

    await ensureProfileName(prisma, user({ email: '@core.local' }));

    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('resolveMember', () => {
  function prismaWith(existing: Record<string, unknown>) {
    const upsert = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue({ ...existing, layer2Role: 'EDITOR' });
    const profileUpsert = vi.fn().mockResolvedValue({});

    return {
      prisma: {
        subsystemMember: { upsert, update },
        profileCache: { upsert: profileUpsert },
      } as unknown as PrismaService,
      upsert,
      update,
      profileUpsert,
    };
  }

  it('ปรับสิทธิ์ให้ตรงกับ core role เมื่อแถวเดิมได้ค่าเริ่มต้นผิด', async () => {
    const { prisma, update } = prismaWith({
      coreUserId: 'user-003',
      layer2Role: 'GUEST',
      layer2RoleExplicit: false,
    });

    await resolveMember(prisma, user({ coreUserId: 'user-003', coreRole: 'staff' }));

    expect(update).toHaveBeenCalledWith({
      where: { coreUserId: 'user-003' },
      data: { layer2Role: 'EDITOR' },
    });
  });

  it('ห้ามเขียนทับค่าที่ผู้ดูแลตั้งเอง', async () => {
    const { prisma, update } = prismaWith({
      coreUserId: 'user-002',
      layer2Role: 'ADMIN',
      layer2RoleExplicit: true,
    });

    await resolveMember(prisma, user());

    expect(update).not.toHaveBeenCalled();
  });

  it('เก็บชื่อจากอีเมลไว้ด้วยในจังหวะเดียวกัน', async () => {
    const { prisma, profileUpsert } = prismaWith({
      coreUserId: 'user-002',
      layer2Role: 'GUEST',
      layer2RoleExplicit: false,
    });

    await resolveMember(prisma, user());
    // ยิงแบบไม่รอ (void) จึงต้องปล่อยให้ microtask เดินก่อนตรวจ
    await Promise.resolve();

    expect(profileUpsert).toHaveBeenCalled();
  });

  it('เก็บชื่อพังไม่ทำให้คำขอพัง', async () => {
    const { prisma } = prismaWith({
      coreUserId: 'user-002',
      layer2Role: 'GUEST',
      layer2RoleExplicit: true,
    });

    (prisma.profileCache.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ฐานข้อมูลล่ม'),
    );

    // ถ้าปล่อยให้ error หลุดออกมา ผู้ใช้จะเปิดหน้าไม่ได้เพราะเรื่องที่ไม่สำคัญ
    await expect(resolveMember(prisma, user())).resolves.toBeDefined();
  });
});
