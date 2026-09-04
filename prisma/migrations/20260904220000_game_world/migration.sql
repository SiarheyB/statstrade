-- Общий слой игры-симулятора: профили игроков, фонды, займы и лента мира.
--
-- Сама симуляция рынка остаётся в браузере игрока (движок в src/engine,
-- прогресс в IndexedDB) — на сервере лежит только то, что делает мир общим:
-- кто есть кто, кто чего добился, кто кому должен и какие фонды собраны.
-- Поэтому здесь нет ни свечей, ни позиций: сервер не тикает симуляцию.
--
-- Показатели присылает клиент, то есть их теоретически можно подделать.
-- Защита распределена: рейтинг считается по достижениям, которые дороже
-- подделать, чем заработать; сервер режет неправдоподобные скачки при
-- синхронизации (src/lib/game/world.ts); деньги между игроками ходят только
-- через GameLoan/GameFundEntry, которые ведёт сервер.

CREATE TABLE "GamePlayer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "fundName" TEXT,
    "rankKey" TEXT NOT NULL DEFAULT 'retail',
    "prestige" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "equity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "peakEquity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contractsPassed" INTEGER NOT NULL DEFAULT 0,
    "bestContractPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeStyle" TEXT NOT NULL DEFAULT 'day',
    "gameDay" INTEGER NOT NULL DEFAULT 0,
    "reliability" INTEGER NOT NULL DEFAULT 100,
    "pendingPayout" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundId" TEXT,

    CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameFund" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "motto" TEXT,
    "ownerId" TEXT NOT NULL,
    "capital" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feePct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameFund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameFundEntry" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameFundEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameLoan" (
    "id" TEXT NOT NULL,
    "lenderId" TEXT,
    "borrowerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "interestPct" DOUBLE PRECISION NOT NULL,
    "dueGameDay" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offered',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenAt" TIMESTAMP(3),
    "repaidAt" TIMESTAMP(3),

    CONSTRAINT "GameLoan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameWorldEvent" (
    "id" TEXT NOT NULL,
    "playerId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameWorldEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GamePlayer_userId_key" ON "GamePlayer"("userId");
CREATE UNIQUE INDEX "GamePlayer_nickname_key" ON "GamePlayer"("nickname");
CREATE INDEX "GamePlayer_prestige_idx" ON "GamePlayer"("prestige");
CREATE INDEX "GamePlayer_lastSyncAt_idx" ON "GamePlayer"("lastSyncAt");

CREATE UNIQUE INDEX "GameFund_name_key" ON "GameFund"("name");
CREATE UNIQUE INDEX "GameFund_ownerId_key" ON "GameFund"("ownerId");
CREATE INDEX "GameFund_capital_idx" ON "GameFund"("capital");

CREATE INDEX "GameFundEntry_fundId_createdAt_idx" ON "GameFundEntry"("fundId", "createdAt");
CREATE INDEX "GameFundEntry_playerId_idx" ON "GameFundEntry"("playerId");

CREATE INDEX "GameLoan_status_createdAt_idx" ON "GameLoan"("status", "createdAt");
CREATE INDEX "GameLoan_borrowerId_idx" ON "GameLoan"("borrowerId");
CREATE INDEX "GameLoan_lenderId_idx" ON "GameLoan"("lenderId");

CREATE INDEX "GameWorldEvent_createdAt_idx" ON "GameWorldEvent"("createdAt");

ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_fundId_fkey"
    FOREIGN KEY ("fundId") REFERENCES "GameFund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GameFund" ADD CONSTRAINT "GameFund_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameFundEntry" ADD CONSTRAINT "GameFundEntry_fundId_fkey"
    FOREIGN KEY ("fundId") REFERENCES "GameFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameFundEntry" ADD CONSTRAINT "GameFundEntry_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameLoan" ADD CONSTRAINT "GameLoan_lenderId_fkey"
    FOREIGN KEY ("lenderId") REFERENCES "GamePlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GameLoan" ADD CONSTRAINT "GameLoan_borrowerId_fkey"
    FOREIGN KEY ("borrowerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameWorldEvent" ADD CONSTRAINT "GameWorldEvent_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
