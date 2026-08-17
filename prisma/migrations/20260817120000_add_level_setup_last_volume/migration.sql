-- LevelSetup.lastVolume — объём (base asset) последнего закрытого дневного
-- бара. Раньше карточка доставала объём из /candles уже ПОСЛЕ раскрытия
-- (ленивая подгрузка), а его нужно показывать в свёрнутой шапке рядом с
-- "сила N" — то есть значение должно приходить сразу со списком сетапов.
--
-- Таблица — срез "на сегодня" (truncate + refill при каждом пересчёте),
-- поэтому старые строки чистим вместо бэкфилла.
DELETE FROM "LevelSetup";

ALTER TABLE "LevelSetup" ADD COLUMN IF NOT EXISTS "lastVolume" DOUBLE PRECISION;
