CREATE TABLE "EconomicEvent" (
    "id" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "category" TEXT,
    "forecast" TEXT,
    "previous" TEXT,
    "actual" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomicEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EconomicEvent_time_currency_title_key" ON "EconomicEvent"("time", "currency", "title");
CREATE INDEX "EconomicEvent_time_idx" ON "EconomicEvent"("time");
