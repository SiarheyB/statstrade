-- Migration to create UserDrawing and UserLevel tables
-- (these were applied directly on the DB in a previous session)

CREATE TABLE IF NOT EXISTS "UserDrawing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "toolType" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#e6b800',
    "lineWidth" INTEGER NOT NULL DEFAULT 2,
    "fillColor" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "deletedAt" TIMESTAMP,
    CONSTRAINT "UserDrawing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserDrawing_userId_symbol_exchange_idx" ON "UserDrawing"("userId", "symbol", "exchange");

ALTER TABLE "UserDrawing" ADD CONSTRAINT "UserDrawing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id");

CREATE TABLE IF NOT EXISTS "UserLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "strength" INTEGER NOT NULL DEFAULT 1,
    "timeframe" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "deletedAt" TIMESTAMP,
    CONSTRAINT "UserLevel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserLevel_userId_symbol_exchange_price_type_key" ON "UserLevel"("userId", "symbol", "exchange", "price", "type");
CREATE INDEX IF NOT EXISTS "UserLevel_userId_symbol_exchange_idx" ON "UserLevel"("userId", "symbol", "exchange");

ALTER TABLE "UserLevel" ADD CONSTRAINT "UserLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id");