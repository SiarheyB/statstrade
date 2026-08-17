-- Каскадные уровни агрегации стакана: час и сутки поверх минутного rollup
-- (шаг 3 плана ORDERFLOW_PERF_PLAN.md).
--
-- Минутный ObSnapshotRollup остаётся полным и вечным — это вся история
-- лимиток. Новые таблицы лишь заранее складывают его же суммы, чтобы старшие
-- таймфреймы не пересчитывали сотни миллионов строк на каждый показ графика:
-- окно "1d" — это 365 дней при 240 колонках, то есть 36 часов на колонку.
--
-- Наполняет их коллектор (rollupCascade), сворачивая завершившиеся периоды
-- порциями; повторная свёртка того же периода перезаписывает значения, а не
-- складывает, поэтому прогон идемпотентен и его можно гонять хоть каждый час.

CREATE TABLE IF NOT EXISTS "ObSnapshotRollupH" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bidSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObSnapshotRollupH_pkey" PRIMARY KEY ("symbol","exchange","bucket","price")
);
CREATE INDEX IF NOT EXISTS "ObSnapshotRollupH_symbol_bucket_idx" ON "ObSnapshotRollupH"("symbol", "bucket");

CREATE TABLE IF NOT EXISTS "ObSnapshotRollupD" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bidSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObSnapshotRollupD_pkey" PRIMARY KEY ("symbol","exchange","bucket","price")
);
CREATE INDEX IF NOT EXISTS "ObSnapshotRollupD_symbol_bucket_idx" ON "ObSnapshotRollupD"("symbol", "bucket");

CREATE TABLE IF NOT EXISTS "ObRollupBucketH" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "snaps" INTEGER NOT NULL DEFAULT 0,
    "midSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObRollupBucketH_pkey" PRIMARY KEY ("symbol","exchange","bucket")
);
CREATE INDEX IF NOT EXISTS "ObRollupBucketH_symbol_bucket_idx" ON "ObRollupBucketH"("symbol", "bucket");

CREATE TABLE IF NOT EXISTS "ObRollupBucketD" (
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "snaps" INTEGER NOT NULL DEFAULT 0,
    "midSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ObRollupBucketD_pkey" PRIMARY KEY ("symbol","exchange","bucket")
);
CREATE INDEX IF NOT EXISTS "ObRollupBucketD_symbol_bucket_idx" ON "ObRollupBucketD"("symbol", "bucket");
