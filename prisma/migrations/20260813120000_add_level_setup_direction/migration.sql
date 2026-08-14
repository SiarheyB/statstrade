-- LevelSetup.direction — сторона сделки (long/short), следующая из bias и
-- положения уровня относительно текущей цены.
--
-- Таблица — не история, а срез "на сегодня" (truncate + refill при каждом
-- пересчёте), поэтому существующие строки просто чистим вместо бэкфилла:
-- ближайший пересчёт наполнит её заново уже с направлением.
DELETE FROM "LevelSetup";

ALTER TABLE "LevelSetup" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL;

-- Нейтральные сетапы больше не сохраняются (см. recompute.ts).
DELETE FROM "LevelSetup" WHERE "bias" = 'neutral';
