-- Витрина изъятого продавала за фиксированную цену первому нажавшему —
-- редкую дорогую вещь тогда забирал не тот, кто ценит её больше, а тот, кто
-- быстрее заметил объявление. Аукцион решает это честно: ставки идут до
-- срока, выигрывает наибольшая.
ALTER TABLE "GameRepossessed" ADD COLUMN "auctionEndsAt" TIMESTAMP(3);
ALTER TABLE "GameRepossessed" ADD COLUMN "highestBid" DOUBLE PRECISION;
ALTER TABLE "GameRepossessed" ADD COLUMN "highestBidderId" TEXT;

-- Существующие лоты (если есть, из прежней логики) получают короткое окно,
-- чтобы не зависнуть навсегда без даты закрытия.
UPDATE "GameRepossessed" SET "auctionEndsAt" = now() + interval '1 hour' WHERE "auctionEndsAt" IS NULL;

ALTER TABLE "GameRepossessed" ALTER COLUMN "auctionEndsAt" SET NOT NULL;

CREATE INDEX "GameRepossessed_auctionEndsAt_idx" ON "GameRepossessed"("auctionEndsAt");

-- Выигранные на аукционе вещи доставляются клиенту так же, как изъятое за
-- просрочку: сервер держит только факт, клиент забирает список при
-- следующей синхронизации.
ALTER TABLE "GamePlayer" ADD COLUMN "wonItems" TEXT;
