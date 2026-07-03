-- Партиционирование высокообъёмных таблиц карты ордеров по дням.
--
-- Зачем: ретеншн через DELETE на десятках миллионов строк = мёртвые кортежи,
-- распухшие индексы, WAL и износ SSD (120 ГБ). С дневными партициями чистка —
-- мгновенный DROP TABLE партиции, ноль bloat'а.
--
-- Что меняется:
--  * ObSnapshot / ObTrade / ObFootprint / ObBigTrade -> PARTITION BY RANGE (t),
--    партиция = день, плюс DEFAULT-партиция как страховка.
--  * PRIMARY KEY (id) убран: у партиционированной таблицы PK обязан включать
--    ключ партиционирования, а по id никто не ищет (append-only + range-сканы).
--    Сам столбец id и его sequence сохраняются (Prisma-модель не меняется).
--  * Дублирующий индекс (symbol, t) не переносится: (symbol, exchange, t)
--    обслуживает те же запросы по префиксу, а партиции сужают t сами.
--  * Функции обслуживания: ob_ensure_partitions (создание партиций вперёд,
--    зовёт collector каждый час) и ob_drop_partitions_before (ретеншн/purge).
--
-- ВНИМАНИЕ: миграция копирует данные четырёх таблиц (INSERT..SELECT). На время
-- применения нужен свободный диск ~= их суммарный размер; на большой истории
-- это минуты работы при старте контейнера app.

-- === Функции обслуживания ===

-- Создать дневные партиции на days_ahead дней вперёд (включая сегодня).
-- Ошибки по отдельным дням (например, конфликт с непустой DEFAULT-партицией)
-- не валят остальные — только NOTICE в лог.
CREATE OR REPLACE FUNCTION ob_ensure_partitions(tbl text, days_ahead int DEFAULT 7)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE d date;
BEGIN
  d := current_date;
  WHILE d <= current_date + days_ahead LOOP
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        tbl || '_p' || to_char(d, 'YYYYMMDD'), tbl, d, d + 1
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'ob_ensure_partitions % %: %', tbl, d, SQLERRM;
    END;
    d := d + 1;
  END LOOP;
END $fn$;

-- Сбросить партиции, целиком лежащие раньше cutoff (DEFAULT не трогаем).
-- Возвращает число удалённых партиций.
CREATE OR REPLACE FUNCTION ob_drop_partitions_before(tbl text, cutoff timestamptz)
RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE
  part record;
  dropped int := 0;
  hi timestamptz;
BEGIN
  FOR part IN
    SELECT c.oid::regclass::text AS nm, pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = quote_ident(tbl)::regclass
  LOOP
    IF part.bound = 'DEFAULT' THEN CONTINUE; END IF;
    -- bound: FOR VALUES FROM ('...') TO ('...')
    hi := (regexp_match(part.bound, 'TO \(''([^'']+)''\)'))[1]::timestamptz;
    IF hi IS NOT NULL AND hi <= cutoff THEN
      EXECUTE format('DROP TABLE %s', part.nm);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END $fn$;

-- Дневные партиции по диапазону данных старой таблицы + запас вперёд.
CREATE OR REPLACE FUNCTION ob_create_partitions_range(tbl text, lo date, hi date)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE d date;
BEGIN
  d := lo;
  WHILE d <= hi LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      tbl || '_p' || to_char(d, 'YYYYMMDD'), tbl, d, d + 1
    );
    d := d + 1;
  END LOOP;
END $fn$;

-- === ObSnapshot ===

ALTER SEQUENCE "ObSnapshot_id_seq" OWNED BY NONE;
ALTER TABLE "ObSnapshot" RENAME TO "ObSnapshot_old";

CREATE TABLE "ObSnapshot" (
    "id" BIGINT NOT NULL DEFAULT nextval('"ObSnapshot_id_seq"'),
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "bidVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "askVol" DOUBLE PRECISION NOT NULL DEFAULT 0
) PARTITION BY RANGE ("t");
CREATE TABLE "ObSnapshot_default" PARTITION OF "ObSnapshot" DEFAULT;

