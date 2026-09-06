-- Боты, которые действительно торгуют и думают моделью.
--
-- Раньше счёт бота двигался «в среднем по рынку»: красивое число, за которым
-- ничего не стоит. Бот не мог ни ошибиться в конкретной бумаге, ни пересидеть
-- падение, ни выйти в кэш. Теперь у него есть деньги, позиции и настройки —
-- интеллект, стремление и глубина использования ИИ.
ALTER TABLE "GamePlayer" ADD COLUMN "botSkill" DOUBLE PRECISION;
ALTER TABLE "GamePlayer" ADD COLUMN "botRisk" DOUBLE PRECISION;
ALTER TABLE "GamePlayer" ADD COLUMN "botAiPct" INTEGER;
ALTER TABLE "GamePlayer" ADD COLUMN "botVoice" TEXT;
ALTER TABLE "GamePlayer" ADD COLUMN "botCash" DOUBLE PRECISION;
ALTER TABLE "GamePlayer" ADD COLUMN "botActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GamePlayer" ADD COLUMN "botPlan" TEXT;

CREATE TABLE "GameBotPosition" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    CONSTRAINT "GameBotPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameBotPosition_botId_idx" ON "GameBotPosition"("botId");
CREATE INDEX "GameBotPosition_assetId_idx" ON "GameBotPosition"("assetId");

ALTER TABLE "GameBotPosition" ADD CONSTRAINT "GameBotPosition_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
