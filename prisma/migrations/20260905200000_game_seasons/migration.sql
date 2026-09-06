-- Сезоны.
--
-- Вечный рейтинг мёртв для новичка: пришедший через месяц не догонит первых
-- никогда и перестаёт смотреть в таблицу вообще. Сезон длится несколько
-- недель, считает только то, что игрок сделал ЗА ЭТОТ СРОК, и заканчивается
-- — то есть даёт и повод начать, и повод вернуться к дате.
--
-- Общий прогресс (престиж, испытания, перки) сезон НЕ трогает: обнулять
-- пройденный путь — значит наказывать за то, что человек играл давно.
-- Сезонным является только зачёт доходности.
CREATE TABLE "GameSeason" (
  "id"        TEXT NOT NULL,
  -- Порядковый номер: «Сезон 3» читается лучше даты.
  "index"     INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt"    TIMESTAMP(3) NOT NULL,
  -- Проставляется, когда итоги подведены и награды разосланы.
  "closedAt"  TIMESTAMP(3),
  CONSTRAINT "GameSeason_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameSeason_index_key" ON "GameSeason"("index");
CREATE INDEX "GameSeason_endsAt_idx" ON "GameSeason"("endsAt");

-- Итог игрока за завершённый сезон. Отдельная таблица, а не поле в игроке:
-- прошлые сезоны нужно уметь показать, а не только последний.
CREATE TABLE "GameSeasonResult" (
  "id"        TEXT NOT NULL,
  "seasonId"  TEXT NOT NULL,
  "playerId"  TEXT NOT NULL,
  "rank"      INTEGER NOT NULL,
  "returnPct" DOUBLE PRECISION NOT NULL,
  "equity"    DOUBLE PRECISION NOT NULL,
  "reward"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameSeasonResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameSeasonResult_seasonId_playerId_key" ON "GameSeasonResult"("seasonId", "playerId");
CREATE INDEX "GameSeasonResult_playerId_idx" ON "GameSeasonResult"("playerId");
ALTER TABLE "GameSeasonResult" ADD CONSTRAINT "GameSeasonResult_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "GameSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSeasonResult" ADD CONSTRAINT "GameSeasonResult_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- В каком сезоне игрок сейчас и с какой эквити он в него вошёл. Зачёт —
-- рост от этой отметки, а не абсолютные деньги: иначе сезон выигрывал бы
-- тот, кто просто дольше играет.
ALTER TABLE "GamePlayer" ADD COLUMN "seasonId" TEXT;
ALTER TABLE "GamePlayer" ADD COLUMN "seasonStartEquity" DOUBLE PRECISION;
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "GameSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
