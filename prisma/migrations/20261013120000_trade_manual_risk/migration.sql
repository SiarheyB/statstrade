-- Ручной риск сделки: сумма, заложенная в стоп-лосс, и её доля от капитала.
-- Заполняется руками в карточке сделки; когда задана — R считается от неё,
-- а не от дистанции стопа и не от риск-профиля (см. lib/risk.ts).
ALTER TABLE "TradeAnnotation" ADD COLUMN "riskAmount" DOUBLE PRECISION;
ALTER TABLE "TradeAnnotation" ADD COLUMN "riskPct" DOUBLE PRECISION;
