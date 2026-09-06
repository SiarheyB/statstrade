-- Крупные игроки, которые реально двигают рынок: центробанк торгует
-- капиталом банка, хедж-фонд и маркетмейкер — отдельные боты с большим
-- капиталом. botRole различает их от обычных ботов-наблюдателей.
ALTER TABLE "GamePlayer" ADD COLUMN "botRole" TEXT;

-- Торговый пул банка, отделённый от кредитного капитала (см. комментарий
-- в schema.prisma у GameBank.tradingPool).
ALTER TABLE "GameBank" ADD COLUMN "tradingPool" DOUBLE PRECISION NOT NULL DEFAULT 0;
