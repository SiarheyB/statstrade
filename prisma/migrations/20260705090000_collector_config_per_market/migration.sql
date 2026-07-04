-- Пороги «только крупные лимитки» раздельно для спота и фьючерсов:
-- ключ CollectorConfig становится (symbol, market). Существующие пороги
-- дублируются на оба рынка — поведение сразу после миграции не меняется.
ALTER TABLE "CollectorConfig" DROP CONSTRAINT "CollectorConfig_pkey";
ALTER TABLE "CollectorConfig" ADD COLUMN "market" TEXT NOT NULL DEFAULT 'spot';
INSERT INTO "CollectorConfig" ("symbol", "market", "minCoins", "updatedAt")
SELECT "symbol", 'futures', "minCoins", "updatedAt" FROM "CollectorConfig";
ALTER TABLE "CollectorConfig" ADD CONSTRAINT "CollectorConfig_pkey" PRIMARY KEY ("symbol", "market");
