-- Диета индексов таблиц котировок — продолжение orderflow_index_diet, который
-- в своё время вычистил такие же дубли у Ob*Rollup, но до форекса и свечей не
-- дошёл.
--
-- Замер на живой базе перед правкой (845 876 строк ObCandle, 243 655 FxCandle):
--
--   таблица  | данные | индексы   ← индексы БОЛЬШЕ самих данных
--   ObCandle | 96 MB  | 115 MB
--   FxCandle | 24 MB  | 27 MB
--
-- Причина — индексы, повторяющие первичный ключ колонка в колонку:
--
--   ObCandle_symbol_exchange_interval_t_idx  49 MB  = ObCandle_pkey
--   FxCandle_symbol_exchange_interval_t_idx  12 MB  = FxCandle_pkey
--   FxQuote_symbol_exchange_t_idx                   = FxQuote_pkey
--   FxDepthRollup_symbol_exchange_bucket_idx        = префикс FxDepthRollup_pkey
--
-- Ненулевые idx_scan у них были только потому, что планировщик выбирает любой
-- из двух одинаковых: после удаления всё уходит в PK, планы не меняются.
--
-- Помимо места это лишняя запись на КАЖДУЮ вставку, а ObCandle переписывается
-- каждую минуту по всем символам и таймфреймам (ON CONFLICT DO UPDATE на
-- формирующейся свече) — то есть это самая частая запись после стакана.
--
-- DROP INDEX без CONCURRENTLY здесь безопасен: он берёт ACCESS EXCLUSIVE лишь
-- на время удаления записи в каталоге (миллисекунды), в отличие от CREATE,
-- который читает всю таблицу. Prisma заворачивает миграцию в транзакцию, и
-- CONCURRENTLY внутри неё всё равно невозможен.

DROP INDEX IF EXISTS "ObCandle_symbol_exchange_interval_t_idx";
DROP INDEX IF EXISTS "FxCandle_symbol_exchange_interval_t_idx";
DROP INDEX IF EXISTS "FxQuote_symbol_exchange_t_idx";
DROP INDEX IF EXISTS "FxDepthRollup_symbol_exchange_bucket_idx";
