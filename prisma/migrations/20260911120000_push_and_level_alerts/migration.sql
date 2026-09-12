-- Подписка браузера на web push. Одна строка на УСТРОЙСТВО: с телефона и с
-- ноутбука приходят разные endpoint'ы одного пользователя, и уведомление
-- должно долетать на оба.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOkAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- Персональная подписка на уровень из выдачи «Рекомендаций». Хранится цена
-- уровня, а не ссылка на LevelSetup: ночной пересчёт делает truncate+refill,
-- и подписка по внешнему ключу умирала бы каждую ночь.
CREATE TABLE "LevelAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "levelPrice" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "thresholdAtr" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "atr" DOUBLE PRECISION NOT NULL,
    "triggeredAt" TIMESTAMP(3),
    "triggeredPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LevelAlert_userId_symbol_levelPrice_key"
    ON "LevelAlert"("userId", "symbol", "levelPrice");
CREATE INDEX "LevelAlert_triggeredAt_idx" ON "LevelAlert"("triggeredAt");
CREATE INDEX "LevelAlert_userId_idx" ON "LevelAlert"("userId");

-- Копия настроек напоминаний о новостях с этого устройства и уже отправленные
-- рубежи. Главными настройки остаются в localStorage браузера — серверу нужна
-- копия только затем, чтобы крон знал, кому и за сколько минут слать push при
-- закрытой вкладке.
ALTER TABLE "PushSubscription" ADD COLUMN "econcalPrefs" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN "econcalSeen" TEXT;
