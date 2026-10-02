-- เปลี่ยนชื่อ index และ foreign key ให้ตรงกับชื่อคอลัมน์ใหม่
--
-- **แยกเป็น migration ที่สองโดยเจตนา** ไม่ใช่ไปต่อท้ายตัวแรก
--
-- migration ที่ลงฐานข้อมูลไปแล้วมี checksum บันทึกไว้ใน `_prisma_migrations`
-- ถ้าแก้ไฟล์เดิม Prisma จะเห็นว่า checksum ไม่ตรงแล้วปฏิเสธการ deploy ทั้งชุด
-- ทางเดียวที่จะแก้ไฟล์เดิมได้คือ `migrate reset` ซึ่ง **ลบข้อมูลทั้งฐาน**
--
-- PostgreSQL ย้าย index/constraint ตามคอลัมน์ไปเองตอน RENAME COLUMN แต่
-- **ชื่อ**ของมันยังฝังคำแบบ camelCase ไว้ ซึ่งทำให้ Prisma มองว่า schema
-- กับฐานข้อมูลไม่ตรงกัน (drift) แล้ว migration รอบหน้าจะพยายามแก้ให้เอง
--
-- คำสั่งชุดนี้ให้ `prisma migrate diff --script` เป็นคนสร้าง และตรวจแล้วว่า
-- **เป็น RENAME ล้วน ไม่มี DROP หรือ ADD แม้แต่คำสั่งเดียว**
-- (16 foreign key + 41 index)

