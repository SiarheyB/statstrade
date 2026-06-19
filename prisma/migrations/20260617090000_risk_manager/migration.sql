-- AlterTable
ALTER TABLE "ExchangeAccount" ADD COLUMN     "balance" DOUBLE PRECISION,
ADD COLUMN     "balanceAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RiskProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "maxStopsPerDay" INTEGER,
    "lossLimits" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskProfile_userId_accountId_key" ON "RiskProfile"("userId", "accountId");

-- CreateIndex
CREATE INDEX "RiskProfile_userId_idx" ON "RiskProfile"("userId");
