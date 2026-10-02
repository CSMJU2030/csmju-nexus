-- ชนิดการแจ้งเตือนใหม่ของรอบ Instagram parity
--
--   REEL_REPOST   มีคนรีโพสต์คลิปของฉัน
--   STORY_REPLY   มีคนตอบ/กดอิโมจิที่สตอรี่ของฉัน
--   COMMENT_LIKE  มีคนกดใจความคิดเห็นของฉัน (ทำให้การตั้งค่า comment_likes มีผลจริง)
--
-- Postgres 12+ เพิ่มหลายค่าในไฟล์เดียวได้ ตราบใดที่ไม่ใช้ค่าใหม่ในทรานแซกชันเดียวกัน
ALTER TYPE "NotificationKind" ADD VALUE 'REEL_REPOST';
ALTER TYPE "NotificationKind" ADD VALUE 'STORY_REPLY';
ALTER TYPE "NotificationKind" ADD VALUE 'COMMENT_LIKE';
