-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "caption" VARCHAR(300),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_views" (
    "storyId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "viewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_views_pkey" PRIMARY KEY ("storyId","username")
);

-- CreateIndex
CREATE UNIQUE INDEX "stories_assetId_key" ON "stories"("assetId");

-- CreateIndex
CREATE INDEX "stories_authorUsername_createdAt_idx" ON "stories"("authorUsername", "createdAt");

-- CreateIndex
CREATE INDEX "stories_expiresAt_idx" ON "stories"("expiresAt");

-- CreateIndex
CREATE INDEX "story_views_username_idx" ON "story_views"("username");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
