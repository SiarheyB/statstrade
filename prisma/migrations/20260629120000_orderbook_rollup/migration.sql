-- Предагрегация снапшотов стакана для heatmap/B-A. Таблицы создаются пустыми и
-- наполняются коллектором, поэтому CREATE здесь не блокирует продакшен.
--
-- ObSnapshotRollup — минутный бакет × ценовой уровень (суммы объёмов).
CREATE TABLE IF NOT EXISTS "ObSnapshotRollup" (
    "symbol"   TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket"   TIMESTAMPTZ(3) NOT NULL,
    "price"    DOUBLE PRECISION NOT NULL,
    "volSum"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bidSum"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askSum"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "ObSnapshotRollup_pkey" PRIMARY KEY ("symbol","exchange","bucket","price")
);

CREATE INDEX IF NOT EXISTS "ObSnapshotRollup_symbol_exchange_bucket_idx"
    ON "ObSnapshotRollup" ("symbol","exchange","bucket");
CREATE INDEX IF NOT EXISTS "ObSnapshotRollup_symbol_bucket_idx"
    ON "ObSnapshotRollup" ("symbol","bucket");

-- ObRollupBucket — метаданные бакета: число снапшотов (делитель) и Σ mid.
CREATE TABLE IF NOT EXISTS "ObRollupBucket" (
    "symbol"   TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bucket"   TIMESTAMPTZ(3) NOT NULL,
    "snaps"    INTEGER NOT NULL DEFAULT 0,
    "midSum"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "ObRollupBucket_pkey" PRIMARY KEY ("symbol","exchange","bucket")
);

CREATE INDEX IF NOT EXISTS "ObRollupBucket_symbol_bucket_idx"
    ON "ObRollupBucket" ("symbol","bucket");
