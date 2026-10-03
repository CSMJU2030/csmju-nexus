-- ไฮไลต์บนโปรไฟล์ — ชี้ไปที่สตอรี่เดิม ไม่คัดลอกไฟล์
--
-- ใช้ได้เพราะตั้งแต่รอบนี้สตอรี่ที่หมดอายุไม่ถูกลบแล้ว (ย้ายไปอยู่ในคลังของ
-- เจ้าของ) · ลบสตอรี่ = หลุดจากทุกไฮไลต์ (CASCADE) · ลบสตอรี่หน้าปก = ปกกลับไป
-- ใช้ชิ้นแรกของไฮไลต์ (SET NULL)
CREATE TABLE "highlights" (
    "id" TEXT NOT NULL,
    "owner_core_user_id" TEXT NOT NULL,
    "title" VARCHAR(40) NOT NULL,
    "cover_story_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "highlights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "highlight_items" (
    "highlight_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "highlight_items_pkey" PRIMARY KEY ("highlight_id","story_id")
);

CREATE INDEX "highlights_owner_core_user_id_created_at_idx" ON "highlights"("owner_core_user_id", "created_at" DESC);
CREATE INDEX "highlights_cover_story_id_idx" ON "highlights"("cover_story_id");
CREATE INDEX "highlight_items_story_id_idx" ON "highlight_items"("story_id");

ALTER TABLE "highlights" ADD CONSTRAINT "highlights_cover_story_id_fkey" FOREIGN KEY ("cover_story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "highlight_items" ADD CONSTRAINT "highlight_items_highlight_id_fkey" FOREIGN KEY ("highlight_id") REFERENCES "highlights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "highlight_items" ADD CONSTRAINT "highlight_items_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
