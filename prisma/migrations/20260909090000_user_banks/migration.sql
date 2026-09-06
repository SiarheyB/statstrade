-- Банк игрока: не второй центробанк (кредитов другим игрокам он не выдаёт),
-- а ЭМИТЕНТ — выпускает акцию и облигацию, торгуемые на бирже наравне с
-- остальными инструментами. Учреждение стоит взноса и требует репутации,
-- иначе банком становился бы каждый, кто скопил денег.
CREATE TABLE "GameUserBank" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "motto" TEXT,
    "capital" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bondsIssued" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameUserBank_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameUserBank_ownerId_key" ON "GameUserBank"("ownerId");

ALTER TABLE "GameUserBank" ADD CONSTRAINT "GameUserBank_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Листинг теперь общий для фонда и банка: ровно одно из fundId/bankId
-- заполнено, kind говорит, что это за бумага.
ALTER TABLE "GameListing" ALTER COLUMN "fundId" DROP NOT NULL;
ALTER TABLE "GameListing" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'fund_share';
ALTER TABLE "GameListing" ADD COLUMN "bankId" TEXT;

CREATE INDEX "GameListing_bankId_idx" ON "GameListing"("bankId");

ALTER TABLE "GameListing" ADD CONSTRAINT "GameListing_bankId_fkey"
    FOREIGN KEY ("bankId") REFERENCES "GameUserBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;
