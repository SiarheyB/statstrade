-- Журнал скачиваний советника MT5. См. /api/advisor/download и /admin/advisor.
CREATE TABLE "AdvisorDownload" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "version" TEXT,
    "bytes" INTEGER NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'unknown',
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "lang" TEXT,
    "referrer" TEXT,
    "isRepeat" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdvisorDownload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdvisorDownload_ts_idx" ON "AdvisorDownload"("ts");
CREATE INDEX "AdvisorDownload_userId_ts_idx" ON "AdvisorDownload"("userId", "ts");
