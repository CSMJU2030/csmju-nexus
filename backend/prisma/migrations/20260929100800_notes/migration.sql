-- โน้ตแบบ Instagram — คนละหนึ่งอัน อายุ 24 ชั่วโมง หมดอายุบังคับตอนอ่าน
CREATE TABLE "notes" (
    "core_user_id" TEXT NOT NULL,
    "text" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("core_user_id")
);

CREATE INDEX "notes_expires_at_idx" ON "notes"("expires_at");
