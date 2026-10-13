-- Выгрузка сделок из советника MT5: токен аккаунта (только sha256) и время
-- последней выгрузки. См. /api/mt/push и /api/accounts/[id]/push-token.
ALTER TABLE "ExchangeAccount" ADD COLUMN "pushTokenHash" TEXT;
ALTER TABLE "ExchangeAccount" ADD COLUMN "pushTokenCreatedAt" TIMESTAMP(3);
ALTER TABLE "ExchangeAccount" ADD COLUMN "lastPushAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ExchangeAccount_pushTokenHash_key" ON "ExchangeAccount"("pushTokenHash");
