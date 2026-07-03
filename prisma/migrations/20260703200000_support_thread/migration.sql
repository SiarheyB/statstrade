-- Превращаем SupportMessage в переписку: authorRole различает сообщения
-- пользователя и админа внутри одного треда (thread key = userId).
ALTER TABLE "SupportMessage" ADD COLUMN "authorRole" TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS "SupportMessage_userId_createdAt_idx" ON "SupportMessage"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportMessage_authorRole_readAt_idx" ON "SupportMessage"("authorRole", "readAt");
CREATE INDEX IF NOT EXISTS "SupportMessage_userId_authorRole_readAt_idx" ON "SupportMessage"("userId", "authorRole", "readAt");
