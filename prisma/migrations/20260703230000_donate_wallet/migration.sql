-- Кошельки для донатов (кнопка «Донат» в меню). Управляются из админ-панели.
CREATE TABLE IF NOT EXISTS "DonateWallet" (
    "id"        TEXT NOT NULL,
    "network"   TEXT NOT NULL,
    "coin"      TEXT NOT NULL,
    "address"   TEXT NOT NULL,
    "enabled"   BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DonateWallet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DonateWallet_enabled_sortOrder_idx" ON "DonateWallet"("enabled", "sortOrder");

-- Кошелёк из скриншота, предоставленный владельцем проекта.
INSERT INTO "DonateWallet" ("id", "network", "coin", "address", "enabled", "sortOrder", "updatedAt")
VALUES ('seed-trc20-usdt', 'TRC20 (Tron)', 'USDT', 'TFe37LXH6ZjHL9w65cX7a7CBL9E7pGb68L', true, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
