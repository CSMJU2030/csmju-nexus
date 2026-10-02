-- บันทึกการโทรในแชทแบบ Instagram + สถานะในห้องเสียงแบบ Discord
--
-- call_logs: หนึ่งสาย = หนึ่งข้อความระบบ (1:1 กับ messages, ลบตามข้อความ)
-- RINGING/ONGOING เป็นสถานะชั่วคราว — ค่าสุดท้ายคือ ANSWERED/MISSED/DECLINED/CANCELLED
-- ไม่มีข้อมูลเดิมให้เติม เพราะก่อนหน้านี้ไม่เคยบันทึกการโทรเลย
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ONGOING', 'ANSWERED', 'MISSED', 'DECLINED', 'CANCELLED');

CREATE TABLE "call_logs" (
    "message_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "caller_core_user_id" TEXT NOT NULL,
    "media" "CallKind" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "duration_sec" INTEGER,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("message_id")
);

CREATE INDEX "call_logs_channel_id_started_at_idx" ON "call_logs"("channel_id", "started_at" DESC);
CREATE INDEX "call_logs_status_started_at_idx" ON "call_logs"("status", "started_at");
CREATE UNIQUE INDEX "call_logs_session_id_caller_core_user_id_key" ON "call_logs"("session_id", "caller_core_user_id");

ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ไมค์/หูฟัง/กล้อง/แชร์จอ ของคนในห้องเสียง — ค่าเริ่มต้นปิดหมด ตรงกับตอนเพิ่งเข้าห้อง
ALTER TABLE "voice_participants" ADD COLUMN "deafened" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sharing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "video" BOOLEAN NOT NULL DEFAULT false;
