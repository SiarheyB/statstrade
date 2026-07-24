-- CreateTable: FavouriteTicker
CREATE TABLE "FavouriteTicker" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavouriteTicker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FavouriteTicker_userId_exchange_symbol_key" ON "FavouriteTicker"("userId", "exchange", "symbol");
CREATE INDEX "FavouriteTicker_userId_exchange_idx" ON "FavouriteTicker"("userId", "exchange");