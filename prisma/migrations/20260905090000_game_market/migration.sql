-- Общий рынок игры: одна история цен на всех игроков.
--
-- Раньше рынок жил в браузере каждого: у всех свои цены, история умирала
-- вместе с сохранением, сравнивать результаты в общем мире было не с чем.
--
-- Устройство (подробно — src/lib/game/marketGen.ts): цены выводятся
-- ДЕТЕРМИНИРОВАННО из сида мира и номера бара, поэтому историю можно доганять
-- кусками, в любом порядке и с любого инстанса — она не разъедется. В базе
-- лежит готовый результат: пересчитывать на каждый запрос дорого.
--
-- Хранятся только "1h" и "1d". Минутки достраиваются на лету мостом Броуна
-- внутри часа (приходит ровно из открытия часа в его закрытие), поэтому
-- минутный и часовой графики не могут разойтись, а таблица не растёт на
-- полмиллиона строк в сутки. 5m/15m/4h/1w/1M собираются из хранимых рядов.

CREATE TABLE "GameMarket" (
    "id" TEXT NOT NULL DEFAULT 'world',
    "seed" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMarket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameCandle" (
    "assetId" TEXT NOT NULL,
    "tf" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GameCandle_pkey" PRIMARY KEY ("assetId", "tf", "ts")
);

CREATE INDEX "GameCandle_assetId_tf_ts_idx" ON "GameCandle"("assetId", "tf", "ts");

CREATE TABLE "GameMarketNews" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "assetId" TEXT,
    "sector" TEXT,
    "impact" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "shockPct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GameMarketNews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameMarketNews_ts_idx" ON "GameMarketNews"("ts");
CREATE INDEX "GameMarketNews_assetId_ts_idx" ON "GameMarketNews"("assetId", "ts");
