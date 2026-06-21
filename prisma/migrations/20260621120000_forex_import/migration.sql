-- ExchangeAccount: data-source dimension + nullable API keys for imported sources
ALTER TABLE "ExchangeAccount" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'exchange';
ALTER TABLE "ExchangeAccount" ADD COLUMN     "accountCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "ExchangeAccount" ADD COLUMN     "assetClass" TEXT;
ALTER TABLE "ExchangeAccount" ALTER COLUMN "apiKey" DROP NOT NULL;
ALTER TABLE "ExchangeAccount" ALTER COLUMN "apiSecret" DROP NOT NULL;

-- Imported (forex / MetaTrader) closed round-trips
CREATE TABLE "ImportedTrade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'forex',
    "side" TEXT NOT NULL,
    "lots" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "contractSize" DOUBLE PRECISION NOT NULL DEFAULT 100000,
    "entryTime" TIMESTAMP(3) NOT NULL,
    "exitTime" TIMESTAMP(3) NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "swap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfit" DOUBLE PRECISION NOT NULL,
    "netPnl" DOUBLE PRECISION NOT NULL,
    "pips" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "comment" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importBatch" TEXT,

    CONSTRAINT "ImportedTrade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportedTrade_accountId_externalId_key" ON "ImportedTrade"("accountId", "externalId");
CREATE INDEX "ImportedTrade_accountId_idx" ON "ImportedTrade"("accountId");
CREATE INDEX "ImportedTrade_accountId_exitTime_idx" ON "ImportedTrade"("accountId", "exitTime");

ALTER TABLE "ImportedTrade" ADD CONSTRAINT "ImportedTrade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ExchangeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
