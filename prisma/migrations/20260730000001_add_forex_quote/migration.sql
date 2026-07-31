-- Add FxQuote table for bid/ask quote data from Twelve Data
CREATE TABLE "FxQuote" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'twelvedata',
    "t" TIMESTAMPTZ(3) NOT NULL,
    "bid" DOUBLE PRECISION NOT NULL,
    "ask" DOUBLE PRECISION NOT NULL,
    "mid" DOUBLE PRECISION NOT NULL,
    "spread" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "FxQuote_pkey" PRIMARY KEY ("symbol", "exchange", "t")
);

CREATE INDEX "FxQuote_symbol_t_idx" ON "FxQuote" ("symbol", "t");
CREATE INDEX "FxQuote_symbol_exchange_t_idx" ON "FxQuote" ("symbol", "exchange", "t");