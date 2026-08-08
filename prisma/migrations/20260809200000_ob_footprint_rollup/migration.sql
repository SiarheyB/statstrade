-- Rollup футпринта: 5-минутные бакеты × ценовой уровень.
--
-- Сырой ObFootprint пишется на каждый тик коллектора на каждый ценовой уровень,
-- и computeFootprint сворачивал его заново на каждый опрос orderflow (раз в 3 с
-- на клиента). Пять минут — наименьший таймфрейм графика, остальные кратны ему,
-- поэтому любой собирается из этих строк точно.

CREATE TABLE IF NOT EXISTS "ObFootprintRollup" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObFootprintRollup_pkey" PRIMARY KEY ("symbol","exchange","bucket","price")
);

CREATE INDEX IF NOT EXISTS "ObFootprintRollup_symbol_exchange_bucket_idx" ON "ObFootprintRollup"("symbol", "exchange", "bucket");
CREATE INDEX IF NOT EXISTS "ObFootprintRollup_symbol_bucket_idx" ON "ObFootprintRollup"("symbol", "bucket");
CREATE INDEX IF NOT EXISTS "ObFootprintRollup_bucket_idx" ON "ObFootprintRollup"("bucket");
