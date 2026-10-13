-- Журнал скачиваний общий для всех программ (советник MT5, «Периметр»).
ALTER TABLE "AdvisorDownload" RENAME TO "AppDownload";
ALTER TABLE "AppDownload" RENAME CONSTRAINT "AdvisorDownload_pkey" TO "AppDownload_pkey";
ALTER INDEX "AdvisorDownload_ts_idx" RENAME TO "AppDownload_ts_idx";
ALTER INDEX "AdvisorDownload_userId_ts_idx" RENAME TO "AppDownload_userId_ts_idx";
ALTER TABLE "AppDownload" ADD COLUMN "product" TEXT NOT NULL DEFAULT 'advisor';
ALTER TABLE "AppDownload" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "AppDownload" ALTER COLUMN "bytes" DROP NOT NULL;
CREATE INDEX "AppDownload_product_ts_idx" ON "AppDownload"("product", "ts");
