-- DropIndex
DROP INDEX IF EXISTS "SupportMessage_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "SupportMessage_readAt_createdAt_idx";

-- AlterTable
ALTER TABLE "ObBigTrade" ADD CONSTRAINT "ObBigTrade_pkey" PRIMARY KEY ("id", "t");

-- AlterTable
ALTER TABLE "ObFootprint" ADD CONSTRAINT "ObFootprint_pkey" PRIMARY KEY ("id", "t");

-- AlterTable
ALTER TABLE "ObSnapshot" ADD CONSTRAINT "ObSnapshot_pkey" PRIMARY KEY ("id", "t");

-- AlterTable
ALTER TABLE "ObTrade" ADD CONSTRAINT "ObTrade_pkey" PRIMARY KEY ("id", "t");
