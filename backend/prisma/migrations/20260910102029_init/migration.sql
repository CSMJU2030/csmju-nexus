-- CreateEnum
CREATE TYPE "Layer2Role" AS ENUM ('GUEST', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('DM', 'GROUP', 'COURSE', 'VOICE');

-- CreateEnum
CREATE TYPE "ChannelRole" AS ENUM ('MEMBER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'READY', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'VIDEO', 'CODE', 'DOCUMENT', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "EmbedKind" AS ENUM ('REEL', 'POST');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('REEL', 'POST', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REEL_LIKE', 'REEL_COMMENT', 'POST_COMMENT', 'MENTION', 'VOICE_INVITE');

-- CreateTable
CREATE TABLE "subsystem_members" (
    "username" TEXT NOT NULL,
    "layer2Role" "Layer2Role" NOT NULL DEFAULT 'GUEST',
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "storageQuotaBytes" BIGINT NOT NULL DEFAULT 209715200,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subsystem_members_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "profile_cache" (
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_cache_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "reels" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "assetId" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reel_likes" (
    "reelId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_likes_pkey" PRIMARY KEY ("reelId","username")
);

-- CreateTable
CREATE TABLE "reel_comments" (
    "id" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" VARCHAR(8000) NOT NULL,
    "courseTag" TEXT,
    "authorUsername" TEXT NOT NULL,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "name" TEXT,
    "courseTag" TEXT,
    "maxSeats" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_members" (
    "channelId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "ChannelRole" NOT NULL DEFAULT 'MEMBER',
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channelId","username")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "clientNonce" TEXT NOT NULL,
    "content" VARCHAR(4000),
    "channelId" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "editedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_embeds" (
    "messageId" TEXT NOT NULL,
    "kind" "EmbedKind" NOT NULL,
    "refId" TEXT NOT NULL,

    CONSTRAINT "message_embeds_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_participants" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),

    CONSTRAINT "voice_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterUsername" TEXT NOT NULL,
    "targetKind" "ReportTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUsername" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "refId" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "actorLayer1Role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subsystem_members_layer2Role_idx" ON "subsystem_members"("layer2Role");

-- CreateIndex
CREATE UNIQUE INDEX "reels_assetId_key" ON "reels"("assetId");

-- CreateIndex
CREATE INDEX "reels_createdAt_id_idx" ON "reels"("createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "reels_authorUsername_createdAt_idx" ON "reels"("authorUsername", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reel_likes_username_createdAt_idx" ON "reel_likes"("username", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reel_comments_reelId_createdAt_idx" ON "reel_comments"("reelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "posts_createdAt_id_idx" ON "posts"("createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "posts_courseTag_createdAt_idx" ON "posts"("courseTag", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "post_comments_postId_createdAt_idx" ON "post_comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "channels_kind_courseTag_idx" ON "channels"("kind", "courseTag");

-- CreateIndex
CREATE INDEX "channel_members_username_idx" ON "channel_members"("username");

-- CreateIndex
CREATE INDEX "messages_channelId_seq_idx" ON "messages"("channelId", "seq" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_channelId_authorUsername_clientNonce_key" ON "messages"("channelId", "authorUsername", "clientNonce");

-- CreateIndex
CREATE INDEX "message_embeds_kind_refId_idx" ON "message_embeds"("kind", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_objectPath_key" ON "assets"("objectPath");

-- CreateIndex
CREATE INDEX "assets_ownerUsername_createdAt_idx" ON "assets"("ownerUsername", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "assets_status_createdAt_idx" ON "assets"("status", "createdAt");

-- CreateIndex
CREATE INDEX "voice_sessions_channelId_startedAt_idx" ON "voice_sessions"("channelId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "voice_participants_sessionId_idx" ON "voice_participants"("sessionId");

-- CreateIndex
CREATE INDEX "voice_participants_username_joinedAt_idx" ON "voice_participants"("username", "joinedAt" DESC);

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporterUsername_targetKind_targetId_key" ON "reports"("reporterUsername", "targetKind", "targetId");

-- CreateIndex
CREATE INDEX "notifications_username_readAt_createdAt_idx" ON "notifications"("username", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorUsername_createdAt_idx" ON "audit_logs"("actorUsername", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "reels" ADD CONSTRAINT "reels_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reel_likes" ADD CONSTRAINT "reel_likes_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reel_comments" ADD CONSTRAINT "reel_comments_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_embeds" ADD CONSTRAINT "message_embeds_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_participants" ADD CONSTRAINT "voice_participants_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "voice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
