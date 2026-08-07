-- TradeDaily → TradeHourly.
--
-- Дневной агрегат в UTC не мог обслуживать экраны, которые показывают время в
-- таймзоне пользователя: один UTC-день попадает на два локальных, и пересобрать
-- его сложением готовых строк нельзя. Часовые бакеты складываются в локальный
-- день при чтении для любого сдвига, кратного часу.
--
-- Данные не переносим: агрегат целиком выводится из Trade/ImportedTrade и
-- пересобирается фоновым бэкафиллом при старте (backfillMissingTradeHourly).

DROP TABLE IF EXISTS "TradeDaily";

CREATE TABLE "TradeHourly" (
    "accountId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "netPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lossR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rTrades" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeHourly_pkey" PRIMARY KEY ("accountId","hour")
);

CREATE INDEX "TradeHourly_hour_idx" ON "TradeHourly"("hour");

ALTER TABLE "TradeHourly" ADD CONSTRAINT "TradeHourly_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ExchangeAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
