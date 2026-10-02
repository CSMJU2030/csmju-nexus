-- เปลี่ยนชื่อ index ให้ตรงกับคอลัมน์ที่เพิ่งเปลี่ยนชื่อไป
--
-- แยกออกจาก migration ก่อนหน้าโดยเจตนา: PostgreSQL ย้าย index ตามคอลัมน์ให้เอง
-- ตอน RENAME COLUMN แต่ **ไม่เปลี่ยนชื่อ index ให้** ฐานข้อมูลจึงยังทำงานถูก
-- ทุกอย่างแม้ไม่มีไฟล์นี้ — มันเป็นเรื่องความสะอาดล้วน ๆ
--
-- ทุกคำสั่งเป็น ALTER INDEX ... RENAME TO ซึ่งไม่แตะข้อมูลเลย

-- RenameIndex
ALTER INDEX "assets_owner_username_created_at_idx" RENAME TO "assets_owner_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "audit_logs_actor_username_created_at_idx" RENAME TO "audit_logs_actor_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "bookmarks_username_created_at_idx" RENAME TO "bookmarks_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "channel_members_username_idx" RENAME TO "channel_members_core_user_id_idx";

-- RenameIndex
ALTER INDEX "follows_follower_username_created_at_idx" RENAME TO "follows_follower_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "follows_following_username_created_at_idx" RENAME TO "follows_following_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "messages_channel_id_author_username_client_nonce_key" RENAME TO "messages_channel_id_author_core_user_id_client_nonce_key";

-- RenameIndex
ALTER INDEX "notifications_username_created_at_idx" RENAME TO "notifications_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "notifications_username_read_at_created_at_idx" RENAME TO "notifications_core_user_id_read_at_created_at_idx";

-- RenameIndex
ALTER INDEX "reactions_target_kind_target_id_username_emoji_key" RENAME TO "reactions_target_kind_target_id_core_user_id_emoji_key";

-- RenameIndex
ALTER INDEX "reactions_username_created_at_idx" RENAME TO "reactions_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "reel_likes_username_created_at_idx" RENAME TO "reel_likes_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "reel_views_username_viewed_at_idx" RENAME TO "reel_views_core_user_id_viewed_at_idx";

-- RenameIndex
ALTER INDEX "reels_author_username_created_at_idx" RENAME TO "reels_author_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "reports_reporter_username_target_kind_target_id_key" RENAME TO "reports_reporter_core_user_id_target_kind_target_id_key";

-- RenameIndex
ALTER INDEX "stories_author_username_created_at_idx" RENAME TO "stories_author_core_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "story_views_username_idx" RENAME TO "story_views_core_user_id_idx";

-- RenameIndex
ALTER INDEX "voice_participants_username_joined_at_idx" RENAME TO "voice_participants_core_user_id_joined_at_idx";

