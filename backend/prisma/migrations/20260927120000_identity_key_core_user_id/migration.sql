-- คีย์ตัวตน: username -> core_user_id
--
-- **RENAME COLUMN ไม่ใช่ DROP + ADD**
--
-- `prisma migrate diff` สร้าง DROP COLUMN 25 ครั้ง + ADD COLUMN 25 ครั้ง
-- ให้ ซึ่งลบข้อมูลของผู้ใช้ทิ้งทั้งหมด จึงเขียนไฟล์นี้เองด้วยมือ
--
-- RENAME เก็บข้อมูลไว้ครบ และ PostgreSQL ย้าย index กับ constraint ที่
-- อ้างถึงคอลัมน์นั้นให้เองโดยอัตโนมัติ (ชื่อ index ยังเป็นชื่อเดิม
-- อยู่ — เปลี่ยนใน migration ถัดไป เพื่อให้ไฟล์นี้กลับด้านได้ง่าย)
--
-- ที่มา: token ของ Core Hub ไม่มี claim `username` เลย มีแต่ `sub`
-- (data-dictionary.md ข้อ 1.2) คอลัมน์ที่ชื่อ username แต่เก็บค่า sub
-- คือชื่อที่ไม่ตรงกับของที่เก็บ

-- Asset
ALTER TABLE "assets" RENAME COLUMN "owner_username" TO "owner_core_user_id";

-- AuditLog
ALTER TABLE "audit_logs" RENAME COLUMN "actor_username" TO "actor_core_user_id";

-- Bookmark
ALTER TABLE "bookmarks" RENAME COLUMN "username" TO "core_user_id";

-- ChannelMember
ALTER TABLE "channel_members" RENAME COLUMN "username" TO "core_user_id";

-- Follow
ALTER TABLE "follows" RENAME COLUMN "follower_username" TO "follower_core_user_id";
ALTER TABLE "follows" RENAME COLUMN "following_username" TO "following_core_user_id";

-- Meeting
ALTER TABLE "meetings" RENAME COLUMN "created_by_username" TO "created_by_core_user_id";

-- Message
ALTER TABLE "messages" RENAME COLUMN "author_username" TO "author_core_user_id";
ALTER TABLE "messages" RENAME COLUMN "pinned_by_username" TO "pinned_by_core_user_id";

-- Notification
ALTER TABLE "notifications" RENAME COLUMN "username" TO "core_user_id";
ALTER TABLE "notifications" RENAME COLUMN "actor_username" TO "actor_core_user_id";

-- Post
ALTER TABLE "posts" RENAME COLUMN "author_username" TO "author_core_user_id";

-- PostComment
ALTER TABLE "post_comments" RENAME COLUMN "author_username" TO "author_core_user_id";

-- ProfileCache
ALTER TABLE "profile_cache" RENAME COLUMN "username" TO "core_user_id";

-- Reaction
ALTER TABLE "reactions" RENAME COLUMN "username" TO "core_user_id";

-- Reel
ALTER TABLE "reels" RENAME COLUMN "author_username" TO "author_core_user_id";

-- ReelComment
ALTER TABLE "reel_comments" RENAME COLUMN "author_username" TO "author_core_user_id";

-- ReelLike
ALTER TABLE "reel_likes" RENAME COLUMN "username" TO "core_user_id";

-- ReelView
ALTER TABLE "reel_views" RENAME COLUMN "username" TO "core_user_id";

-- Report
ALTER TABLE "reports" RENAME COLUMN "reporter_username" TO "reporter_core_user_id";
ALTER TABLE "reports" RENAME COLUMN "resolved_by_username" TO "resolved_by_core_user_id";

-- Story
ALTER TABLE "stories" RENAME COLUMN "author_username" TO "author_core_user_id";

-- StoryView
ALTER TABLE "story_views" RENAME COLUMN "username" TO "core_user_id";

-- SubsystemMember
ALTER TABLE "subsystem_members" RENAME COLUMN "username" TO "core_user_id";

-- VoiceParticipant
ALTER TABLE "voice_participants" RENAME COLUMN "username" TO "core_user_id";

