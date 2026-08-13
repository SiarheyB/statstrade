-- LevelSetup.bsuAt — дата БСУ (бара, сформировавшего уровень). Нужна, чтобы
-- в карточке подписать «БСУ — 20.08.2026» и поставить стрелку у этого бара
-- на графике.
--
-- Таблица — срез "на сегодня" (truncate + refill при каждом пересчёте),
-- поэтому старые строки чистим вместо бэкфилла.
DELETE FROM "LevelSetup";

ALTER TABLE "LevelSetup" ADD COLUMN IF NOT EXISTS "bsuAt" TIMESTAMP(3) NOT NULL;
