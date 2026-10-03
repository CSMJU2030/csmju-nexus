-- DropIndex
DROP INDEX "messages_parentId_createdAt_idx";

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "messages_parentId_seq_idx" ON "messages"("parentId", "seq");

-- CreateIndex
CREATE INDEX "notifications_username_createdAt_idx" ON "notifications"("username", "createdAt" DESC);

