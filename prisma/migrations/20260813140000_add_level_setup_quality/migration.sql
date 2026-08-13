-- LevelSetup.quality / .score — метрики чистоты уровня (запилы, проколы,
-- заражённость зоны за уровнем, запас хода) и ранг сетапа, по которому в
-- выдачу отбираются лучшие N инструментов. См. src/lib/recommendations/quality.ts.
--
-- Таблица — срез "на сегодня" (truncate + refill при каждом пересчёте),
-- поэтому старые строки чистим вместо бэкфилла: у них этих метрик нет,
-- а ближайший пересчёт наполнит таблицу заново.
DELETE FROM "LevelSetup";

ALTER TABLE "LevelSetup" ADD COLUMN IF NOT EXISTS "quality" JSONB NOT NULL;
ALTER TABLE "LevelSetup" ADD COLUMN IF NOT EXISTS "score" DOUBLE PRECISION NOT NULL;
