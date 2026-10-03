-- แชร์สตอรี่เข้าแชท และ "ตอบกลับสตอรี่" — embed ชนิดใหม่ refId = stories.id
--
-- ADD VALUE แยกไฟล์เพราะค่าใหม่ของ enum ใช้ในทรานแซกชันเดียวกันไม่ได้
ALTER TYPE "EmbedKind" ADD VALUE 'STORY';
