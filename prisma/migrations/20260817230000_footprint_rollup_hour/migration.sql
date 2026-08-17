-- Часовой уровень футпринта — вторая половина каскада (шаг 3 плана
-- ORDERFLOW_PERF_PLAN.md, §4: «та же схема нужна ObFootprintRollup»).
--
-- Кластеры на свече дневного таймфрейма собирались из пятиминутных бакетов:
-- 288 бакетов на свечу и ~105 тысяч на окно в год, помноженные на ценовые
-- уровни. Часовой уровень даёт те же суммы 12-кратно дешевле, а на свечу
-- дневного ТФ приходится ровно 24 строки.
--
-- Пятиминутный уровень остаётся полным: мелкие таймфреймы читают его.
CREATE TABLE IF NOT EXISTS "ObFootprintRollupH" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObFootprintRollupH_pkey" PRIMARY KEY ("symbol","exchange","bucket","price")
);
CREATE INDEX IF NOT EXISTS "ObFootprintRollupH_symbol_bucket_idx" ON "ObFootprintRollupH"("symbol", "bucket");
