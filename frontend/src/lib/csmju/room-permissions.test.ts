import { describe, expect, it } from 'vitest';
import { canInviteMembers, canRemoveMember } from './room-permissions';

/// กฎต้องตรงกับหลังบ้าน (canAdministerChannel · canRemoveMember) ทุกกรณี
/// ไม่งั้นจะมีปุ่มที่กดแล้วได้ 403 หรือคนที่มีสิทธิ์จริงหาปุ่มไม่เจอ

const room = { kind: 'GROUP' as const, myRole: 'MEMBER' as const, createdByCoreUserId: 'owner' };

describe('canInviteMembers', () => {
  it('ผู้ดูแลห้องและบุคลากรเชิญได้ · นักศึกษา/ศิษย์เก่าที่เป็นสมาชิกธรรมดาเชิญไม่ได้ · แชทส่วนตัวไม่ได้เลย', () => {
    expect(canInviteMembers({ kind: 'GROUP', myRole: 'MODERATOR' }, 'student')).toBe(true);
    expect(canInviteMembers({ kind: 'VOICE', myRole: 'MEMBER' }, 'lecturer')).toBe(true);
    expect(canInviteMembers({ kind: 'COURSE', myRole: 'MEMBER' }, 'staff')).toBe(true);
    expect(canInviteMembers({ kind: 'GROUP', myRole: 'MEMBER' }, 'student')).toBe(false);
    expect(canInviteMembers({ kind: 'GROUP', myRole: 'MEMBER' }, 'alumni')).toBe(false);
    expect(canInviteMembers({ kind: 'DM', myRole: 'MODERATOR' }, 'admin')).toBe(false);
  });
});

describe('canRemoveMember', () => {
  const member = { coreUserId: 'm', role: 'MEMBER' as const };
  const moderator = { coreUserId: 'mod', role: 'MODERATOR' as const };
  const creator = { coreUserId: 'owner', role: 'MODERATOR' as const };

  it('ผู้ดูแลห้องนำสมาชิกธรรมดาออกได้ แต่ไม่ใช่ผู้ดูแลด้วยกันหรือผู้สร้าง', () => {
    const mod = { ...room, myRole: 'MODERATOR' as const };

    expect(canRemoveMember(mod, { id: 'x', coreRole: 'student' }, member)).toBe(true);
    expect(canRemoveMember(mod, { id: 'x', coreRole: 'student' }, moderator)).toBe(false);
    expect(canRemoveMember(mod, { id: 'x', coreRole: 'student' }, creator)).toBe(false);
  });

  it('ผู้สร้างนำผู้ดูแลออกได้ · ผู้ดูแลระบบนำได้ทุกคนรวมผู้สร้าง · นำตัวเองออกไม่ได้', () => {
    expect(canRemoveMember({ ...room, myRole: 'MODERATOR' }, { id: 'owner', coreRole: 'student' }, moderator)).toBe(true);
    expect(canRemoveMember(room, { id: 'a', coreRole: 'admin' }, creator)).toBe(true);
    expect(canRemoveMember(room, { id: 'm', coreRole: 'admin' }, member)).toBe(false);
  });

  it('สมาชิกธรรมดาที่เป็นนักศึกษานำใครออกไม่ได้ · อาจารย์นำสมาชิกธรรมดาออกได้ · แชทส่วนตัวไม่ได้', () => {
    expect(canRemoveMember(room, { id: 'x', coreRole: 'student' }, member)).toBe(false);
    expect(canRemoveMember(room, { id: 'x', coreRole: 'lecturer' }, member)).toBe(true);
    expect(canRemoveMember({ ...room, kind: 'DM' }, { id: 'x', coreRole: 'admin' }, member)).toBe(false);
  });
});
