-- Индексы под выборку «Все биржи» (exchange="all"): фильтр по symbol+t без
-- exchange. Существующий индекс [symbol, exchange, t] для этого случая менее
-- эффективен (exchange в середине ключа).
--
-- ВНИМАНИЕ: ObSnapshot — высоконагруженная таблица, в которую постоянно пишет
-- collector. Обычный CREATE INDEX блокирует запись на время построения. На
-- большой таблице рекомендуется ПРЕДВАРИТЕЛЬНО создать индекс вручную без
-- блокировки, тогда команды ниже станут no-op (IF NOT EXISTS):
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "ObSnapshot_symbol_t_idx"
--     ON "ObSnapshot" ("symbol", "t");
--
-- (CONCURRENTLY нельзя выполнять внутри транзакции, поэтому в миграции Prisma
--  используется обычный CREATE INDEX IF NOT EXISTS.)

CREATE INDEX IF NOT EXISTS "ObSnapshot_symbol_t_idx" ON "ObSnapshot" ("symbol", "t");
CREATE INDEX IF NOT EXISTS "ObTrade_symbol_t_idx" ON "ObTrade" ("symbol", "t");
CREATE INDEX IF NOT EXISTS "ObFootprint_symbol_t_idx" ON "ObFootprint" ("symbol", "t");
