-- MFE/MAE закрытой сделки — считаются один раз и сохраняются.
--
-- Раньше это считалось в браузере: страница «Аналитика» на каждый клик
-- «Посчитать» делала до maxTrades запросов к публичному API биржи за свечами
-- и ничего не сохраняла, поэтому следующий клик повторял всё заново.
-- У закрытой сделки эти величины неизменны.

ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "mfePct" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "maePct" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "capturedPct" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "bestPrice" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "mfeAt" TIMESTAMP(3);
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "mfeAttempts" INTEGER NOT NULL DEFAULT 0;

-- Очередь расчёта: «ещё не считали и не исчерпали попытки», свежие сделки
-- первыми. Частичный индекс — строк в очереди мало относительно всей таблицы.
CREATE INDEX IF NOT EXISTS "Trade_mfe_queue_idx"
    ON "Trade" ("exitTime" DESC)
    WHERE "mfeAt" IS NULL AND "mfeAttempts" < 3;
