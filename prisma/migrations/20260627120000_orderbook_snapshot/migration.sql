-- Orderbook heatmap snapshots (written by the collector/ service).
CREATE TABLE "ObSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "bidVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askVol" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ObSnapshot_symbol_exchange_t_idx" ON "ObSnapshot"("symbol", "exchange", "t");
