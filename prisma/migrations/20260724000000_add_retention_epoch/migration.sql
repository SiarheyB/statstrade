-- Add RetentionEpoch table for tracking retention period start times
CREATE TABLE "RetentionEpoch" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "epoch_start" TIMESTAMPTZ(3) NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RetentionEpoch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionEpoch_category_key" ON "RetentionEpoch"("category");
