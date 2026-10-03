-- ข้อความแบบ Instagram: ตอบกลับ · ส่งต่อ · ตอบสตอรี่ · ชื่อเล่น · ทำเครื่องหมายยังไม่อ่าน
CREATE TYPE "StoryReplyKind" AS ENUM ('REPLY', 'REACTION');

ALTER TABLE "messages" ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reply_to_message_id" TEXT,
ADD COLUMN "story_reply_emoji" VARCHAR(32),
ADD COLUMN "story_reply_kind" "StoryReplyKind";

-- SET NULL: ข้อความที่ถูกอ้างถึงหายจริงได้ทางเดียวคือลบทั้งห้อง ซึ่งพาทุกแถวไปด้วย
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "channel_members" ADD COLUMN "marked_unread" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "nickname" VARCHAR(40);

-- ส่งต่อไฟล์แนบ = แถว asset ใหม่ที่ชี้ไฟล์เดิม (ไม่คัดลอกไบต์) object_path จึง
-- ซ้ำกันได้แล้ว · ยังต้องมีดัชนีเพื่อนับว่ายังมีแถวไหนชี้ไฟล์อยู่ก่อนลบจากที่เก็บ
-- ข้อมูลเดิมไม่ซ้ำอยู่แล้ว (เคย unique) การถอด unique จึงไม่กระทบแถวใด
DROP INDEX "assets_object_path_key";
CREATE INDEX "assets_object_path_idx" ON "assets"("object_path");

ALTER TABLE "assets" ADD COLUMN "source_asset_id" TEXT;
