-- Материализованные round-trip сделки (реконструкция из филлов, см.
-- lib/analytics/materialize.ts). Бэкафилл выполняет приложение при первом
-- обращении к /api/stats аккаунта (tradesRebuiltAt IS NULL).
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryTime" TIMESTAMP(3) NOT NULL,
    "exitTime" TIMESTAMP(3) NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION NOT NULL,
    "grossPnl" DOUBLE PRECISION NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL,
    "netPnl" DOUBLE PRECISION NOT NULL,
    "returnPct" DOUBLE PRECISION NOT NULL,
    "fillCount" INTEGER NOT NULL,
    "result" TEXT NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId")
      REFERENCES "ExchangeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Trade_accountId_exitTime_idx" ON "Trade"("accountId", "exitTime");
CREATE INDEX "Trade_accountId_symbol_market_idx" ON "Trade"("accountId", "symbol", "market");

ALTER TABLE "ExchangeAccount" ADD COLUMN "tradesRebuiltAt" TIMESTAMP(3);
