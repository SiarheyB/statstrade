-- UserLevel model: пользовательские ценовые уровни на графике orderflow
-- Таблица могла быть создана раньше миграцией 20260720073840_stattrade,
-- поэтому все операции идемпотентны.
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserLevel_pkey" PRIMARY KEY ("id")
);

-- Index for querying levels by user + symbol + exchange
CREATE INDEX IF NOT EXISTS "UserLevel_userId_symbol_exchange_idx" ON "UserLevel"("userId", "symbol", "exchange");

-- Unique constraint: one level per user/symbol/exchange/price/type
CREATE UNIQUE INDEX IF NOT EXISTS "UserLevel_userId_symbol_exchange_price_type_key" ON "UserLevel"("userId", "symbol", "exchange", "price", "type");

-- Foreign key to User (cascade delete).
-- В 20260720073840_stattrade FK создавался без ON DELETE CASCADE — пересоздаём.
ALTER TABLE "UserLevel" DROP CONSTRAINT IF EXISTS "UserLevel_userId_fkey";
ALTER TABLE "UserLevel" ADD CONSTRAINT "UserLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
