-- Aggregated taker-trade volume per snapshot (delta / CVD panel).
CREATE TABLE "ObTrade" (
    "id" BIGSERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObTrade_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ObTrade_symbol_exchange_t_idx" ON "ObTrade"("symbol", "exchange", "t");
