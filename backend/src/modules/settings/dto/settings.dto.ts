import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import type { NotificationKind } from '../../../generated/prisma/enums.js';

export const NOTIFY_AUDIENCE = ['OFF', 'FOLLOWING', 'EVERYONE'] as const;
export const NOTIFY_MESSAGES = ['OFF', 'PRIMARY', 'PRIMARY_GENERAL'] as const;
export const COMMENTS_FROM = ['EVERYONE', 'FOLLOWING', 'FOLLOWERS', 'MUTUAL', 'OFF'] as const;
export const PAUSE_MINUTES = [15, 60, 120, 480] as const;

export type NotifyAudienceValue = (typeof NOTIFY_AUDIENCE)[number];
export type NotifyMessagesValue = (typeof NOTIFY_MESSAGES)[number];
export type CommentsFromValue = (typeof COMMENTS_FROM)[number];

/// การตั้งค่าแต่ละช่องคุมชนิดแจ้งเตือนอะไร — **รายการเดียวที่ตัดสิน** (ดู
/// NotificationPreferencesService.decide) · ชนิดที่ไม่อยู่ในนี้ปิดไม่ได้
///
///   likes            REEL_LIKE · REACTION บนโพสต์/คลิป           (OFF/FOLLOWING/EVERYONE)
///   comments         REEL_COMMENT · POST_COMMENT                 (OFF/FOLLOWING/EVERYONE)
///   mentions         MENTION (@ ในแชท และประกาศสตอรี่ใหม่)          (OFF/FOLLOWING/EVERYONE)
///   commentLikes    COMMENT_LIKE                                (OFF/ON)
///   newFollowers    FOLLOW                                      (OFF/ON)
///   reposts          REEL_REPOST                                 (OFF/ON)
///   storyReplies    STORY_REPLY                                 (OFF/ON)
///   groupRequests   CHANNEL_INVITE (ถูกเพิ่มเข้าแชทกลุ่ม/ห้อง)      (OFF/ON)
///   messages         THREAD_REPLY · VOICE_INVITE · MISSED_CALL · REACTION บนข้อความ
///                    — ตามแฟ้มของห้องนั้นในกล่องข้อความของผู้รับ:
///                    PRIMARY = เฉพาะแฟ้มหลัก · PRIMARY_GENERAL = หลัก+ทั่วไป
///                    (แฟ้มซ่อน HIDDEN ไม่แจ้งเตือนเลย)
///   messageRequests ชนิดเดียวกับ messages แต่มาจากห้องที่เป็น "คำขอข้อความ"  (OFF/ON)
///
/// MEETING_INVITE ไม่มีช่องปิด — นัดประชุมเป็นเรื่องทางการของห้องเรียน
/// ไม่มีช่องของ live video · fundraiser · วันเกิด · แชร์ตำแหน่ง · โฆษณา เพราะระบบนี้ไม่มีสิ่งเหล่านั้น
export const PREFERENCE_OF_KIND: Record<NotificationKind, string | null> = {
  REEL_LIKE: 'likes',
  REACTION: 'likes', // บนข้อความ → messages (ตัดสินจาก payload.targetKind)
  REEL_COMMENT: 'comments',
  POST_COMMENT: 'comments',
  MENTION: 'mentions',
  COMMENT_LIKE: 'commentLikes',
  FOLLOW: 'newFollowers',
  REEL_REPOST: 'reposts',
  STORY_REPLY: 'storyReplies',
  CHANNEL_INVITE: 'groupRequests',
  THREAD_REPLY: 'messages',
  VOICE_INVITE: 'messages',
  MISSED_CALL: 'messages',
  MEETING_INVITE: null,
};

export class NotificationPreferencesDto {
  @ApiProperty({ nullable: true, description: 'หยุดการแจ้งเตือนชั่วคราวถึงเวลานี้ (ยังเก็บลงรายการ แต่ไม่เด้งทาง socket)' })
  pausedUntil!: string | null;

  @ApiProperty({ enum: NOTIFY_AUDIENCE, description: 'REEL_LIKE · REACTION บนโพสต์/คลิป' })
  likes!: NotifyAudienceValue;

  @ApiProperty({ enum: NOTIFY_AUDIENCE, description: 'REEL_COMMENT · POST_COMMENT' })
  comments!: NotifyAudienceValue;

  @ApiProperty({ enum: NOTIFY_AUDIENCE, description: 'MENTION' })
  mentions!: NotifyAudienceValue;

  @ApiProperty({ enum: ['OFF', 'ON'], description: 'COMMENT_LIKE' }) commentLikes!: 'OFF' | 'ON';
  @ApiProperty({ enum: ['OFF', 'ON'], description: 'FOLLOW' }) newFollowers!: 'OFF' | 'ON';
  @ApiProperty({ enum: ['OFF', 'ON'], description: 'REEL_REPOST' }) reposts!: 'OFF' | 'ON';
  @ApiProperty({ enum: ['OFF', 'ON'], description: 'STORY_REPLY' }) storyReplies!: 'OFF' | 'ON';

  @ApiProperty({ enum: ['OFF', 'ON'], description: 'แจ้งเตือนข้อความจากห้องที่เป็นคำขอข้อความ' })
  messageRequests!: 'OFF' | 'ON';

