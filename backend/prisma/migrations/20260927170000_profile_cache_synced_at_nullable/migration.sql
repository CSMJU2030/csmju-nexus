-- profile_cache.synced_at: NOT NULL DEFAULT now() -> NULL ได้
--
-- `null` = ยังไม่เคยซิงก์ชื่อจริงจาก Core Hub
--
-- เดิมทุกแถวมีค่าเสมอ (default now()) หน้าบ้านจึงไม่มีทางรู้ว่าชื่อที่เห็น
-- เป็นชื่อจริงหรือเป็นค่าที่เราเดาไว้ก่อน ทั้งที่ DTO ประกาศว่าเป็น
-- `string | null` มาตั้งแต่ต้น
--
-- แถวที่มีอยู่ถูกตั้งเป็น NULL เพราะ **ยังไม่เคยมีการซิงก์จริงเกิดขึ้นเลย**
-- (โค้ดซิงก์เดิมยิงไปที่ x-client-id/x-client-secret ซึ่งไม่มีอยู่จริง
--  และต่อให้ยิงติดก็ไม่ได้ display_name กลับมา)

ALTER TABLE "profile_cache" ALTER COLUMN "synced_at" DROP DEFAULT;
ALTER TABLE "profile_cache" ALTER COLUMN "synced_at" DROP NOT NULL;
UPDATE "profile_cache" SET "synced_at" = NULL;
