-- ความเป็นส่วนตัว · เว็บไซต์ · ออนไลน์ล่าสุด · การตั้งค่าการแจ้งเตือน · คะแนนสาย
--
-- ค่าเริ่มต้นทุกตัวคือ "เปิด" เท่ากับ Instagram — ผู้ใช้เดิมจึงไม่เห็นพฤติกรรมเปลี่ยน
CREATE TYPE "CommentsFrom" AS ENUM ('EVERYONE', 'FOLLOWING', 'FOLLOWERS', 'MUTUAL', 'OFF');
CREATE TYPE "NotifyAudience" AS ENUM ('OFF', 'FOLLOWING', 'EVERYONE');
CREATE TYPE "NotifyMessages" AS ENUM ('OFF', 'PRIMARY', 'PRIMARY_GENERAL');
CREATE TYPE "CallKind" AS ENUM ('AUDIO', 'VIDEO');

ALTER TABLE "subsystem_members" ADD COLUMN "comments_from" "CommentsFrom" NOT NULL DEFAULT 'EVERYONE',
ADD COLUMN "last_active_at" TIMESTAMPTZ(3),
ADD COLUMN "show_activity_status" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "show_in_suggestions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "website" VARCHAR(200);

-- ไม่มีแถว = ค่าเริ่มต้นทั้งหมด จึงไม่ต้องเติมแถวให้ผู้ใช้เดิม
CREATE TABLE "notification_preferences" (
    "core_user_id" TEXT NOT NULL,
    "paused_until" TIMESTAMPTZ(3),
    "likes" "NotifyAudience" NOT NULL DEFAULT 'EVERYONE',
    "comments" "NotifyAudience" NOT NULL DEFAULT 'EVERYONE',
    "mentions" "NotifyAudience" NOT NULL DEFAULT 'EVERYONE',
    "comment_likes" BOOLEAN NOT NULL DEFAULT true,
    "new_followers" BOOLEAN NOT NULL DEFAULT true,
    "reposts" BOOLEAN NOT NULL DEFAULT true,
    "story_replies" BOOLEAN NOT NULL DEFAULT true,
    "message_requests" BOOLEAN NOT NULL DEFAULT true,
    "group_requests" BOOLEAN NOT NULL DEFAULT true,
    "messages" "NotifyMessages" NOT NULL DEFAULT 'PRIMARY_GENERAL',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("core_user_id")
);

CREATE TABLE "call_feedback" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "core_user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "duration_sec" INTEGER,
    "kind" "CallKind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "call_feedback_created_at_idx" ON "call_feedback"("created_at" DESC);
ALTER TABLE "call_feedback" ADD CONSTRAINT "call_feedback_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
