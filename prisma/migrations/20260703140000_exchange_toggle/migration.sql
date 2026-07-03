-- Вкл/выкл биржи для синхронизации аккаунтов (тумблер в админ-панели).
-- Нет строки → биржа включена по умолчанию.
CREATE TABLE IF NOT EXISTS "ExchangeToggle" (
    "exchange"  TEXT NOT NULL,
    "enabled"   BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeToggle_pkey" PRIMARY KEY ("exchange")
);
