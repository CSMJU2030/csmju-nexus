/// สัญญาของ API — ชนิดข้อมูลที่หลังบ้านตอบกลับ
///
/// field เป็น camelCase ทั้งหมดตาม api-conventions.md ข้อ 3 และใช้ชื่อตรงตามที่หลังบ้านส่ง
/// **ไม่แปลงชื่อ** ที่หน้าบ้านโดยตั้งใจ: ถ้าแปลง ชื่อใน DevTools จะไม่ตรงกับใน openapi.json
/// แล้วเวลาไล่บั๊กจะต้องแปลงกลับไปกลับมาในหัวตลอด
///
/// ที่มาของแต่ละชนิด: `backend/openapi.json` (78 endpoint)
/// ถ้าหลังบ้านเปลี่ยนสัญญา CI จะจับที่ `npm run openapi:check` ฝั่งหลังบ้าน
/// แต่ **ไฟล์นี้ไม่มีอะไรจับให้** — TODO(PL): พิจารณาสร้างชนิดจาก openapi.json
/// อัตโนมัติเมื่อ API เริ่มนิ่ง

export type Layer2Role = 'GUEST' | 'EDITOR' | 'ADMIN';
/// GROUP_DM = แชทกลุ่มแบบ Instagram (สร้างผ่าน POST /direct-channels ด้วย peerCoreUserIds 2-31 คน)
export type ChannelKind = 'DM' | 'GROUP' | 'COURSE' | 'VOICE' | 'GROUP_DM';
/// แฟ้มกล่องข้อความของผู้เรียก — REQUEST คำนวณสดที่หลังบ้าน ตั้งเองไม่ได้
export type InboxFolder = 'PRIMARY' | 'GENERAL' | 'HIDDEN' | 'REQUEST';
/// ค่าที่ส่งไป PATCH /channels/:id/inbox ได้ (ย้าย REQUEST ไป PRIMARY = ยอมรับคำขอ)
export type SettableInboxFolder = Exclude<InboxFolder, 'REQUEST'>;
export type AssetKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'CODE' | 'DOCUMENT' | 'ARCHIVE';
export type ReportTarget = 'REEL' | 'POST' | 'MESSAGE' | 'COMMENT' | 'USER' | 'SYSTEM';
export type NotificationKind =
  | 'REEL_LIKE'
  | 'REEL_COMMENT'
  | 'POST_COMMENT'
  | 'MENTION'
  | 'VOICE_INVITE'
  | 'FOLLOW'
  | 'REACTION'
  | 'THREAD_REPLY'
  | 'MEETING_INVITE'
  | 'CHANNEL_INVITE'
  /// มีคนรีโพสต์คลิปของฉัน (refId = reel id)
  | 'REEL_REPOST'
  /// มีคนตอบ/กดอิโมจิที่สตอรี่ของฉัน (refId = story id · payload.channelId, messageId, replyKind, emoji)
  | 'STORY_REPLY'
  /// มีคนกดใจความคิดเห็นของฉัน (refId = reel id · payload.commentId)
  | 'COMMENT_LIKE'
  /// สายที่ไม่ได้รับ (refId = message id ของบันทึกการโทร · payload.channelId, media)
  | 'MISSED_CALL';
export type ChannelRole = 'MEMBER' | 'MODERATOR';
export type ReactionTarget = 'MESSAGE' | 'POST' | 'REEL';
export type BookmarkTarget = 'POST' | 'REEL';
export type MeetingStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';

export interface Me {
  coreUserId: string;
  coreRole: string;
  // ไม่มี `faculty` — token ของ Core Hub ไม่มี claim นี้
  // (data-dictionary.md ข้อ 1.2) เดิมค่านี้มาจาก header X-Faculty
  // ของ API Gateway ที่ไม่มีอยู่จริง
  layer2Role: Layer2Role;
  storageUsedBytes: string;
  storageQuotaBytes: string;
  storageUsedPercent: number;
}

