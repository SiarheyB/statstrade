-- Ручная пометка «вышел в безубыток»: сделка перестаёт быть убытком для
-- винрейта, серий, профит-фактора и счётчика стопов, но деньги остаются как
-- есть (см. lib/analytics/breakeven.ts).
ALTER TABLE "TradeAnnotation" ADD COLUMN "breakeven" BOOLEAN NOT NULL DEFAULT false;
