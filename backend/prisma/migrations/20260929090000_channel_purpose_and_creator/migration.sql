-- ห้องต้องบอกได้ว่า "ใครสร้าง" และ "สร้างไว้เพื่ออะไร"
--
-- เดิมรายการห้องมีแค่ชื่อ ผู้ใช้ที่ถูกเพิ่มเข้าห้องไม่รู้ว่าห้องนี้เป็นของใคร
-- ใช้ทำอะไร และจะไปถามใครเมื่อต้องการลบหรือแก้ — ข้อมูลนี้ต้องอยู่ที่ห้อง
-- ไม่ใช่เดาเอาจากแถวสมาชิกที่เป็น MODERATOR ซึ่งเปลี่ยนมือได้
--
-- ทั้งสองคอลัมน์ NULL ได้: ห้อง DM ไม่มีผู้สร้างและไม่มีวัตถุประสงค์
-- และห้องเก่าที่สร้างก่อนหน้านี้ไม่เคยถูกถามว่าสร้างเพื่ออะไร

ALTER TABLE "channels" ADD COLUMN "description" VARCHAR(300);
ALTER TABLE "channels" ADD COLUMN "created_by_core_user_id" TEXT;

-- เติมผู้สร้างให้ห้องเก่าจากผู้ดูแลห้องคนแรกที่เข้าห้อง
-- (ChannelsService.create ใส่ผู้สร้างเป็น MODERATOR ตั้งแต่ต้น จึงตรงกับความจริง
--  สำหรับทุกห้องที่สร้างผ่าน API) ห้อง DM ไม่มีผู้สร้าง จึงข้าม
UPDATE "channels" AS c
SET "created_by_core_user_id" = first_moderator."core_user_id"
FROM (
  SELECT DISTINCT ON ("channel_id") "channel_id", "core_user_id"
  FROM "channel_members"
  WHERE "role" = 'MODERATOR'
  ORDER BY "channel_id", "joined_at" ASC
) AS first_moderator
WHERE first_moderator."channel_id" = c."id"
  AND c."kind" <> 'DM';

CREATE INDEX "channels_created_by_core_user_id_idx" ON "channels" ("created_by_core_user_id");
