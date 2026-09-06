-- Разговоры и обмен стратегиями: мир, в котором игроки видят друг друга
-- только в таблице рейтинга, — это ещё не мир.
--
-- Идея с графиком (инструмент + таймфрейм + разметка, приложенные к
-- сообщению) возможна ровно потому, что рынок теперь общий: собеседник
-- открывает то же, что видит автор. Пока цены считал каждый браузер, в этом
-- не было смысла.

CREATE TABLE "GameChatMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "assetId" TEXT,
    "tf" TEXT,
    "drawings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameChatMessage_channel_createdAt_idx" ON "GameChatMessage"("channel", "createdAt");

CREATE TABLE "GameStrategy" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameStrategy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameStrategy_purchases_idx" ON "GameStrategy"("purchases");
CREATE INDEX "GameStrategy_authorId_idx" ON "GameStrategy"("authorId");

CREATE TABLE "GameStrategyPurchase" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameStrategyPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameStrategyPurchase_strategyId_buyerId_key" ON "GameStrategyPurchase"("strategyId", "buyerId");
CREATE INDEX "GameStrategyPurchase_buyerId_idx" ON "GameStrategyPurchase"("buyerId");

ALTER TABLE "GameChatMessage" ADD CONSTRAINT "GameChatMessage_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameStrategy" ADD CONSTRAINT "GameStrategy_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameStrategyPurchase" ADD CONSTRAINT "GameStrategyPurchase_strategyId_fkey"
    FOREIGN KEY ("strategyId") REFERENCES "GameStrategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameStrategyPurchase" ADD CONSTRAINT "GameStrategyPurchase_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
