-- CronHeartbeat — когда и чем последний раз запускалась фоновая задача.
-- Первый потребитель: раздел «Рекомендации» в админке. Раньше он показывал
-- «Автопересчёт выключен», если ENABLE_SCHEDULER=false, — но на проде эта
-- переменная выключена намеренно, а пересчёт гоняет системный крон хоста
-- (/api/cron/recommendations). Теперь статус берётся из фактических прогонов.
CREATE TABLE IF NOT EXISTS "CronHeartbeat" (
    "job" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("job")
);
