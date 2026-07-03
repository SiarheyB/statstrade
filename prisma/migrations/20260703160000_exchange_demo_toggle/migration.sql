-- Управление демо/testnet-счётом по бирже из админ-панели.
-- NULL = использовать статичный дефолт (SUPPORTED_EXCHANGES[id].supportsDemo).
ALTER TABLE "ExchangeToggle" ADD COLUMN "demoEnabled" BOOLEAN;