DO $$
DECLARE lo date;
BEGIN
  SELECT COALESCE(min("t")::date, current_date) INTO lo FROM "ObSnapshot_old";
  PERFORM ob_create_partitions_range('ObSnapshot', lo, current_date + 7);
END $$;

INSERT INTO "ObSnapshot" SELECT * FROM "ObSnapshot_old";
DROP TABLE "ObSnapshot_old";
CREATE INDEX "ObSnapshot_symbol_exchange_t_idx" ON "ObSnapshot"("symbol", "exchange", "t");
ALTER SEQUENCE "ObSnapshot_id_seq" OWNED BY "ObSnapshot"."id";

-- === ObTrade ===

ALTER SEQUENCE "ObTrade_id_seq" OWNED BY NONE;
ALTER TABLE "ObTrade" RENAME TO "ObTrade_old";

CREATE TABLE "ObTrade" (
    "id" BIGINT NOT NULL DEFAULT nextval('"ObTrade_id_seq"'),
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0
) PARTITION BY RANGE ("t");
CREATE TABLE "ObTrade_default" PARTITION OF "ObTrade" DEFAULT;

DO $$
DECLARE lo date;
BEGIN
  SELECT COALESCE(min("t")::date, current_date) INTO lo FROM "ObTrade_old";
  PERFORM ob_create_partitions_range('ObTrade', lo, current_date + 7);
END $$;

INSERT INTO "ObTrade" SELECT * FROM "ObTrade_old";
DROP TABLE "ObTrade_old";
CREATE INDEX "ObTrade_symbol_exchange_t_idx" ON "ObTrade"("symbol", "exchange", "t");
ALTER SEQUENCE "ObTrade_id_seq" OWNED BY "ObTrade"."id";

-- === ObFootprint ===

ALTER SEQUENCE "ObFootprint_id_seq" OWNED BY NONE;
ALTER TABLE "ObFootprint" RENAME TO "ObFootprint_old";

CREATE TABLE "ObFootprint" (
    "id" BIGINT NOT NULL DEFAULT nextval('"ObFootprint_id_seq"'),
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0
) PARTITION BY RANGE ("t");
CREATE TABLE "ObFootprint_default" PARTITION OF "ObFootprint" DEFAULT;

DO $$
DECLARE lo date;
BEGIN
  SELECT COALESCE(min("t")::date, current_date) INTO lo FROM "ObFootprint_old";
  PERFORM ob_create_partitions_range('ObFootprint', lo, current_date + 7);
END $$;

INSERT INTO "ObFootprint" SELECT * FROM "ObFootprint_old";
DROP TABLE "ObFootprint_old";
CREATE INDEX "ObFootprint_symbol_exchange_t_idx" ON "ObFootprint"("symbol", "exchange", "t");
ALTER SEQUENCE "ObFootprint_id_seq" OWNED BY "ObFootprint"."id";

-- === ObBigTrade ===

ALTER SEQUENCE "ObBigTrade_id_seq" OWNED BY NONE;
ALTER TABLE "ObBigTrade" RENAME TO "ObBigTrade_old";

CREATE TABLE "ObBigTrade" (
    "id" BIGINT NOT NULL DEFAULT nextval('"ObBigTrade_id_seq"'),
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "side" TEXT NOT NULL
) PARTITION BY RANGE ("t");
CREATE TABLE "ObBigTrade_default" PARTITION OF "ObBigTrade" DEFAULT;

DO $$
DECLARE lo date;
BEGIN
  SELECT COALESCE(min("t")::date, current_date) INTO lo FROM "ObBigTrade_old";
  PERFORM ob_create_partitions_range('ObBigTrade', lo, current_date + 7);
END $$;

INSERT INTO "ObBigTrade" SELECT * FROM "ObBigTrade_old";
DROP TABLE "ObBigTrade_old";
CREATE INDEX "ObBigTrade_symbol_exchange_t_idx" ON "ObBigTrade"("symbol", "exchange", "t");
ALTER SEQUENCE "ObBigTrade_id_seq" OWNED BY "ObBigTrade"."id";
