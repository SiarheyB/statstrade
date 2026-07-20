-- CreateTable: ObCandle
CREATE TABLE IF NOT EXISTS "ObCandle" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "o" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "l" DOUBLE PRECISION NOT NULL,
    "c" DOUBLE PRECISION NOT NULL,
    "v" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObCandle_pkey" PRIMARY KEY ("symbol", "exchange", "interval", "t")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObCandle_symbol_exchange_interval_t_idx"
    ON "ObCandle"("symbol", "exchange", "interval", "t");