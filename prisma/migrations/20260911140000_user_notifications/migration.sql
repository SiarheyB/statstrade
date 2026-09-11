-- Личные уведомления пользователя для колокольчика в меню: подход цены к
-- уровню, скорый выход новости. Объявления администратора (Announcement)
-- остаются отдельно — они общие для всех, а эти адресные.
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserNotification_userId_readAt_idx" ON "UserNotification"("userId", "readAt");
CREATE INDEX "UserNotification_createdAt_idx" ON "UserNotification"("createdAt");
