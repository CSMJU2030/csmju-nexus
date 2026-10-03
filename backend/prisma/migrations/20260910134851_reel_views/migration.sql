-- CreateTable
CREATE TABLE "reel_views" (
    "reelId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "viewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_views_pkey" PRIMARY KEY ("reelId","username")
);

-- CreateIndex
CREATE INDEX "reel_views_username_viewedAt_idx" ON "reel_views"("username", "viewedAt" DESC);

-- AddForeignKey
ALTER TABLE "reel_views" ADD CONSTRAINT "reel_views_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
