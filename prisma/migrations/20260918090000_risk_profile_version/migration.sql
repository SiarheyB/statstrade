-- Снимок «риска на сделку» (1R) на момент изменения профиля риска.
-- Без него смена риска (0.5% -> 1%) переписывала R у всех прошлых сделок.
CREATE TABLE "RiskProfileVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL DEFAULT '',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "riskPerTrade" TEXT,
    "amount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskProfileVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiskProfileVersion_userId_accountId_effectiveFrom_idx"
    ON "RiskProfileVersion"("userId", "accountId", "effectiveFrom");
