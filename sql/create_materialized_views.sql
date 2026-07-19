-- Materialized Views для ускорения аналитических запросов на слабом железе (4 ядра, 8 ГБ ОЗУ)
-- Создаются WITH NO DATA для экономии места при инициализации.
-- Обновляются отдельным скриптом или cron (REFRESH MATERIALIZED VIEW CONCURRENTLY ...)

-- Ежедневная агрегатa по bucket-бакетам (из ObRollupBucket)
-- Хранит суммарную статистику за день для быстрых дашбордов
CREATE MATERIALIZED VIEW IF NOT EXISTS ob_daily_rollup AS
SELECT
  DATE(bucket) AS trade_date,
  symbol,
  exchange,
  SUM(snaps) AS total_snaps,
  CASE WHEN SUM(snaps) > 0 THEN AVG(midSum / snaps) ELSE 0 END AS avg_mid_price,
  SUM(volSum) AS total_volume,
  SUM(bidSum) AS total_bid_volume,
  SUM(askSum) AS total_ask_volume,
  MAX(bucket) AS last_bucket,
  MIN(bucket) AS first_bucket
FROM "ObRollupBucket"
GROUP BY DATE(bucket), symbol, exchange
WITH NO DATA;

-- Ежедневная агрегатa по уровням цены (из ObSnapshotRollup)
-- Для тепловых карт и volume profile за день
CREATE MATERIALIZED VIEW IF NOT EXISTS ob_daily_snapshot_rollup AS
SELECT
  DATE(bucket) AS trade_date,
  symbol,
  exchange,
  price,
  SUM(volSum) AS total_volume,
  SUM(bidSum) AS total_bid_volume,
  SUM(askSum) AS total_ask_volume,
  MAX(bucket) AS last_updated
FROM "ObSnapshotRollup"
GROUP BY DATE(bucket), symbol, exchange, price
WITH NO DATA;

-- Индексы для быстрого доступа к материализованным вью
CREATE INDEX IF NOT EXISTS idx_ob_daily_rollup_date_sym_ex ON ob_daily_rollup (trade_date, symbol, exchange);
CREATE INDEX IF NOT EXISTS idx_ob_daily_snap_date_sym_ex_price ON ob_daily_snapshot_rollup (trade_date, symbol, exchange, price);