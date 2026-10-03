-- CreateEnum
CREATE TYPE "ReactionTarget" AS ENUM ('MESSAGE', 'POST', 'REEL');

-- CreateEnum
CREATE TYPE "BookmarkTarget" AS ENUM ('POST', 'REEL');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'FOLLOW';
ALTER TYPE "NotificationKind" ADD VALUE 'REACTION';
ALTER TYPE "NotificationKind" ADD VALUE 'THREAD_REPLY';
ALTER TYPE "NotificationKind" ADD VALUE 'MEETING_INVITE';
ALTER TYPE "NotificationKind" ADD VALUE 'CHANNEL_INVITE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportTarget" ADD VALUE 'COMMENT';
ALTER TYPE "ReportTarget" ADD VALUE 'USER';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "pinnedAt" TIMESTAMPTZ(3),
ADD COLUMN     "pinnedByUsername" TEXT,
ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "follows" (
    "followerUsername" TEXT NOT NULL,
    "followingUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("followerUsername","followingUsername")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "targetKind" "ReactionTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "username" TEXT NOT NULL,
    "targetKind" "BookmarkTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("username","targetKind","targetId")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "agenda" VARCHAR(4000),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdByUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follows_followingUsername_createdAt_idx" ON "follows"("followingUsername", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "follows_followerUsername_createdAt_idx" ON "follows"("followerUsername", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reactions_targetKind_targetId_idx" ON "reactions"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "reactions_username_createdAt_idx" ON "reactions"("username", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reactions_targetKind_targetId_username_emoji_key" ON "reactions"("targetKind", "targetId", "username", "emoji");

-- CreateIndex
CREATE INDEX "bookmarks_username_createdAt_idx" ON "bookmarks"("username", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "meetings_channelId_startsAt_idx" ON "meetings"("channelId", "startsAt");

-- CreateIndex
CREATE INDEX "meetings_status_startsAt_idx" ON "meetings"("status", "startsAt");

-- CreateIndex
CREATE INDEX "messages_parentId_createdAt_idx" ON "messages"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_channelId_pinnedAt_idx" ON "messages"("channelId", "pinnedAt" DESC);

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