/// ชิปรีแอ็กชันหนึ่งอัน — ข้อความแชทเรียงตามอิโมจิที่ถูกกดก่อน (แบบ Discord)
/// ส่วนโพสต์/คลิปเรียงตามยอดมากไปน้อย · กดชิปซ้ำ = POST /reactions หรือ DELETE ตาม reactedByMe
export interface EmojiCount {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

/// GET /channels/:id/messages/:messageId/reactions?emoji= — ใครกดบ้าง (คนกดก่อนอยู่ก่อน)
export interface Reactor {
  coreUserId: string;
  createdAt: string;
}

export interface ReactionSummary {
  targetKind: ReactionTarget;
  targetId: string;
  totals: EmojiCount[];
  totalCount: number;
}

export interface Post {
  id: string;
  /// "" ถ้าเป็นโพสต์รูปล้วนที่ไม่ตั้งหัวข้อ
  title: string;
  /// "" ถ้าเป็นโพสต์รูปล้วน
  content: string;
  courseTag: string | null;
  authorCoreUserId: string;
  commentCount: number;
  reactions: ReactionSummary | null;
  createdAt: string;
  /// ช่องด้านล่างหลังบ้านส่งมาเสมอ — optional ในชนิดนี้ให้ฟิกซ์เจอร์เดิมยังคอมไพล์
  ///
  /// รูป/วิดีโอตามลำดับที่โพสต์ ([] ถ้าไม่มี)
  media?: PostMedia[];
  /// ผู้เรียกคอมเมนต์ได้ไหม (commentsFrom ของเจ้าของ + การบล็อก) — false = ซ่อนช่องพิมพ์
  canComment?: boolean;
}

export interface PostMedia {
  assetId: string;
  kind: 'IMAGE' | 'VIDEO';
  /// signed URL อายุ 5 นาที
  url: string;
  mimeType: string;
}

/// body ของ POST /posts — ต้องมีอย่างน้อยหนึ่งใน title · content · assetIds
export interface CreatePostBody {
  title?: string;
  content?: string;
  courseTag?: string;
  /// รูป/วิดีโอที่ commit แล้วของผู้เรียก ≤ 10 ไฟล์ ตามลำดับที่แสดง
  assetIds?: string[];
}

export interface PostComment {
  id: string;
  postId: string;
  authorCoreUserId: string;
  content: string;
  createdAt: string;
}

export interface Reel {
  id: string;
  title: string;
  caption: string | null;
  assetId: string;
  durationMs: number;
  authorCoreUserId: string;
  likeCount: number;
  viewCount: number;
  likedByMe: boolean;
  /// ความคิดเห็นทั้งหมด (ระดับบนสุด + คำตอบ ไม่นับที่ลบ) — ไม่ต้องยิง /comments ต่อคลิปอีก
  commentCount: number;
  createdAt: string;
  /// ช่องด้านล่างหลังบ้านส่งมาเสมอ — optional ในชนิดนี้ให้ฟิกซ์เจอร์เดิมยังคอมไพล์
  repostCount?: number;
  repostedByMe?: boolean;
  /// ผู้เรียกคอมเมนต์ได้ไหม (commentsFrom ของเจ้าของ + การบล็อก)
  canComment?: boolean;
}

/// ผลของ POST / DELETE /reels/:id/reposts (เรียกซ้ำได้)
export interface RepostState {
  repostCount: number;
  repostedByMe: boolean;
}

/// GET /activity/reposts — คลิปที่ฉันรีโพสต์
export interface RepostedReel extends Reel {
  targetKind: 'REEL';
  repostedAt: string;
  /// signed URL ของวิดีโอ อายุ 5 นาที
  thumbnailUrl: string | null;
}

export interface ReelComment {
  id: string;
  reelId: string;
  authorCoreUserId: string;
  content: string;
  /// null = ความคิดเห็นระดับบนสุด · มีค่า = คำตอบของความคิดเห็นนั้น (ลึกได้ชั้นเดียว)
  parentId: string | null;
  /// จำนวนคำตอบ — ขอดูด้วย GET /reels/:id/comments?parentId=<id>
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
}

/// ผลของ POST / DELETE /reels/:id/comments/:commentId/likes (เรียกซ้ำได้)
export interface CommentLike {
  likeCount: number;
  likedByMe: boolean;
}

/// GET /activity/likes — คลิปรูปเดียวกับฟีด + เวลาที่ผู้เรียกกดไลก์
export interface LikedReel extends Reel {
  targetKind: 'REEL';
  likedAt: string;
  /// signed URL ของไฟล์วิดีโอ อายุ 5 นาที — คลิปไม่มีภาพปกแยก ใช้ <video preload="metadata">
  thumbnailUrl: string | null;
}

/// GET /activity/likes?target=POST — หนึ่งแถวต่อโพสต์ (อิโมจิล่าสุดที่กด)
export interface ReactedPost {
  targetKind: 'POST';
  id: string;
  title: string;
  /// 160 ตัวอักษรแรกของเนื้อหา
  preview: string;
  authorCoreUserId: string;
  emoji: string;
  /// รูป/วิดีโอชิ้นแรกของโพสต์ (signed URL อายุ 5 นาที) · null ถ้าโพสต์ไม่มีสื่อ
  thumbnailUrl: string | null;
  thumbnailKind?: 'IMAGE' | 'VIDEO' | null;
  reactedAt: string;
}

/// GET /activity/comments — ความคิดเห็นของฉันทั้งใต้คลิปและใต้กระทู้
export interface MyComment {
  id: string;
  targetKind: 'REEL' | 'POST';
  targetId: string;
  targetTitle: string;
  /// เจ้าของคลิป/โพสต์ที่ความคิดเห็นนี้อยู่
  targetAuthorCoreUserId: string;
  content: string;
  createdAt: string;
}

/// GET /activity/media?kind=POST|REEL — โพสต์หรือคลิปของฉันเอง
export interface MyMedia {
  targetKind: 'POST' | 'REEL';
  id: string;
  title: string;
  /// คำบรรยายคลิป หรือ 160 ตัวอักษรแรกของโพสต์
  preview: string | null;
  /// คลิป = signed URL ของวิดีโอ อายุ 5 นาที · โพสต์ = null เสมอ
  thumbnailUrl: string | null;
  thumbnailKind: 'VIDEO' | 'IMAGE' | null;
  /// คลิป = ยอดไลก์ · โพสต์ = ยอดรีแอ็กชันรวม
  likeCount: number;
  commentCount: number;
  /// เฉพาะคลิป · โพสต์เป็น null
  viewCount: number | null;
  createdAt: string;
}

export type ActivityOrder = 'newest' | 'oldest';

/// query ของ /activity/likes · /comments · /media (account-history รับแค่ order)
///
/// from / to = 'YYYY-MM-DD' (หรือ ISO เต็ม) รวมทั้งวันตามเวลากรุงเทพฯ ·
/// authorCoreUserId = เจ้าของของที่ฉันไปกด/คอมเมนต์ (ใช้กับ /media ไม่ได้ — 400)
export interface ActivityFilterParams {
  page?: number;
  limit?: number;
  order?: ActivityOrder;
  from?: string;
  to?: string;
  authorCoreUserId?: string;
}

export type AccountHistoryKind =
  | 'BIO_CHANGED'
  | 'BIO_REMOVED'
  /// detail = เว็บไซต์ใหม่ · null = ลบเว็บไซต์
  | 'WEBSITE_CHANGED'
  | 'COVER_CHANGED'
  | 'COVER_REMOVED'
  | 'JOINED'
  | 'CONTENT_DELETED'
  | 'ROOM_CREATED';

/// GET /activity/account-history — จาก audit log ของผู้เรียกเท่านั้น + JOINED (เก่าสุดเสมอ)
export interface AccountHistoryItem {
  /// id ของแถว audit · JOINED = 'joined'
  id: string;
  kind: AccountHistoryKind;
  /// BIO_CHANGED = คำแนะนำตัวใหม่ · CONTENT_DELETED = 'POST' | 'REEL' | 'STORY' ·
  /// ROOM_CREATED = ชื่อห้อง (หรือชนิดห้องถ้าไม่มีชื่อ) · อื่น ๆ = null
  detail: string | null;
  createdAt: string;
}

export interface Channel {
  id: string;
  kind: ChannelKind;
  name: string | null;
  courseTag: string | null;
  maxSeats: number;
  memberCount: number;
  myRole: ChannelRole;
  unreadCount: number;
  /// คู่สนทนาของห้อง DM — null สำหรับห้องชนิดอื่น
  peerCoreUserId: string | null;
  /// สร้างห้องไว้เพื่ออะไร — null สำหรับ DM และห้องเก่าที่สร้างก่อนมีช่องนี้
  description: string | null;
  /// ผู้สร้างห้อง — null สำหรับ DM
  createdByCoreUserId: string | null;
  /// หลังบ้านตัดสินแล้วว่าผู้เรียกแก้ไข/ลบห้องนี้ได้ไหม
  canManage: boolean;
  /// ข้อความล่าสุดในไทม์ไลน์หลัก — null ถ้ายังไม่มีใครพิมพ์
  lastMessage: LastMessage | null;
  /// แฟ้มของห้องนี้ในกล่องข้อความของผู้เรียก — แยกแท็บ หลัก/ทั่วไป/คำขอ ด้วยค่านี้
  /// (GET /channels คืนทุกแฟ้มรวมกัน รวม HIDDEN — หน้าบ้านกรองเอง)
  inboxFolder: InboxFolder;
  /// ผู้เรียกปักหมุดห้องนี้ไว้เมื่อไหร่ — รายการเรียงห้องที่ปักไว้บนสุดให้แล้ว
  pinnedAt: string | null;
  /// ปิดแจ้งเตือนเรื่องข้อความของห้องนี้ (ยังนับ unreadCount ตามปกติ)
  muted: boolean;
  /// ผู้เรียก "ลบแชท" ไว้เมื่อไหร่ — ข้อความก่อนเวลานี้ไม่ถูกส่งมาอีก
  clearedAt: string | null;
  /// lastReadSeq ของคู่สนทนา (เฉพาะ DM) — message.seq ≤ ค่านี้ = "เห็นแล้ว"
  peerLastReadSeq: number | null;
  /// สมาชิกทุกคนรวมผู้เรียก เรียงตามเวลาที่เข้า (เฉพาะ GROUP_DM · ห้องอื่น null)
  memberCoreUserIds: string[] | null;
  /// ชื่อเล่นในห้องนี้ { coreUserId: ชื่อเล่น } — DM/แชทกลุ่ม · ห้องอื่นเป็น {}
  /// (optional เฉพาะในชนิดนี้เพื่อให้ฟิกซ์เจอร์เดิมยังคอมไพล์ — หลังบ้านส่งมาเสมอ)
  nicknames?: Record<string, string>;
  /// กด "ทำเครื่องหมายว่ายังไม่ได้อ่าน" ไว้ — ล้างเองเมื่อบันทึกหมุดอ่านครั้งถัดไป
  markedUnread?: boolean;
  /// คนในห้องเสียงตอนนี้ — เฉพาะห้อง VOICE (ห้องอื่น null) · หลังบ้านส่งมาเสมอ
  voiceOccupants?: VoiceOccupant[] | null;
  createdAt: string;
}

/// body ของ POST /direct-channels — ส่ง peerCoreUserId หรือ peerCoreUserIds อย่างใดอย่างหนึ่ง
export interface CreateDirectChannelBody {
  peerCoreUserId?: string;
  /// 1 คน = DM เดิม (find-or-create) · 2-31 คน = แชทกลุ่มใหม่
  peerCoreUserIds?: string[];
  /// ชื่อแชทกลุ่ม 1-80 ตัวอักษร (ไม่บังคับ)
  name?: string;
}

/// body ของ PATCH /channels/:id/inbox — อย่างน้อยหนึ่งช่อง
export interface UpdateInboxBody {
  folder?: SettableInboxFolder;
  pinned?: boolean;
  muted?: boolean;
}

/// ผลของ POST /channels/:id/clear ("ลบแชท" เฉพาะฝั่งฉัน)
export interface ClearChannelResult {
  channelId: string;
  clearedAt: string;
}

export interface LastMessage {
  /// ลำดับของข้อความ — เทียบกับ Channel.peerLastReadSeq เพื่อทำป้าย "เห็นแล้ว"
  ///
  /// หลังบ้านส่งมาเสมอ · เป็น optional เฉพาะในชนิดนี้เพราะหน้าบ้านสร้าง
  /// lastMessage ชั่วคราวเองตอนข้อความใหม่เข้ามาทาง socket (ดู withIncoming)
  seq?: number;
  /// null เมื่อส่งไฟล์แนบล้วน
  content: string | null;
  authorCoreUserId: string;
  attachmentCount: number;
  createdAt: string;
  /// บันทึกการโทร — content ของแถวนี้เป็นข้อความไทยตามมุมผู้อ่านแล้ว
  /// ("คุณเริ่มการโทรด้วยเสียง" "ไม่ได้รับสายโทรด้วยเสียง" "การโทรด้วยเสียงสิ้นสุดลงแล้ว")
  callLog?: CallLog | null;
}

/// บันทึกการโทรในแชท (Message.callLog) — ข้อความระบบ content เป็น null
///
/// ระหว่างสาย endedAt = null: กำลังเรียก → status 'MISSED' · กำลังคุย → 'ANSWERED'
/// (durationSec = null) · จบแล้ว endedAt มีค่าเสมอ · แก้ไข/ส่งต่อ/ตอบกลับไม่ได้ (400)
/// อัปเดตสดด้วย socket message:new (ตอนเริ่มโทร) และ message:updated (ทุกครั้งที่สถานะเปลี่ยน)
export interface CallLog {
  media: 'AUDIO' | 'VIDEO';
  status: 'ANSWERED' | 'MISSED' | 'DECLINED' | 'CANCELLED';
  durationSec: number | null;
  callerCoreUserId: string;
  startedAt: string;
  endedAt: string | null;
}

/// คนในห้องเสียง พร้อมไอคอนสถานะ — Channel.voiceOccupants · socket voice:occupants
export interface VoiceOccupant {
  coreUserId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  sharing: boolean;
}

/// socket voice:occupants (ส่งถึงสมาชิกทุกคนของห้อง) · ผลของ PATCH /voice-sessions/:id/participants/me
export interface VoiceOccupants {
  channelId: string;
  /// null = ไม่มีใครอยู่ในห้องเสียง
  sessionId: string | null;
  occupants: VoiceOccupant[];
}

/// body ของ PATCH /voice-sessions/:id/participants/me — ส่งเฉพาะช่องที่เปลี่ยน
/// (sharing มาจาก screen:claim / screen:release อัตโนมัติ)
export interface UpdateVoiceStateBody {
  muted?: boolean;
  deafened?: boolean;
  video?: boolean;
}

/// GET /channels/:id/members?status=online|offline — แผงสมาชิกแบบ Discord (ออนไลน์ก่อน)
export interface ChannelMemberRow {
  coreUserId: string;
  role: ChannelRole;
  nickname: string | null;
  joinedAt: string;
  /// false เสมอถ้าฝ่ายใดปิด showActivityStatus หรือบล็อกกัน
  online: boolean;
  lastActiveAt: string | null;
  inVoice: boolean;
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  /// ค่าใน AssetKind — AUDIO = ข้อความเสียง (เล่นในหน้าได้ ไม่บังคับดาวน์โหลด)
  kind: string;
  mimeType: string;
  sizeBytes: string;
}

export interface Message {
  id: string;
  seq: number;
  channelId: string;
  authorCoreUserId: string;
  content: string | null;
  attachments: MessageAttachment[];
  embed: MessageEmbed | null;
  parentId: string | null;
  replyCount: number;
  pinnedAt: string | null;
  pinnedByCoreUserId: string | null;
  clientNonce: string;
  editedAt: string | null;
  createdAt: string;
  /// ช่องด้านล่างหลังบ้านส่งมาเสมอ — เป็น optional ในชนิดนี้เพราะหน้าบ้าน
  /// สร้างข้อความชั่วคราว (optimistic) เองก่อนได้ของจริงกลับมา
  ///
  /// กล่อง "ตอบกลับ" เหนือข้อความ — null ถ้าไม่ได้ตอบใคร (ส่งด้วย replyToMessageId)
  replyTo?: MessageReplyTo | null;
  /// ส่งต่อมาจากที่อื่น — แสดงป้าย "ส่งต่อแล้ว"
  forwarded?: boolean;
  /// ข้อความนี้ตอบสตอรี่ (embed.kind = 'STORY')
  storyReply?: { kind: 'REPLY' | 'REACTION'; emoji: string | null } | null;
  /// บันทึกการโทร — null ถ้าเป็นข้อความปกติ (ดู CallLog)
  callLog?: CallLog | null;
}

/// การ์ดของโพสต์/คลิป/สตอรี่ในแชท — หลังบ้านคำนวณตอนอ่าน
///
/// ใช้ `targetId` · `refId` คือชื่อเดิม (ค่าเดียวกัน) คงไว้ให้โค้ดรุ่นก่อน
export interface MessageEmbed {
  kind: 'POST' | 'REEL' | 'STORY' | string;
  refId: string;
  targetId?: string;
  /// null เมื่อสิ่งที่แชร์ถูกลบไปแล้ว
  authorCoreUserId?: string | null;
  title?: string | null;
  preview?: string | null;
  /// signed URL อายุ 5 นาที
  thumbnailUrl?: string | null;
  thumbnailKind?: 'IMAGE' | 'VIDEO' | null;
  /// false = ถูกลบ · สตอรี่หมดอายุและไม่อยู่ในไฮไลต์ · หรือบล็อกกันกับเจ้าของ
  available?: boolean;
}

export interface MessageReplyTo {
  id: string;
  authorCoreUserId: string;
  /// 120 ตัวอักษรแรก — null ถ้าเป็นไฟล์แนบล้วนหรือถูกลบ
  preview: string | null;
  attachmentKind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | null;
  deleted: boolean;
}

/// body ร่วมของ POST /channels/:id/messages/:messageId/forwards และ POST /shares
/// — รวมแล้ว 1-20 ปลายทาง · peerCoreUserIds เปิด DM ให้อัตโนมัติ
export interface MessageTargets {
  channelIds?: string[];
  peerCoreUserIds?: string[];
}

export interface ShareBody extends MessageTargets {
  targetKind: 'POST' | 'REEL' | 'STORY';
  targetId: string;
  /// ข้อความแนบ ≤ 1000 ตัวอักษร
  message?: string;
}

/// ผลของการส่งต่อ แชร์ และตอบสตอรี่ — ลำดับ channelIds ตรงกับ messageIds
export interface DeliveryResult {
  channelIds: string[];
  messageIds: string[];
}

/// body ของ POST /stories/:id/replies — content หรือ emoji อย่างใดอย่างหนึ่ง
export interface StoryReplyBody {
  content?: string;
  emoji?: string;
}

/// GET /stories/:id/insights (เจ้าของเท่านั้น)
export interface StoryInsights {
  viewCount: number;
  replyCount: number;
  reactionCounts: Record<string, number>;
}

/// GET /activity/story-replies
export interface MyStoryReply {
  id: string;
  channelId: string;
  storyId: string;
  storyAuthorCoreUserId: string | null;
  kind: 'REPLY' | 'REACTION';
  emoji: string | null;
  content: string | null;
  story: MessageEmbed;
  createdAt: string;
}

export interface Notification {
  id: string;
  /// ค่าใน NotificationKind — กรองด้วย GET /notifications?kind=A,B ได้
  kind: string;
  refId: string;
  actorCoreUserId: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  mutual: boolean;
  /// ผู้เรียกบล็อกคนนี้ไว้ — ปุ่มโปรไฟล์ต้องเป็น "เลิกบล็อก" (หลังบ้านส่งมาเสมอ)
  blockedByMe?: boolean;
}

export interface ProfileSummary {
  coreUserId: string;
  displayName: string;
  avatarUrl: string | null;
  syncedAt: string | null;
  /// เครื่องหมายยืนยันข้างชื่อ — มาจาก layer2Role ของระบบย่อยนี้
  /// ไม่ใช่ coreRole ซึ่งเราห้ามเก็บ (Blueprint หน้า 10)
  badge: 'ADMIN' | 'STAFF' | null;
}

export interface ProfileDetail extends ProfileSummary {
  stats: {
    reelCount: number;
    postCount: number;
    followerCount: number;
    followingCount: number;
  };
  relation: Relation;
  layer2Role: string | null;
  joinedAt: string | null;
  /// คำแนะนำตัวกับรูปปก — เขียนไว้ให้ชุมชนอ่าน จึงเห็นได้ทุกคน
  bio: string | null;
  coverUrl: string | null;
  /// เว็บไซต์บนโปรไฟล์ (http/https) — หลังบ้านส่งมาเสมอ
  website?: string | null;
}

/// โปรไฟล์ของตัวเอง — เพิ่มรายการ field ที่แก้ไม่ได้
export interface MyProfile extends ProfileDetail {
  /// field ที่ Core เป็นเจ้าของ — หน้าบ้านต้องแสดงเป็นอ่านอย่างเดียว
  /// มาจากหลังบ้าน ไม่ hardcode ที่นี่ เพื่อให้ตามทันถ้ากฎเปลี่ยน
  managedByCore: string[];
}

export interface FollowEdge {
  coreUserId: string;
  createdAt: string;
}

export interface Bookmark {
  targetKind: BookmarkTarget;
  targetId: string;
  title: string | null;
  authorCoreUserId: string | null;
  createdAt: string;
}

/// คอลเลกชันของที่บันทึกไว้ — ของในคอลเลกชัน (GET /bookmark-collections/:id/items)
/// ใช้ชนิด Bookmark เดิม · ใส่ได้เฉพาะของที่บันทึกแล้ว · เลิกบันทึก = หลุดจากทุกคอลเลกชัน
export interface BookmarkCollection {
  id: string;
  name: string;
  itemCount: number;
  /// ของชิ้นล่าสุดที่ใส่ ใช้ทำภาพปก — null ถ้าว่าง
  cover: { targetKind: BookmarkTarget; targetId: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHit {
  kind: string;
  id: string;
  title: string;
  snippet: string | null;
  authorCoreUserId: string | null;
  channelId: string | null;
  createdAt: string | null;
}

export interface SearchAll {
  query: string;
  counts: { reels: number; posts: number; people: number; messages: number };
  hits: SearchHit[];
}

export interface Meeting {
  id: string;
  channelId: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  createdByCoreUserId: string;
  joinableNow: boolean;
  createdAt: string;
}

export interface IceServer {
  urls: string[];
  /// **ฟิลด์ของมาตรฐาน WebRTC (`RTCIceServer.username`) ไม่ใช่ตัวตนผู้ใช้**
  /// เป็นรหัสที่ใช้ยืนยันกับเซิร์ฟเวอร์ TURN — ชื่อต้องตรงกับที่ WebRTC
  /// กำหนดเป๊ะ ไม่งั้นเบราว์เซอร์มองข้ามแล้ว TURN ปฏิเสธการเชื่อมต่อ
  username?: string;
  credential?: string;
}

export interface VoiceSession {
  id: string;
  channelId: string;
  startedAt: string;
  participants: { coreUserId: string; joinedAt: string }[];
  maxSeats: number;
  seatsTaken: number;
}

export interface JoinVoiceResponse extends VoiceSession {
  iceServers: IceServer[];
  turnAvailable: boolean;
  maxScreenViewers: number;
}

export interface AuditLog {
  id: string;
  actorCoreUserId: string;
  actorCoreRole: string;
  action: string;
  targetKind: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SubsystemMember {
  coreUserId: string;
  layer2Role: Layer2Role;
  /// true = ผู้ดูแลตั้งด้วยมือ · false = แปลงมาจากสิทธิ์องค์กรอัตโนมัติ
  layer2RoleExplicit: boolean;
  storageUsedBytes: string;
  storageQuotaBytes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOverview {
  subsystem: string;
  standardsVersion: string;
  memberCount: number;
  reelCount: number;
  postCount: number;
  messageCount: number;
  channelCount: number;
  openReportCount: number;
  storageUsedBytes: string;
  activeVoiceSessionCount: number;
  defaultRoleMapping: Record<string, string>;
}

export interface Report {
  id: string;
  /// ค่าใน ReportTarget — SYSTEM = "รายงานปัญหา" ของแอป (targetId เก็บเป็น "app#xxxxxxxx")
  targetKind: string;
  targetId: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED' | 'REJECTED';
  reporterCoreUserId: string;
  resolvedByCoreUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface StoryItem {
  id: string;
  authorCoreUserId: string;
  kind: 'IMAGE' | 'VIDEO';
  /// signed URL อายุ 5 นาที — ถ้าโหลดไม่ขึ้นให้ดึงแถวใหม่
  mediaUrl: string;
  assetId: string;
  caption: string | null;
  viewedByMe: boolean;
  /// เจ้าของเห็นเลขจริง คนอื่นเห็น 0 เสมอ
  viewCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface StoryTray {
  authorCoreUserId: string;
  hasUnseen: boolean;
  isMe: boolean;
  stories: StoryItem[];
}

/// GET /stories/:id/viewers — แบ่งหน้าแล้ว (ใหม่ไปเก่า)
export interface StoryViewerRow {
  coreUserId: string;
  viewedAt: string;
}

/// GET /stories/archive — สตอรี่ของฉันทุกชิ้น รวมที่หมดอายุแล้ว (ใหม่ไปเก่า)
export interface StoryArchiveItem {
  id: string;
  assetId: string;
  mediaKind: 'IMAGE' | 'VIDEO';
  /// signed URL อายุ 5 นาที
  mediaUrl: string;
  caption: string | null;
  viewCount: number;
  /// true = ไม่อยู่ในแถวสตอรี่แล้ว แต่ยังอยู่ในคลังและในไฮไลต์
  isExpired: boolean;
  createdAt: string;
  expiresAt: string;
}

/// GET /profiles/:coreUserId/highlights (อาเรย์ ใหม่ไปเก่า)
export interface HighlightSummary {
  id: string;
  ownerCoreUserId: string;
  title: string;
  /// หน้าปกที่ตั้งไว้ — null = ใช้ชิ้นแรก
  coverStoryId: string | null;
  /// signed URL อายุ 5 นาที — null ถ้าไฮไลต์ว่าง
  coverMediaUrl: string | null;
  coverMediaKind: 'IMAGE' | 'VIDEO' | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HighlightItem {
  storyId: string;
  /// เริ่มที่ 0
  position: number;
  mediaKind: 'IMAGE' | 'VIDEO';
  mediaUrl: string;
  caption: string | null;
  createdAt: string;
  expiresAt: string;
}

/// GET /highlights/:id · ผลของ POST / PATCH /highlights
export interface HighlightDetail extends HighlightSummary {
  items: HighlightItem[];
}

/// GET /notes (อาเรย์) · ผลของ PUT /notes/me — โน้ตของฉันอยู่ลำดับแรกเสมอ
export interface Note {
  coreUserId: string;
  /// 1-60 ตัวอักษร
  text: string;
  /// ใครเห็น (หลังบ้านส่งมาเสมอ)
  audience?: NoteAudience;
  createdAt: string;
  expiresAt: string;
  isMe: boolean;
}

/// MUTUAL_FOLLOWERS = คนที่ติดตามกันทั้งสองทาง (ค่าเริ่มต้น) · CLOSE_FRIENDS = เฉพาะเพื่อนสนิท
export type NoteAudience = 'MUTUAL_FOLLOWERS' | 'CLOSE_FRIENDS';

/// body ของ PUT /notes/me
export interface PutNoteBody {
  text: string;
  audience?: NoteAudience;
}

/// GET /blocks · ผลของ POST /blocks — body ของ POST คือ { coreUserId }
export interface BlockRow {
  coreUserId: string;
  createdAt: string;
}

/// GET /close-friends · ผลของ PUT /close-friends/:coreUserId
export interface CloseFriend {
  coreUserId: string;
  createdAt: string;
}

/// GET /presence?ids=a,b → users
export interface PresenceUser {
  coreUserId: string;
  /// false เสมอถ้าฝ่ายใดปิด showActivityStatus หรือบล็อกกัน
  online: boolean;
  /// null ถ้าไม่เคยบันทึก ฝ่ายใดปิดแสดงสถานะ หรือบล็อกกัน
  lastActiveAt: string | null;
}

export interface PresenceResponse {
  onlineCoreUserIds: string[];
  totalOnline: number;
  /// ตามลำดับใน ?ids= (ว่างถ้าไม่ได้ส่ง ids)
  users: PresenceUser[];
}

export type NotifyAudience = 'OFF' | 'FOLLOWING' | 'EVERYONE';
export type NotifyToggle = 'OFF' | 'ON';
export type NotifyMessages = 'OFF' | 'PRIMARY' | 'PRIMARY_GENERAL';

/// GET / PATCH /me/notification-preferences
///
/// ช่อง → ชนิดแจ้งเตือนที่คุม: likes = REEL_LIKE, REACTION บนโพสต์/คลิป · comments =
/// REEL_COMMENT, POST_COMMENT · mentions = MENTION · commentLikes = COMMENT_LIKE ·
/// newFollowers = FOLLOW · reposts = REEL_REPOST · storyReplies = STORY_REPLY ·
/// groupRequests = CHANNEL_INVITE · messages = THREAD_REPLY, VOICE_INVITE, REACTION บนข้อความ
/// (ตามแฟ้มของห้อง) · messageRequests = ชนิดเดียวกันแต่มาจากห้องที่เป็นคำขอข้อความ
export interface NotificationPreferences {
  /// หยุดชั่วคราวถึงเวลานี้ (ยังเก็บลงรายการ แต่ไม่เด้ง socket) · null = ไม่ได้หยุด
  pausedUntil: string | null;
  likes: NotifyAudience;
  comments: NotifyAudience;
  mentions: NotifyAudience;
  commentLikes: NotifyToggle;
  newFollowers: NotifyToggle;
  reposts: NotifyToggle;
  storyReplies: NotifyToggle;
  messageRequests: NotifyToggle;
  groupRequests: NotifyToggle;
  messages: NotifyMessages;
}

/// body ของ PATCH /me/notification-preferences — ส่งเฉพาะช่องที่จะแก้
export type UpdateNotificationPreferencesBody = Partial<
  Omit<NotificationPreferences, 'pausedUntil'>
> & {
  /// หยุดชั่วคราวกี่นาทีนับจากตอนนี้ · null = เลิกหยุด
  pauseMinutes?: 15 | 60 | 120 | 480 | null;
};

export type CommentsFrom = 'EVERYONE' | 'FOLLOWING' | 'FOLLOWERS' | 'MUTUAL' | 'OFF';

/// GET / PATCH /me/privacy (PATCH ส่งเฉพาะช่องที่จะแก้)
export interface PrivacySettings {
  commentsFrom: CommentsFrom;
  showActivityStatus: boolean;
  showInSuggestions: boolean;
}

/// GET /me/audience-counts
export interface AudienceCounts {
  following: number;
  followers: number;
  mutual: number;
}

/// GET /follows/suggestions?page&limit (แบ่งหน้าแล้ว)
export interface Suggestion {
  coreUserId: string;
  /// คนที่ฉันติดตามซึ่งติดตามเขาอยู่ (≤ 3 ล่าสุดก่อน)
  followedBy: string[];
  followedByCount: number;
  /// ชื่อเดิมของ followedByCount
  mutualCount: number;
}

/// POST /calls/feedback (body: channelId, rating 1-5, durationSec?, kind) · GET (บุคลากร)
export interface CallFeedback {
  id: string;
  channelId: string;
  coreUserId: string;
  rating: number;
  durationSec: number | null;
  kind: 'AUDIO' | 'VIDEO';
  createdAt: string;
}

/// body ของ PUT /channels/:id/members/:coreUserId/nickname — null = ลบ
export interface SetNicknameBody {
  nickname: string | null;
}

/// ชุดอิโมจิแนะนำของแผงรีแอ็กชัน — **ไม่ใช่รายการที่หลังบ้านจำกัดอีกแล้ว**
///
/// ตั้งแต่ 29 ก.ย. 2569 หลังบ้านรับอิโมจิมาตรฐาน (RGI) ตัวไหนก็ได้หนึ่งตัว
/// รวมสีผิว ธงชาติ และลำดับ ZWJ (ดู SINGLE_EMOJI ใน
/// backend/src/modules/reactions/dto/reaction.dto.ts) — ข้อความหรืออิโมจิสองตัวติดกันได้ 400
export const ALLOWED_EMOJI = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '😠',
  '🎉',
  '🔥',
  '🙏',
  '✅',
  '❓',
  '💡',
] as const;
