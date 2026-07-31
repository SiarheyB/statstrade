-- CreateTable: FxDepth (raw depth snapshots from Dukascopy bridge)
CREATE TABLE "FxDepth" (
    "id" BIGSERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'dukascopy',
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "bidVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "FxDepth_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FxDepth_symbol_t_idx" ON "FxDepth"("symbol", "t");
CREATE INDEX "FxDepth_symbol_exchange_t_idx" ON "FxDepth"("symbol", "exchange", "t");

-- CreateTable: FxCandle (OHLCV candles for forex pairs)
CREATE TABLE "FxCandle" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'dukascopy',
    "interval" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "o" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "l" DOUBLE PRECISION NOT NULL,
    "c" DOUBLE PRECISION NOT NULL,
    "v" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "FxCandle_pkey" PRIMARY KEY ("symbol", "exchange", "interval", "t")
);

CREATE INDEX "FxCandle_symbol_exchange_interval_t_idx" ON "FxCandle"("symbol", "exchange", "interval", "t");

-- CreateTable: FxDepthRollup (minute rollup of depth levels)
CREATE TABLE "FxDepthRollup" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'dukascopy',
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bidSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "FxDepthRollup_pkey" PRIMARY KEY ("symbol", "exchange", "bucket", "price")
);

CREATE INDEX "FxDepthRollup_symbol_exchange_bucket_idx" ON "FxDepthRollup"("symbol", "exchange", "bucket");
CREATE INDEX "FxDepthRollup_symbol_bucket_idx" ON "FxDepthRollup"("symbol", "bucket");

-- CreateTable: FxRollupBucket (minute bucket metadata)
CREATE TABLE "FxRollupBucket" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'dukascopy',
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "snapCount" INTEGER NOT NULL DEFAULT 0,
    "midSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "FxRollupBucket_pkey" PRIMARY KEY ("symbol", "exchange", "bucket")
);

CREATE INDEX "FxRollupBucket_symbol_bucket_idx" ON "FxRollupBucket"("symbol", "bucket");