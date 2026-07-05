-- Общая таблица вкл/выкл + JSON-настроек для опциональных фич, редактируемых
-- из /admin/features (одна таблица под все такие переключатели вместо
-- отдельной миграции на каждую фичу).

CREATE TABLE "FeatureConfig" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureConfig_pkey" PRIMARY KEY ("key")
);
