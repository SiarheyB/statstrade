-- Минутный rollup ленты сделок + счётчик печатей в сыром ObTrade.
--
-- Дельта/CVD и «скорость ленты» агрегировали сырой ObTrade на каждый опрос
-- (фронт дёргает orderflow раз в 3 секунды), а «скорость ленты» вдобавок
-- считала COUNT(*) строк — то есть частоту опроса коллектора, а не активность
-- рынка: коллектор пишет ОДНУ строку на тик, агрегируя все сделки интервала.

ALTER TABLE "ObTrade" ADD COLUMN IF NOT EXISTS "trades" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ObTradeRollup" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trades" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ObTradeRollup_pkey" PRIMARY KEY ("symbol","exchange","bucket")
);

CREATE INDEX IF NOT EXISTS "ObTradeRollup_symbol_bucket_idx" ON "ObTradeRollup"("symbol", "bucket");
CREATE INDEX IF NOT EXISTS "ObTradeRollup_bucket_idx" ON "ObTradeRollup"("bucket");
