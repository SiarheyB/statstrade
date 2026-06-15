-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryPointOptions" TEXT,
    "entryTypeOptions" TEXT,
    "mistakeOptions" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAnnotation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeKey" TEXT NOT NULL,
    "entryPoint" TEXT,
    "entryType" TEXT,
    "mistake" TEXT,
    "stopLoss" DOUBLE PRECISION,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "passphrase" TEXT,
    "marketType" TEXT NOT NULL DEFAULT 'both',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "syncError" TEXT,
    "autoSync" BOOLEAN NOT NULL DEFAULT false,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "ExchangeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "orderId" TEXT,
    "symbol" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeCurrency" TEXT,
    "realizedPnl" DOUBLE PRECISION,
    "takerOrMaker" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "JournalNote_userId_idx" ON "JournalNote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalNote_userId_date_key" ON "JournalNote"("userId", "date");

-- CreateIndex
CREATE INDEX "TradeAnnotation_userId_idx" ON "TradeAnnotation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAnnotation_userId_tradeKey_key" ON "TradeAnnotation"("userId", "tradeKey");

-- CreateIndex
CREATE INDEX "ExchangeAccount_userId_idx" ON "ExchangeAccount"("userId");

-- CreateIndex
CREATE INDEX "Fill_accountId_idx" ON "Fill"("accountId");

-- CreateIndex
CREATE INDEX "Fill_accountId_timestamp_idx" ON "Fill"("accountId", "timestamp");

-- CreateIndex
CREATE INDEX "Fill_accountId_symbol_idx" ON "Fill"("accountId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Fill_accountId_tradeId_symbol_key" ON "Fill"("accountId", "tradeId", "symbol");

-- AddForeignKey
ALTER TABLE "JournalNote" ADD CONSTRAINT "JournalNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAnnotation" ADD CONSTRAINT "TradeAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeAccount" ADD CONSTRAINT "ExchangeAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ExchangeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
