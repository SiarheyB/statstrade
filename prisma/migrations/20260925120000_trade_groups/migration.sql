-- Объединение нескольких импортированных позиций (сетка лимиток MT5) в одну
-- сделку. Группа — строка этой же таблицы с isGroup = true; участники ссылаются
-- на неё через groupId. См. src/lib/trades/grouping.ts.
ALTER TABLE "ImportedTrade" ADD COLUMN "groupId" TEXT;
ALTER TABLE "ImportedTrade" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImportedTrade" ADD COLUMN "memberCount" INTEGER;
ALTER TABLE "ImportedTrade" ADD COLUMN "stopSpread" DOUBLE PRECISION;
ALTER TABLE "ImportedTrade" ADD COLUMN "stopMin" DOUBLE PRECISION;
ALTER TABLE "ImportedTrade" ADD COLUMN "stopMax" DOUBLE PRECISION;

CREATE INDEX "ImportedTrade_groupId_idx" ON "ImportedTrade"("groupId");

-- Удаление строки-группы снимает объединение с участников: каскад ставит им
-- groupId = NULL, и позиции возвращаются в статистику по отдельности.
ALTER TABLE "ImportedTrade" ADD CONSTRAINT "ImportedTrade_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ImportedTrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
