-- audit_logs.actor_layer1_role -> actor_core_role
--
-- "layer1_role" เป็นคำจากสถาปัตยกรรม API Gateway ที่ถูกยกเลิกไป สัญญา v1.0
-- เรียกค่านี้ว่า `core_role` (data-dictionary.md ข้อ 1.2 · กฎ DD-02)
--
-- RENAME ไม่ใช่ DROP + ADD — ประวัติการตรวจสอบย้อนหลังต้องไม่หาย

ALTER TABLE "audit_logs" RENAME COLUMN "actor_layer1_role" TO "actor_core_role";
