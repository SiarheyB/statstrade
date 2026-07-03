-- Серверные ошибки для админ-панели (лог + бейдж непрочитанных + ручное удаление).
CREATE TABLE IF NOT EXISTS "ErrorLog" (
    "id"        TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "path"      TEXT,
    "stack"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt"    TIMESTAMP(3),
    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ErrorLog_readAt_createdAt_idx" ON "ErrorLog"("readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");
