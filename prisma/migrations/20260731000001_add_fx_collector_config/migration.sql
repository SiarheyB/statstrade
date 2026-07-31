-- Список валютных пар forex-collector, управляемый из админки (без передеплоя).
CREATE TABLE "FxCollectorConfig" (
    "symbol" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FxCollectorConfig_pkey" PRIMARY KEY ("symbol")
);
