-- Посещаемость сайта: сырые просмотры, визиты и суточные агрегаты.
-- Пишется сервером (middleware → /api/analytics/collect), читается админкой
-- (/admin/traffic). Персональных данных нет: IP не хранится, идентификатор
-- посетителя — хэш IP+UA с солью либо cookie ts_vid.

-- Один просмотр страницы. Чистится по ANALYTICS_RETENTION_DAYS (дефолт 90).
CREATE TABLE IF NOT EXISTS "PageView" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "botName" TEXT,
    "botCategory" TEXT,
    "source" TEXT NOT NULL,
    "refHost" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "device" TEXT NOT NULL,
    "browser" TEXT,
    "os" TEXT,
    "lang" TEXT,
    "country" TEXT,
    "authed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "nav" TEXT NOT NULL DEFAULT 'load',

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PageView_ts_idx" ON "PageView"("ts");
CREATE INDEX IF NOT EXISTS "PageView_isBot_ts_idx" ON "PageView"("isBot", "ts");
CREATE INDEX IF NOT EXISTS "PageView_path_ts_idx" ON "PageView"("path", "ts");
CREATE INDEX IF NOT EXISTS "PageView_sessionId_idx" ON "PageView"("sessionId");

-- Визит: просмотры одного посетителя без 30-минутных пауз.
CREATE TABLE IF NOT EXISTS "VisitSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL DEFAULT 0,
    "entryPath" TEXT NOT NULL,
    "exitPath" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "botName" TEXT,
    "botCategory" TEXT,
    "botReason" TEXT,
    "jsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "refHost" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "device" TEXT NOT NULL,
    "browser" TEXT,
    "os" TEXT,
    "lang" TEXT,
    "country" TEXT,
    "screen" TEXT,
    "userAgent" TEXT,
    "authed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "loggedIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VisitSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VisitSession_startedAt_idx" ON "VisitSession"("startedAt");
CREATE INDEX IF NOT EXISTS "VisitSession_isBot_startedAt_idx" ON "VisitSession"("isBot", "startedAt");
CREATE INDEX IF NOT EXISTS "VisitSession_visitorId_idx" ON "VisitSession"("visitorId");
CREATE INDEX IF NOT EXISTS "VisitSession_lastSeenAt_idx" ON "VisitSession"("lastSeenAt");

-- Суточные агрегаты: остаются после чистки сырых просмотров.
CREATE TABLE IF NOT EXISTS "TrafficDaily" (
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrafficDaily_pkey" PRIMARY KEY ("day", "kind", "scope", "key")
);

CREATE INDEX IF NOT EXISTS "TrafficDaily_day_idx" ON "TrafficDaily"("day");
