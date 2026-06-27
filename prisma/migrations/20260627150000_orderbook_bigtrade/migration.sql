-- Large market trades feed.
CREATE TABLE "ObBigTrade" (
    "id" BIGSERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "side" TEXT NOT NULL,

    CONSTRAINT "ObBigTrade_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ObBigTrade_symbol_exchange_t_idx" ON "ObBigTrade"("symbol", "exchange", "t");
