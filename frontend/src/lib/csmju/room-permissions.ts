import { isStaffLike } from './roles';
import type { CoreRole } from './session';
import type { Channel } from './types';

/// สิทธิ์จัดการสมาชิกห้อง — ใช้ซ่อนปุ่มที่กดไปก็ได้ 403
///
/// หลังบ้านเป็นคนตัดสินจริงเสมอ ฟังก์ชันพวกนี้แค่ต้องตรงกับกฎฝั่งนั้น
/// แยกไฟล์ไว้ใต้ lib เพื่อให้ทั้งแผงสมาชิกและกล่องเชิญใช้ร่วมกันโดยไม่ import วนกัน

/// ใครเชิญคนเข้าห้องได้ — ตรงกับ `canAdministerChannel` ของหลังบ้าน
/// (backend/src/common/auth/member-role.ts) ผู้ดูแลห้อง หรืออาจารย์/เจ้าหน้าที่/ผู้ดูแลระบบ
export function canInviteMembers(
  channel: Pick<Channel, 'kind' | 'myRole'>,
  coreRole: CoreRole,
): boolean {
  return channel.kind !== 'DM' && (channel.myRole === 'MODERATOR' || isStaffLike(coreRole));
}

/// ใครนำสมาชิกคนอื่นออกได้ — ตรงกับ `canRemoveMember` ของหลังบ้าน
/// (backend/src/modules/channels/channels.service.ts)
///
/// ผู้ดูแลห้องเอาผู้ดูแลด้วยกันออกไม่ได้ ต้องเป็นผู้สร้างห้อง · ผู้สร้างห้องเอาออกได้แค่ผู้ดูแลระบบ
export function canRemoveMember(
  channel: Pick<Channel, 'kind' | 'myRole' | 'createdByCoreUserId'>,
  me: { id: string; coreRole: CoreRole },
  target: { coreUserId: string; role: 'MEMBER' | 'MODERATOR' },
): boolean {
  if (channel.kind === 'DM' || target.coreUserId === me.id) return false;
  if (!canInviteMembers(channel, me.coreRole)) return false;
  if (me.coreRole === 'admin') return true;
  if (target.coreUserId === channel.createdByCoreUserId) return false;

  return target.role !== 'MODERATOR' || channel.createdByCoreUserId === me.id;
}
