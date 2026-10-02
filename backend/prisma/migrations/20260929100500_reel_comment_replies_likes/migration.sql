-- แผงความคิดเห็นแบบ Instagram: กดใจความคิดเห็นได้ และตอบกลับได้หนึ่งชั้น
--
-- ตัวนับ like_count / reply_count เก็บล่วงหน้า เพราะแผงโหลดทีละหน้า ถ้า COUNT
-- ทีละแถวจะเป็น N+1 · ความคิดเห็นเดิมทั้งหมดเป็นระดับบนสุด (parent_id = null)
-- และยังไม่มีใครกดใจ ค่าเริ่มต้น 0 จึงถูกต้องสำหรับแถวเดิมทุกแถว
ALTER TABLE "reel_comments" ADD COLUMN "like_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "parent_id" TEXT,
ADD COLUMN "reply_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "reel_comment_likes" (
    "comment_id" TEXT NOT NULL,
    "core_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_comment_likes_pkey" PRIMARY KEY ("comment_id","core_user_id")
);

CREATE INDEX "reel_comment_likes_core_user_id_created_at_idx" ON "reel_comment_likes"("core_user_id", "created_at" DESC);
CREATE INDEX "reel_comments_parent_id_created_at_idx" ON "reel_comments"("parent_id", "created_at");

-- "กิจกรรมของคุณ → ความคิดเห็น" อ่านความคิดเห็นของคนหนึ่งทั้งใต้คลิปและใต้กระทู้
CREATE INDEX "reel_comments_author_core_user_id_created_at_idx" ON "reel_comments"("author_core_user_id", "created_at" DESC);
CREATE INDEX "post_comments_author_core_user_id_created_at_idx" ON "post_comments"("author_core_user_id", "created_at" DESC);

ALTER TABLE "reel_comments" ADD CONSTRAINT "reel_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "reel_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reel_comment_likes" ADD CONSTRAINT "reel_comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "reel_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
