-- Комиссия ведущему начислялась по одному слову клиента: ни подписки, ни
-- сделки, ни повторов сервер не проверял. Эта таблица делает начисление
-- идемпотентным: у пары «сигнал + подписчик» одна строка с накопленной
-- оплаченной прибылью.
CREATE TABLE "GameSignalSettlement" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "paidProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameSignalSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameSignalSettlement_signalId_followerId_key" ON "GameSignalSettlement"("signalId", "followerId");
CREATE INDEX "GameSignalSettlement_followerId_idx" ON "GameSignalSettlement"("followerId");

ALTER TABLE "GameSignalSettlement" ADD CONSTRAINT "GameSignalSettlement_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "GameSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSignalSettlement" ADD CONSTRAINT "GameSignalSettlement_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
