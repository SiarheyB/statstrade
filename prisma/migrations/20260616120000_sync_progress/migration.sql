-- AlterTable
ALTER TABLE "ExchangeAccount" ADD COLUMN     "syncPhase" TEXT,
ADD COLUMN     "syncPlan" TEXT,
ADD COLUMN     "syncCursor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncImported" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fullSyncAt" TIMESTAMP(3);
