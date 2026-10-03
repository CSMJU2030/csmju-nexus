-- โพสต์มีรูป/วิดีโอ · รีโพสต์คลิป · บล็อก · เพื่อนสนิท · กลุ่มผู้ชมของโน้ต

CREATE TABLE "post_media" (
    "post_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("post_id","position")
);
CREATE UNIQUE INDEX "post_media_asset_id_key" ON "post_media"("asset_id");
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "สื่อของฉัน" และโปรไฟล์อ่านโพสต์ของคนหนึ่งเรียงตามเวลา
CREATE INDEX "posts_author_core_user_id_created_at_idx" ON "posts"("author_core_user_id", "created_at" DESC);

ALTER TABLE "reels" ADD COLUMN "repost_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "reel_reposts" (
    "reel_id" TEXT NOT NULL,
    "core_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_reposts_pkey" PRIMARY KEY ("reel_id","core_user_id")
);
CREATE INDEX "reel_reposts_core_user_id_created_at_idx" ON "reel_reposts"("core_user_id", "created_at" DESC);
ALTER TABLE "reel_reposts" ADD CONSTRAINT "reel_reposts_reel_id_fkey" FOREIGN KEY ("reel_id") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "blocks" (
    "blocker_core_user_id" TEXT NOT NULL,
    "blocked_core_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_core_user_id","blocked_core_user_id")
);
CREATE INDEX "blocks_blocked_core_user_id_idx" ON "blocks"("blocked_core_user_id");

CREATE TABLE "close_friends" (
    "owner_core_user_id" TEXT NOT NULL,
    "friend_core_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "close_friends_pkey" PRIMARY KEY ("owner_core_user_id","friend_core_user_id")
);
CREATE INDEX "close_friends_friend_core_user_id_idx" ON "close_friends"("friend_core_user_id");

-- โน้ตเดิมทั้งหมดได้ MUTUAL_FOLLOWERS ซึ่งเป็นค่าเริ่มต้นของ Instagram
CREATE TYPE "NoteAudience" AS ENUM ('MUTUAL_FOLLOWERS', 'CLOSE_FRIENDS');
ALTER TABLE "notes" ADD COLUMN "audience" "NoteAudience" NOT NULL DEFAULT 'MUTUAL_FOLLOWERS';
