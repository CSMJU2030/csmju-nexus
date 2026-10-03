-- AlterTable
ALTER TABLE "subsystem_members" ADD COLUMN     "bio" VARCHAR(300),
ADD COLUMN     "coverAssetId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subsystem_members_coverAssetId_key" ON "subsystem_members"("coverAssetId");

-- AddForeignKey
ALTER TABLE "subsystem_members" ADD CONSTRAINT "subsystem_members_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

