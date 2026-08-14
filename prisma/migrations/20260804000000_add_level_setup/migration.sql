-- Дневные уровни + сетапы "пробой"/"ложный пробой" по всем USDT-парам
-- Binance spot (фича "Рекомендации"). Не привязана к пользователю,
-- пересчитывается целиком раз в сутки.

CREATE TABLE "LevelSetup" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "levelPrice" DOUBLE PRECISION NOT NULL,
    "levelType" TEXT NOT NULL,
    "strength" INTEGER NOT NULL,
    "distanceAtr" DOUBLE PRECISION NOT NULL,
    "bias" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "atr" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "candlesFrom" TIMESTAMP(3) NOT NULL,
    "candlesTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelSetup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LevelSetup_symbol_exchange_idx" ON "LevelSetup"("symbol", "exchange");
CREATE INDEX "LevelSetup_bias_idx" ON "LevelSetup"("bias");
