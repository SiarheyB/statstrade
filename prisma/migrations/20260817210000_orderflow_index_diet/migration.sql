-- Диета индексов rollup-таблиц карты ордеров (шаг 1 плана ORDERFLOW_PERF_PLAN.md).
--
-- Зачем: на ~190 млн строк в год индексы «Ob*Rollup» весят БОЛЬШЕ самих данных
-- (строка в heap ≈ 92 Б, индексы на неё ≈ 136 Б). При этом:
--
--  * (symbol, exchange, bucket) — точный ПРЕФИКС первичного ключа
--    (symbol, exchange, bucket, price). Он не обслуживает ни одного запроса,
--    которого не обслужил бы PK, — чистый мёртвый груз (~40 Б/строку) плюс
--    лишняя работа на каждой вставке коллектора.
--
--  * (bucket) btree нужен ровно одному запросу — DELETE ... WHERE bucket < cutoff
--    в pruneOld(). Для этого хватает BRIN: строки вставляются строго по
--    возрастанию времени (append-only по bucket), и BRIN на таких данных весит
--    килобайты вместо гигабайт (~16 Б/строку).
--
-- Данные не трогаем: вся история лимиток остаётся на месте, это только про
-- служебные структуры.
--
-- BRIN здесь НЕ создаётся: CREATE INDEX на таблице такого размера блокирует
-- вставки на минуты, а коллектор при неудачном flush теряет накопленный бакет
-- (см. flushRollup — бакет удаляется из памяти до попытки записи). Поэтому
-- BRIN создаёт сам коллектор при старте, командой CONCURRENTLY вне транзакции
-- (ensureRollupIndexes в collector/index.mjs).

-- 1. Дубли префикса PK.
DROP INDEX IF EXISTS "ObSnapshotRollup_symbol_exchange_bucket_idx";
DROP INDEX IF EXISTS "ObFootprintRollup_symbol_exchange_bucket_idx";

-- 2. btree по bucket — заменяется на BRIN (создаётся коллектором).
DROP INDEX IF EXISTS "ObSnapshotRollup_bucket_idx";
DROP INDEX IF EXISTS "ObFootprintRollup_bucket_idx";
DROP INDEX IF EXISTS "ObTradeRollup_bucket_idx";
DROP INDEX IF EXISTS "ObRollupBucket_bucket_idx";
