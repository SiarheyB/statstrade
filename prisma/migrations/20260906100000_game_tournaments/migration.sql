-- Турниры.
--
-- Сезон длится месяц, общий рейтинг не кончается вовсе — а игроку нужна и
-- короткая дистанция: зашёл, три дня поторговал, увидел итог. Турнир этим и
-- отличается от сезона: у него есть вход (взнос), понятный конец и призовой
-- фонд, собранный самими участниками.
--
-- Взнос — не украшение: без него турнир превращается в бесплатную лотерею,
-- где выгодно записаться и не играть. Заплатив, человек играет.
CREATE TABLE "GameTournament" (
  "id"        TEXT NOT NULL,
  "index"     INTEGER NOT NULL,
  "startsAt"  TIMESTAMP(3) NOT NULL,
  "endsAt"    TIMESTAMP(3) NOT NULL,
  "entryFee"  DOUBLE PRECISION NOT NULL,
  -- Призовой фонд копится из взносов.
  "prizePool" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "closedAt"  TIMESTAMP(3),
  CONSTRAINT "GameTournament_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameTournament_index_key" ON "GameTournament"("index");
CREATE INDEX "GameTournament_endsAt_idx" ON "GameTournament"("endsAt");

-- Участие. startEquity фиксируется в момент входа: зачёт — рост от неё, а не
-- абсолютные деньги, иначе турнир выигрывал бы самый богатый.
CREATE TABLE "GameTournamentEntry" (
  "id"           TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "playerId"     TEXT NOT NULL,
  "startEquity"  DOUBLE PRECISION NOT NULL,
  "equity"       DOUBLE PRECISION NOT NULL,
  "rank"         INTEGER,
  "reward"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "joinedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameTournamentEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameTournamentEntry_tournamentId_playerId_key"
  ON "GameTournamentEntry"("tournamentId", "playerId");
CREATE INDEX "GameTournamentEntry_playerId_idx" ON "GameTournamentEntry"("playerId");
ALTER TABLE "GameTournamentEntry" ADD CONSTRAINT "GameTournamentEntry_tournamentId_fkey"
  FOREIGN KEY ("tournamentId") REFERENCES "GameTournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameTournamentEntry" ADD CONSTRAINT "GameTournamentEntry_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
