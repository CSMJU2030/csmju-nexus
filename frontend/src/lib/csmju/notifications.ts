import type { Notification } from './types';

/// ตรรกะร่วมของการแจ้งเตือน — ใช้ทั้งกระดิ่งบนแถบบนและหน้า /notifications
///
/// แยกออกมาเพราะสองที่นั้นต้องอ่านข้อความเดียวกันเสมอ ถ้าปล่อยให้ต่างคนต่าง
/// เขียน วันหนึ่งกระดิ่งจะบอกอย่างหนึ่งแล้วหน้าเต็มบอกอีกอย่าง ทั้งที่เป็น
/// การแจ้งเตือนรายการเดียวกัน

/// ข้อความของแจ้งเตือนแต่ละชนิด
///
/// หลังบ้านส่ง kind + actorCoreUserId + payload มาให้ครบในหนึ่ง query
/// หน้าบ้านจึงประกอบข้อความได้โดยไม่ต้องยิงถามเพิ่มทีละรายการ
export function describeNotification(item: Notification): string {
  return `${item.actorCoreUserId ?? 'มีคน'} ${describeAction(item)}`;
}

/// ข้อความส่วนที่ไม่รวมชื่อคนทำ — แผงแจ้งเตือนแบบ Instagram วางชื่อเป็นตัวหนา
/// (ลิงก์ไปโปรไฟล์) แล้วต่อด้วยข้อความนี้ ใช้ชุดคำเดียวกับ describeNotification
export function describeAction(item: Notification): string {
  const payload = item.payload ?? {};
  const preview = typeof payload.preview === 'string' ? payload.preview : null;

  switch (item.kind) {
    case 'FOLLOW':
      return 'เริ่มติดตามคุณ';
    case 'REEL_LIKE':
      return `ถูกใจคลิปของคุณ${preview ? ` · ${preview}` : ''}`;
    case 'REEL_COMMENT':
      return `คอมเมนต์คลิปของคุณ${preview ? `: ${preview}` : ''}`;
    case 'POST_COMMENT':
      return `ตอบกระทู้ของคุณ${preview ? `: ${preview}` : ''}`;
    case 'REACTION':
      if (payload.targetKind === 'POST') return `กด ${payload.emoji ?? 'รีแอ็กชัน'} ให้โพสต์ของคุณ${preview ? ` · ${preview}` : ''}`;
      if (payload.targetKind === 'REEL') return `กด ${payload.emoji ?? 'รีแอ็กชัน'} ให้คลิปของคุณ${preview ? ` · ${preview}` : ''}`;
      return `กด ${payload.emoji ?? 'รีแอ็กชัน'} ${preview ? `· ${preview}` : ''}`.trim();
    case 'REEL_REPOST':
      return `รีโพสต์คลิปของคุณ${preview ? ` · ${preview}` : ''}`;
    case 'COMMENT_LIKE':
      return `ถูกใจความคิดเห็นของคุณ${preview ? `: ${preview}` : ''}`;
    case 'STORY_REPLY':
      return payload.emoji && !preview
        ? `แสดงความรู้สึก ${String(payload.emoji)} ต่อสตอรี่ของคุณ`
        : `ตอบกลับสตอรี่ของคุณ${preview ? `: ${preview}` : ''}`;
    case 'MISSED_CALL':
      return payload.media === 'VIDEO' ? 'วิดีโอคอลหาคุณ · ไม่ได้รับสาย' : 'โทรหาคุณ · ไม่ได้รับสาย';
    case 'MENTION':
      if (payload.story) return `กล่าวถึงคุณในสตอรี่${preview ? `: ${preview}` : ''}`;
      return payload.broadcast
        ? `ประกาศถึงทุกคนในห้อง${preview ? `: ${preview}` : ''}`
        : `เรียกถึงคุณ${preview ? `: ${preview}` : ''}`;
    case 'THREAD_REPLY':
      return 'ตอบในเธรดของคุณ';
    case 'VOICE_INVITE':
      return 'ชวนคุณเข้าห้องเสียง';
    case 'CHANNEL_INVITE':
      return 'เพิ่มคุณเข้าห้องแชท';
    case 'MEETING_INVITE':
      return payload.cancelled
        ? `ยกเลิกนัด "${payload.title ?? ''}"`
        : `นัดประชุม "${payload.title ?? ''}"`;
    default:
      // ชนิดที่หน้าบ้านยังไม่รู้จัก — ห้ามโชว์ชื่อ enum ภาษาอังกฤษให้ผู้ใช้เห็น
      return 'มีความเคลื่อนไหวใหม่';
  }
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'เมื่อครู่';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาทีที่แล้ว`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชั่วโมงที่แล้ว`;

  return `${Math.floor(seconds / 86400)} วันที่แล้ว`;
}

/// การแจ้งเตือนนี้ควรพาไปที่ไหน
///
/// คืน null เมื่อ **ยังไม่มีหน้าปลายทางที่พาไปได้ตรงจุดจริง ๆ** ดีกว่าพาไป
/// หน้ารวมแล้วปล่อยให้ผู้ใช้ไปหาเอง เพราะลิงก์ที่พาไปผิดที่ทำให้คนเลิกเชื่อ
/// การแจ้งเตือนทั้งระบบ
///
/// ห้องแชทรับ ?channel= เพื่อเปิดห้องที่ถูกต้องได้ทันที
export function notificationLink(item: Notification): string | null {
  const payload = item.payload ?? {};
  const channelId =
    typeof payload.channelId === 'string' ? payload.channelId : null;

  switch (item.kind) {
    case 'FOLLOW':
      return item.actorCoreUserId
        ? `/profile/${encodeURIComponent(item.actorCoreUserId)}`
        : null;

    // /chat ส่งต่อห้อง DM / แชทกลุ่มไปที่ /messages เอง จึงใช้ลิงก์เดียวได้ทุกชนิดห้อง
    case 'MENTION':
      if (payload.story) return `/feed?story=${encodeURIComponent(item.refId)}`;
      return channelId ? `/chat?channel=${encodeURIComponent(channelId)}` : null;

    case 'THREAD_REPLY':
    case 'CHANNEL_INVITE':
    case 'VOICE_INVITE':
      return channelId ? `/chat?channel=${encodeURIComponent(channelId)}` : null;

    case 'REACTION':
      if (payload.targetKind === 'POST') return `/p/${encodeURIComponent(item.refId)}`;
      if (payload.targetKind === 'REEL') return `/reels?reel=${encodeURIComponent(item.refId)}`;
      return channelId ? `/chat?channel=${encodeURIComponent(channelId)}` : null;

    case 'STORY_REPLY':
    case 'MISSED_CALL':
      return channelId ? `/messages?channel=${encodeURIComponent(channelId)}` : null;

    case 'MEETING_INVITE':
      return '/meetings';

    case 'REEL_LIKE':
    case 'REEL_COMMENT':
    case 'REEL_REPOST':
    case 'COMMENT_LIKE':
      return `/reels?reel=${encodeURIComponent(item.refId)}`;

    case 'POST_COMMENT':
      return `/p/${encodeURIComponent(item.refId)}`;

    default:
      return null;
  }
}
