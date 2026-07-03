-- Сообщения в поддержку от пользователей (форма обратной связи).
CREATE TABLE IF NOT EXISTS "SupportMessage" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt"    TIMESTAMP(3),
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportMessage_readAt_createdAt_idx" ON "SupportMessage"("readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportMessage_createdAt_idx" ON "SupportMessage"("createdAt");
