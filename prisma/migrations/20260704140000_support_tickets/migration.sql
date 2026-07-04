-- Поддержка в виде тикетов: один вопрос = одно обращение со статусом
-- open/closed вместо вечного треда на пользователя. Существующая переписка
-- мигрирует в один legacy-тикет на пользователя (id = 'legacy-<userId>').

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicket_userId_lastMessageAt_idx" ON "SupportTicket"("userId", "lastMessageAt");
CREATE INDEX "SupportTicket_status_lastMessageAt_idx" ON "SupportTicket"("status", "lastMessageAt");

ALTER TABLE "SupportMessage" ADD COLUMN "ticketId" TEXT;

-- Бэкфилл: legacy-тикет на каждого пользователя с историей. Тема — первая
-- строка самого раннего сообщения; тикет остаётся open (закрыть можно из админки).
INSERT INTO "SupportTicket" ("id", "userId", "subject", "status", "createdAt", "lastMessageAt")
SELECT
  'legacy-' || "userId",
  "userId",
  left(split_part((array_agg("message" ORDER BY "createdAt"))[1], E'\n', 1), 80),
  'open',
  min("createdAt"),
  max("createdAt")
FROM "SupportMessage"
GROUP BY "userId";

UPDATE "SupportMessage" SET "ticketId" = 'legacy-' || "userId" WHERE "ticketId" IS NULL;

ALTER TABLE "SupportMessage" ALTER COLUMN "ticketId" SET NOT NULL;
ALTER TABLE "SupportMessage"
  ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId")
  REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");
-- Старый индекс (userId, authorRole, readAt) больше не нужен — счётчики идут
-- по (authorRole, readAt) и по ticketId.
DROP INDEX IF EXISTS "SupportMessage_userId_authorRole_readAt_idx";
