-- Игровой банк.
--
-- До сих пор занять можно было только у другого игрока: пока в мире два
-- человека, занять не у кого вовсе. Банк — постоянный участник, который
-- работает всегда: выдаёт кредиты, зарабатывает на процентах, забирает залог
-- за просрочку и продаёт изъятое остальным.
--
-- Банк — один на мир (singleton), как и сам рынок.
CREATE TABLE "GameBank" (
  "id"             TEXT NOT NULL,
  -- Собственный капитал. Растёт на процентах, падает на невозвратах.
  "capital"        DOUBLE PRECISION NOT NULL,
  -- Сколько выдано и не возвращено прямо сейчас.
  "lentOut"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Привлечено по облигациям: это ДОЛГ банка перед игроками.
  "bondsIssued"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Накопленная статистика — из неё считается цена акции.
  "interestEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lossesTaken"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Всего акций выпущено; у банка они лежат в казне, пока не куплены.
  "totalShares"    INTEGER NOT NULL,
  "sharesSold"     INTEGER NOT NULL DEFAULT 0,
  "foundedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameBank_pkey" PRIMARY KEY ("id")
);

-- Кредит банка. Отличается от займа между игроками (GameLoan) залогом и
-- скорингом: у игрока-заимодавца ни того, ни другого нет.
CREATE TABLE "GameBankLoan" (
  "id"              TEXT NOT NULL,
  "playerId"        TEXT NOT NULL,
  "principal"       DOUBLE PRECISION NOT NULL,
  -- Годовая ставка, %. Считается из скоринга: чем хуже история, тем дороже.
  "ratePct"         DOUBLE PRECISION NOT NULL,
  "termDays"        INTEGER NOT NULL,
  "takenAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"           TIMESTAMP(3) NOT NULL,
  "repaidAt"        TIMESTAMP(3),
  -- active | repaid | defaulted
  "status"          TEXT NOT NULL DEFAULT 'active',
  -- Залог: предмет из магазина. null — кредит без обеспечения.
  "collateralItem"  TEXT,
  "collateralValue" DOUBLE PRECISION,
  CONSTRAINT "GameBankLoan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GameBankLoan_playerId_status_idx" ON "GameBankLoan"("playerId", "status");
CREATE INDEX "GameBankLoan_dueAt_idx" ON "GameBankLoan"("dueAt");
ALTER TABLE "GameBankLoan" ADD CONSTRAINT "GameBankLoan_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изъятое за просрочку и выставленное банком на продажу.
--
-- Банк не оставляет залог себе: ему нужны деньги, а не яхта. Продаёт со
-- скидкой — поэтому для остальных игроков это способ купить дорогую вещь
-- дешевле магазина.
CREATE TABLE "GameRepossessed" (
  "id"        TEXT NOT NULL,
  "itemId"    TEXT NOT NULL,
  "fromId"    TEXT,
  "price"     DOUBLE PRECISION NOT NULL,
  "soldToId"  TEXT,
  "soldAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameRepossessed_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GameRepossessed_soldAt_idx" ON "GameRepossessed"("soldAt");

-- Облигация банка: игрок ОДАЛЖИВАЕТ банку и получает купон.
--
-- Это единственный в игре инструмент с заранее известным результатом —
-- альтернатива торговле для тех, кто не хочет рисковать, и способ для банка
-- привлечь деньги, когда своего капитала на выдачу не хватает.
CREATE TABLE "GameBankBond" (
  "id"         TEXT NOT NULL,
  "playerId"   TEXT NOT NULL,
  "amount"     DOUBLE PRECISION NOT NULL,
  "couponPct"  DOUBLE PRECISION NOT NULL,
  "termDays"   INTEGER NOT NULL,
  "boughtAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "maturesAt"  TIMESTAMP(3) NOT NULL,
  "redeemedAt" TIMESTAMP(3),
  CONSTRAINT "GameBankBond_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GameBankBond_playerId_idx" ON "GameBankBond"("playerId");
CREATE INDEX "GameBankBond_maturesAt_idx" ON "GameBankBond"("maturesAt");
ALTER TABLE "GameBankBond" ADD CONSTRAINT "GameBankBond_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Доля игрока в акциях банка.
CREATE TABLE "GameBankShare" (
  "id"       TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "shares"   INTEGER NOT NULL DEFAULT 0,
  "avgPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "GameBankShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameBankShare_playerId_key" ON "GameBankShare"("playerId");
ALTER TABLE "GameBankShare" ADD CONSTRAINT "GameBankShare_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Вещи, изъятые у игрока: клиент забирает этот список на синхронизации и
-- убирает предметы у себя. Сервер не хранит имущество игрока — только факт
-- изъятия.
ALTER TABLE "GamePlayer" ADD COLUMN "seizedItems" TEXT;
