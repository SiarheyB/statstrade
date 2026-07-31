-- Trade screenshot link (stored on the user's own Google Drive, not on our server).
ALTER TABLE "TradeAnnotation" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "TradeAnnotation" ADD COLUMN "imageProvider" TEXT;
ALTER TABLE "TradeAnnotation" ADD COLUMN "imageFileId" TEXT;

-- OAuth connection to a user's cloud storage (Google Drive), used to upload
-- trade screenshots. Tokens are encrypted at rest (AES-256-GCM, see lib/crypto.ts).
CREATE TABLE "CloudStorageAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accountEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudStorageAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CloudStorageAccount_userId_provider_key" ON "CloudStorageAccount"("userId", "provider");
CREATE INDEX "CloudStorageAccount_userId_idx" ON "CloudStorageAccount"("userId");

ALTER TABLE "CloudStorageAccount" ADD CONSTRAINT "CloudStorageAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
