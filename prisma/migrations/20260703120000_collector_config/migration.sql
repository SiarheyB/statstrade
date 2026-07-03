-- Редактируемые настройки коллектора: порог «только крупные лимитки» в монетах
-- базового актива, по символу. Коллектор перечитывает раз в ~30с (без редеплоя).
CREATE TABLE IF NOT EXISTS "CollectorConfig" (
    "symbol"    TEXT NOT NULL,
    "minCoins"  DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollectorConfig_pkey" PRIMARY KEY ("symbol")
);

-- Дефолты: 500 BTC, 5000 ETH (можно менять из админки).
INSERT INTO "CollectorConfig" ("symbol", "minCoins", "updatedAt")
VALUES ('BTCUSDT', 500, NOW()), ('ETHUSDT', 5000, NOW())
ON CONFLICT ("symbol") DO NOTHING;
