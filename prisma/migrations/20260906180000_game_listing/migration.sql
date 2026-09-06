-- Листинг фонда на бирже.
--
-- Генератор рынка статичен: инструменты и их параметры лежат в assets.json и
-- не меняются, иначе история перестала бы воспроизводиться. А фонды игроки
-- создают на ходу. Решение — ЗАРЕЗЕРВИРОВАННЫЕ СЛОТЫ: в справочнике заранее
-- лежат восемь инструментов (FND_SLOT_1..8) со своими параметрами, но без
-- имени и тикера; при листинге слот закрепляется за фондом и получает его
-- название. Генератор при этом не знает про фонды вообще — он как считал
-- свечи по номеру бара, так и считает.
CREATE TABLE "GameListing" (
  "id"           TEXT NOT NULL,
  "fundId"       TEXT NOT NULL,
  -- Слот из assets.json, закреплённый за этим фондом.
  "assetId"      TEXT NOT NULL,
  "ticker"       TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  -- Сколько акций выпущено и сколько из них ещё у фонда.
  "totalShares"  DOUBLE PRECISION NOT NULL,
  "sharesSold"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "listedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameListing_fundId_key" ON "GameListing"("fundId");
CREATE UNIQUE INDEX "GameListing_assetId_key" ON "GameListing"("assetId");
CREATE UNIQUE INDEX "GameListing_ticker_key" ON "GameListing"("ticker");
ALTER TABLE "GameListing" ADD CONSTRAINT "GameListing_fundId_fkey"
  FOREIGN KEY ("fundId") REFERENCES "GameFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
