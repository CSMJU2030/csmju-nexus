-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actorUsername" TEXT,
ADD COLUMN     "payload" JSONB;
