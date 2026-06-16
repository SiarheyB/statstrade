-- AlterTable
ALTER TABLE "NewsItem" ADD COLUMN     "lang" TEXT NOT NULL DEFAULT 'en';

-- DropIndex (superseded by the composite lang+publishedAt index)
DROP INDEX IF EXISTS "NewsItem_publishedAt_idx";

-- CreateIndex
CREATE INDEX "NewsItem_lang_publishedAt_idx" ON "NewsItem"("lang", "publishedAt");
