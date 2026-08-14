-- Дневной агрегат по закрытым сделкам (см. модель TradeDaily в schema.prisma
-- и lib/analytics/daily.ts). Пересчитывается точечно при изменении сделок
-- вместо того, чтобы складывать всю историю в Node на каждый запрос риска.
--
-- День = дата exitTime в UTC — та же нарезка, что у Metrics.daily и у
-- периодного календаря риск-менеджера (periodStart() в lib/risk.ts).
CREATE TABLE "TradeDaily" (
    "accountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "netPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lossR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rTrades" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDaily_pkey" PRIMARY KEY ("accountId","day")
);

-- Выборки «за период по всем аккаунтам» идут по дню без фильтра по аккаунту.
CREATE INDEX "TradeDaily_day_idx" ON "TradeDaily"("day");

ALTER TABLE "TradeDaily" ADD CONSTRAINT "TradeDaily_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ExchangeAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
