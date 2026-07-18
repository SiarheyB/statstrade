-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "accountId" TEXT,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "level" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_import_logs_timestamp" ON "ImportLog"("timestamp");
CREATE INDEX "idx_import_logs_module" ON "ImportLog"("module");
CREATE INDEX "idx_import_logs_account_id" ON "ImportLog"("accountId");
CREATE INDEX "idx_import_logs_event_type" ON "ImportLog"("eventType");