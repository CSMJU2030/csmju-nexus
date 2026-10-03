-- จัดกล่องข้อความแบบ Instagram — ทุกค่าเป็นของ "สมาชิกคนนั้น" ไม่ใช่ของห้อง
--
--   inbox_folder     แฟ้มที่เลือกเอง (null = ให้ระบบตัดสินหลัก/คำขอข้อความ)
--   inbox_pinned_at  ปักหมุดห้องไว้บนสุด
--   muted            ปิดแจ้งเตือนเรื่องข้อความของห้องนี้
--   cleared_at       "ลบแชท" เฉพาะฉัน — ซ่อนข้อความก่อนเวลานี้ อีกฝ่ายยังเห็นครบ
--
-- ทุกคอลัมน์ NULL ได้หรือมีค่าเริ่มต้น แถวเดิมจึงไม่ต้องเติมค่าย้อนหลัง
CREATE TYPE "InboxFolder" AS ENUM ('PRIMARY', 'GENERAL', 'HIDDEN');

ALTER TABLE "channel_members" ADD COLUMN "cleared_at" TIMESTAMPTZ(3),
ADD COLUMN "inbox_folder" "InboxFolder",
ADD COLUMN "inbox_pinned_at" TIMESTAMPTZ(3),
ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;
