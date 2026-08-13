-- UserDrawing model: инструменты рисования на графике orderflow
-- Таблица могла быть создана раньше миграцией 20260720073840_stattrade,
-- поэтому все операции идемпотентны.
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserDrawing_pkey" PRIMARY KEY ("id")
);

-- Index for querying drawings by user + symbol + exchange
CREATE INDEX IF NOT EXISTS "UserDrawing_userId_symbol_exchange_idx" ON "UserDrawing"("userId", "symbol", "exchange");

-- Foreign key to User (cascade delete).
-- В 20260720073840_stattrade FK создавался без ON DELETE CASCADE — пересоздаём.
ALTER TABLE "UserDrawing" DROP CONSTRAINT IF EXISTS "UserDrawing_userId_fkey";
ALTER TABLE "UserDrawing" ADD CONSTRAINT "UserDrawing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
