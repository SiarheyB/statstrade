-- Ежечасная очистка старых rollup-бакетов (collector/index.mjs pruneOld())
-- делает DELETE ... WHERE "bucket" < NOW() - interval без фильтра по symbol —
-- существующие индексы ([symbol,exchange,bucket] / [symbol,bucket]) не могут
-- быть использованы для такого предиката, поэтому запрос был full scan
-- растущей (по умолчанию до года данных) таблицы. Добавляем отдельный индекс
-- по bucket.
CREATE INDEX "ObSnapshotRollup_bucket_idx" ON "ObSnapshotRollup" ("bucket");
CREATE INDEX "ObRollupBucket_bucket_idx" ON "ObRollupBucket" ("bucket");
