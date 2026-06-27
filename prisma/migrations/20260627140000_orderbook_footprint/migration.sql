-- Traded volume per price bin per snapshot (footprint / cluster overlay).
CREATE TABLE "ObFootprint" (
    "id" BIGSERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObFootprint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ObFootprint_symbol_exchange_t_idx" ON "ObFootprint"("symbol", "exchange", "t");
