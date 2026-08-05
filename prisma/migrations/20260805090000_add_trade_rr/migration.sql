-- RR (R-multiple) считается один раз и хранится на самой сделке (см.
-- lib/analytics/rr.ts) вместо повторного пересчёта на каждый запрос
-- /api/stats — /dashboard/trades и /dashboard/calendar читают одно и то же
-- сохранённое значение.
ALTER TABLE "Trade" ADD COLUMN "rr" DOUBLE PRECISION;
ALTER TABLE "ImportedTrade" ADD COLUMN "rr" DOUBLE PRECISION;
