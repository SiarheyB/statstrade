-- Часовой и дневной уровни ленты сделок — последняя из трёх таблиц карты
-- ордеров, у которой каскада не было.
--
-- У стакана он есть (ObSnapshotRollup → H → D), у футпринта есть
-- (ObFootprintRollup → H), а дельта и CVD читали ТОЛЬКО минутный слой, на
-- каком бы таймфрейме их ни рисовали. Окно карты на 1d — 365 суток, на 1w —
-- около четырёх лет, колонок всегда 240: одна колонка шире недели складывалась
-- из минутных строк.
--
-- Замер на проде через pg_stat_statements: этот запрос давал 1690 мс в среднем
-- и 25.4 секунды суммарно за 8 часов работы СУБД — больше, чем все остальные
-- обращения к ObTrade* вместе взятые. Причём величина растёт линейно:
-- ROLLUP_RETENTION_DAYS по умолчанию 0, то есть минутный слой ленты не
-- чистится никогда.
--
-- Таблицы пустые: наполняет их коллектор (rollupTradeLevel в cascade.mjs),
-- историю разбирает порциями теми же прогонами, что и остальной каскад.
CREATE TABLE "ObTradeRollupH" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trades" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ObTradeRollupH_pkey" PRIMARY KEY ("symbol","exchange","bucket")
);
CREATE INDEX "ObTradeRollupH_symbol_bucket_idx" ON "ObTradeRollupH"("symbol", "bucket");

CREATE TABLE "ObTradeRollupD" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trades" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ObTradeRollupD_pkey" PRIMARY KEY ("symbol","exchange","bucket")
);
CREATE INDEX "ObTradeRollupD_symbol_bucket_idx" ON "ObTradeRollupD"("symbol", "bucket");
