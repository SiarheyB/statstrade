-- Копитрейдинг.
--
-- Фонды и рынок стратегий дают участвовать в мире тем, кто торгует. Тем, кто
-- торговать сам не хочет или пока не умеет, участвовать было нечем — а это
-- половина пришедших.
--
-- Как устроено. Сделки живут в браузере игрока, сервер их не видит, поэтому
-- «зеркалить» позиции он не может. Вместо этого ведущий ПУБЛИКУЕТ сигнал —
-- что и в какую сторону он открыл, — а клиент подписчика открывает то же
-- сам, своим размером и своими деньгами. Это честнее слепого копирования:
-- размер позиции остаётся решением того, кто рискует.
CREATE TABLE "GameSignal" (
  "id"       TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "assetId"  TEXT NOT NULL,
  "side"     TEXT NOT NULL,
  "price"    DOUBLE PRECISION NOT NULL,
  -- Стоп и тейк ведущего в процентах от входа: у подписчика своя цена входа,
  -- и копировать абсолютные уровни было бы бессмысленно.
  "stopPct"  DOUBLE PRECISION,
  "takePct"  DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameSignal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GameSignal_authorId_createdAt_idx" ON "GameSignal"("authorId", "createdAt");
CREATE INDEX "GameSignal_createdAt_idx" ON "GameSignal"("createdAt");
ALTER TABLE "GameSignal" ADD CONSTRAINT "GameSignal_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Подписка. Комиссия ведущего берётся с ПРИБЫЛЬНОЙ скопированной сделки —
-- как у спонсора: брать долю с убытка значило бы наказывать подписчика за то,
-- что чужой сигнал не сработал.
CREATE TABLE "GameSubscription" (
  "id"         TEXT NOT NULL,
  "leaderId"   TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "feePct"     DOUBLE PRECISION NOT NULL,
  -- Автоматически открывать сделки или только показывать сигналы.
  "auto"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameSubscription_leaderId_followerId_key"
  ON "GameSubscription"("leaderId", "followerId");
CREATE INDEX "GameSubscription_followerId_idx" ON "GameSubscription"("followerId");
ALTER TABLE "GameSubscription" ADD CONSTRAINT "GameSubscription_leaderId_fkey"
  FOREIGN KEY ("leaderId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSubscription" ADD CONSTRAINT "GameSubscription_followerId_fkey"
  FOREIGN KEY ("followerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ведущий: открыт ли он для подписки и почём.
ALTER TABLE "GamePlayer" ADD COLUMN "signalsOpen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GamePlayer" ADD COLUMN "signalFeePct" DOUBLE PRECISION NOT NULL DEFAULT 20;