  @ApiProperty({ enum: ['OFF', 'ON'], description: 'CHANNEL_INVITE' }) groupRequests!: 'OFF' | 'ON';

  @ApiProperty({ enum: NOTIFY_MESSAGES, description: 'THREAD_REPLY · VOICE_INVITE · MISSED_CALL · REACTION บนข้อความ ตามแฟ้มของห้อง' })
  messages!: NotifyMessagesValue;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    enum: PAUSE_MINUTES,
    nullable: true,
    description: 'หยุดชั่วคราวกี่นาทีนับจากตอนนี้ · null = เลิกหยุด',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsIn(PAUSE_MINUTES as unknown as number[], { message: 'pauseMinutes ต้องเป็น 15, 60, 120, 480 หรือ null' })
  pauseMinutes?: (typeof PAUSE_MINUTES)[number] | null;

  @ApiPropertyOptional({ enum: NOTIFY_AUDIENCE })
  @IsOptional()
  @IsIn(NOTIFY_AUDIENCE, { message: 'likes ต้องเป็น OFF, FOLLOWING หรือ EVERYONE' })
  likes?: NotifyAudienceValue;

  @ApiPropertyOptional({ enum: NOTIFY_AUDIENCE })
  @IsOptional()
  @IsIn(NOTIFY_AUDIENCE, { message: 'comments ต้องเป็น OFF, FOLLOWING หรือ EVERYONE' })
  comments?: NotifyAudienceValue;

  @ApiPropertyOptional({ enum: NOTIFY_AUDIENCE })
  @IsOptional()
  @IsIn(NOTIFY_AUDIENCE, { message: 'mentions ต้องเป็น OFF, FOLLOWING หรือ EVERYONE' })
  mentions?: NotifyAudienceValue;

  @ApiPropertyOptional({ enum: ['OFF', 'ON'] })
  @IsOptional()
  @IsIn(['OFF', 'ON'], { message: 'commentLikes ต้องเป็น OFF หรือ ON' })
  commentLikes?: 'OFF' | 'ON';

  @ApiPropertyOptional({ enum: ['OFF', 'ON'] })
  @IsOptional()
  @IsIn(['OFF', 'ON'], { message: 'newFollowers ต้องเป็น OFF หรือ ON' })
  newFollowers?: 'OFF' | 'ON';

  @ApiPropertyOptional({ enum: ['OFF', 'ON'] })
  @IsOptional()
  @IsIn(['OFF', 'ON'], { message: 'reposts ต้องเป็น OFF หรือ ON' })
  reposts?: 'OFF' | 'ON';

  @ApiPropertyOptional({ enum: ['OFF', 'ON'] })
  @IsOptional()
  @IsIn(['OFF', 'ON'], { message: 'storyReplies ต้องเป็น OFF หรือ ON' })
  storyReplies?: 'OFF' | 'ON';

  @ApiPropertyOptional({ enum: ['OFF', 'ON'] })
  @IsOptional()
  @IsIn(['OFF', 'ON'], { message: 'messageRequests ต้องเป็น OFF หรือ ON' })
  messageRequests?: 'OFF' | 'ON';

  @ApiPropertyOptional({ enum: ['OFF', 'ON'] })
  @IsOptional()
  @IsIn(['OFF', 'ON'], { message: 'groupRequests ต้องเป็น OFF หรือ ON' })
  groupRequests?: 'OFF' | 'ON';

  @ApiPropertyOptional({ enum: NOTIFY_MESSAGES })
  @IsOptional()
  @IsIn(NOTIFY_MESSAGES, { message: 'messages ต้องเป็น OFF, PRIMARY หรือ PRIMARY_GENERAL' })
  messages?: NotifyMessagesValue;
}

export class PrivacyDto {
  @ApiProperty({ enum: COMMENTS_FROM, description: 'ใครคอมเมนต์ใต้คลิป/โพสต์ของฉันได้ (เจ้าของคอมเมนต์ได้เสมอ)' })
  commentsFrom!: CommentsFromValue;

  @ApiProperty({ description: 'แสดงสถานะกิจกรรม — ปิด = ไม่เห็นของใครและไม่มีใครเห็นของเรา' })
  showActivityStatus!: boolean;

  @ApiProperty({ description: 'ให้คนอื่นเห็นเราใน "คนที่น่าติดตาม"' })
  showInSuggestions!: boolean;
}

export class UpdatePrivacyDto {
  @ApiPropertyOptional({ enum: COMMENTS_FROM })
  @IsOptional()
  @IsIn(COMMENTS_FROM, {
    message: 'commentsFrom ต้องเป็น EVERYONE, FOLLOWING, FOLLOWERS, MUTUAL หรือ OFF',
  })
  commentsFrom?: CommentsFromValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'showActivityStatus ต้องเป็น true หรือ false' })
  showActivityStatus?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'showInSuggestions ต้องเป็น true หรือ false' })
  showInSuggestions?: boolean;
}

export class AudienceCountsDto {
  @ApiProperty({ description: 'คนที่ฉันติดตาม' }) following!: number;
  @ApiProperty({ description: 'คนที่ติดตามฉัน' }) followers!: number;
  @ApiProperty({ description: 'ติดตามกันทั้งสองทาง' }) mutual!: number;
}