-- RenameForeignKey
ALTER TABLE "assets" RENAME CONSTRAINT "assets_messageId_fkey" TO "assets_message_id_fkey";
-- RenameForeignKey
ALTER TABLE "channel_members" RENAME CONSTRAINT "channel_members_channelId_fkey" TO "channel_members_channel_id_fkey";
-- RenameForeignKey
ALTER TABLE "meetings" RENAME CONSTRAINT "meetings_channelId_fkey" TO "meetings_channel_id_fkey";
-- RenameForeignKey
ALTER TABLE "message_embeds" RENAME CONSTRAINT "message_embeds_messageId_fkey" TO "message_embeds_message_id_fkey";
-- RenameForeignKey
ALTER TABLE "messages" RENAME CONSTRAINT "messages_channelId_fkey" TO "messages_channel_id_fkey";
-- RenameForeignKey
ALTER TABLE "messages" RENAME CONSTRAINT "messages_parentId_fkey" TO "messages_parent_id_fkey";
-- RenameForeignKey
ALTER TABLE "post_comments" RENAME CONSTRAINT "post_comments_postId_fkey" TO "post_comments_post_id_fkey";
-- RenameForeignKey
ALTER TABLE "reel_comments" RENAME CONSTRAINT "reel_comments_reelId_fkey" TO "reel_comments_reel_id_fkey";
-- RenameForeignKey
ALTER TABLE "reel_likes" RENAME CONSTRAINT "reel_likes_reelId_fkey" TO "reel_likes_reel_id_fkey";
-- RenameForeignKey
ALTER TABLE "reel_views" RENAME CONSTRAINT "reel_views_reelId_fkey" TO "reel_views_reel_id_fkey";
-- RenameForeignKey
ALTER TABLE "reels" RENAME CONSTRAINT "reels_assetId_fkey" TO "reels_asset_id_fkey";
-- RenameForeignKey
ALTER TABLE "stories" RENAME CONSTRAINT "stories_assetId_fkey" TO "stories_asset_id_fkey";
-- RenameForeignKey
ALTER TABLE "story_views" RENAME CONSTRAINT "story_views_storyId_fkey" TO "story_views_story_id_fkey";
-- RenameForeignKey
ALTER TABLE "subsystem_members" RENAME CONSTRAINT "subsystem_members_coverAssetId_fkey" TO "subsystem_members_cover_asset_id_fkey";
-- RenameForeignKey
ALTER TABLE "voice_participants" RENAME CONSTRAINT "voice_participants_sessionId_fkey" TO "voice_participants_session_id_fkey";
-- RenameForeignKey
ALTER TABLE "voice_sessions" RENAME CONSTRAINT "voice_sessions_channelId_fkey" TO "voice_sessions_channel_id_fkey";
-- RenameIndex
ALTER INDEX "assets_objectPath_key" RENAME TO "assets_object_path_key";
-- RenameIndex
ALTER INDEX "assets_ownerUsername_createdAt_idx" RENAME TO "assets_owner_username_created_at_idx";
-- RenameIndex
ALTER INDEX "assets_status_createdAt_idx" RENAME TO "assets_status_created_at_idx";
-- RenameIndex
ALTER INDEX "audit_logs_action_createdAt_idx" RENAME TO "audit_logs_action_created_at_idx";
-- RenameIndex
ALTER INDEX "audit_logs_actorUsername_createdAt_idx" RENAME TO "audit_logs_actor_username_created_at_idx";
-- RenameIndex
ALTER INDEX "audit_logs_createdAt_idx" RENAME TO "audit_logs_created_at_idx";
-- RenameIndex
ALTER INDEX "bookmarks_username_createdAt_idx" RENAME TO "bookmarks_username_created_at_idx";
-- RenameIndex
ALTER INDEX "channels_kind_courseTag_idx" RENAME TO "channels_kind_course_tag_idx";
-- RenameIndex
ALTER INDEX "follows_followerUsername_createdAt_idx" RENAME TO "follows_follower_username_created_at_idx";
-- RenameIndex
ALTER INDEX "follows_followingUsername_createdAt_idx" RENAME TO "follows_following_username_created_at_idx";
-- RenameIndex
ALTER INDEX "meetings_channelId_startsAt_idx" RENAME TO "meetings_channel_id_starts_at_idx";
-- RenameIndex
ALTER INDEX "meetings_status_startsAt_idx" RENAME TO "meetings_status_starts_at_idx";
-- RenameIndex
ALTER INDEX "message_embeds_kind_refId_idx" RENAME TO "message_embeds_kind_ref_id_idx";
-- RenameIndex
ALTER INDEX "messages_channelId_authorUsername_clientNonce_key" RENAME TO "messages_channel_id_author_username_client_nonce_key";
-- RenameIndex
ALTER INDEX "messages_channelId_pinnedAt_idx" RENAME TO "messages_channel_id_pinned_at_idx";
-- RenameIndex
ALTER INDEX "messages_channelId_seq_idx" RENAME TO "messages_channel_id_seq_idx";
-- RenameIndex
ALTER INDEX "messages_parentId_seq_idx" RENAME TO "messages_parent_id_seq_idx";
-- RenameIndex
ALTER INDEX "notifications_username_createdAt_idx" RENAME TO "notifications_username_created_at_idx";
-- RenameIndex
ALTER INDEX "notifications_username_readAt_createdAt_idx" RENAME TO "notifications_username_read_at_created_at_idx";
-- RenameIndex
ALTER INDEX "post_comments_postId_createdAt_idx" RENAME TO "post_comments_post_id_created_at_idx";
-- RenameIndex
ALTER INDEX "posts_courseTag_createdAt_idx" RENAME TO "posts_course_tag_created_at_idx";
-- RenameIndex
ALTER INDEX "posts_createdAt_id_idx" RENAME TO "posts_created_at_id_idx";
-- RenameIndex
ALTER INDEX "reactions_targetKind_targetId_idx" RENAME TO "reactions_target_kind_target_id_idx";
-- RenameIndex
ALTER INDEX "reactions_targetKind_targetId_username_emoji_key" RENAME TO "reactions_target_kind_target_id_username_emoji_key";
-- RenameIndex
ALTER INDEX "reactions_username_createdAt_idx" RENAME TO "reactions_username_created_at_idx";
-- RenameIndex
ALTER INDEX "reel_comments_reelId_createdAt_idx" RENAME TO "reel_comments_reel_id_created_at_idx";
-- RenameIndex
ALTER INDEX "reel_likes_username_createdAt_idx" RENAME TO "reel_likes_username_created_at_idx";
-- RenameIndex
ALTER INDEX "reel_views_username_viewedAt_idx" RENAME TO "reel_views_username_viewed_at_idx";
-- RenameIndex
ALTER INDEX "reels_assetId_key" RENAME TO "reels_asset_id_key";
-- RenameIndex
ALTER INDEX "reels_authorUsername_createdAt_idx" RENAME TO "reels_author_username_created_at_idx";
-- RenameIndex
ALTER INDEX "reels_createdAt_id_idx" RENAME TO "reels_created_at_id_idx";
-- RenameIndex
ALTER INDEX "reports_reporterUsername_targetKind_targetId_key" RENAME TO "reports_reporter_username_target_kind_target_id_key";
-- RenameIndex
ALTER INDEX "reports_status_createdAt_idx" RENAME TO "reports_status_created_at_idx";
-- RenameIndex
ALTER INDEX "stories_assetId_key" RENAME TO "stories_asset_id_key";
-- RenameIndex
ALTER INDEX "stories_authorUsername_createdAt_idx" RENAME TO "stories_author_username_created_at_idx";
-- RenameIndex
ALTER INDEX "stories_expiresAt_idx" RENAME TO "stories_expires_at_idx";
-- RenameIndex
ALTER INDEX "subsystem_members_coverAssetId_key" RENAME TO "subsystem_members_cover_asset_id_key";
-- RenameIndex
ALTER INDEX "subsystem_members_layer2Role_idx" RENAME TO "subsystem_members_layer2_role_idx";
-- RenameIndex
ALTER INDEX "voice_participants_sessionId_idx" RENAME TO "voice_participants_session_id_idx";
-- RenameIndex
ALTER INDEX "voice_participants_username_joinedAt_idx" RENAME TO "voice_participants_username_joined_at_idx";
-- RenameIndex
ALTER INDEX "voice_sessions_channelId_startedAt_idx" RENAME TO "voice_sessions_channel_id_started_at_idx";
