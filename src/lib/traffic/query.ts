// Агрегации для админского раздела «Трафик».
//
// Считаем на стороне Postgres (сырой SQL): десятки тысяч строк PageView нет
// смысла тащить в node, чтобы там их сгруппировать. Все запросы бьют по
// индексам (ts, isBot+ts, path+ts).
//
// Сутки режутся по таймзоне админа (см. lib/timezone.ts): смещение приходит в
// минутах и добавляется к ts прямо в SQL — иначе «сегодня» на графике не
// совпадёт с «сегодня» у человека, который на него смотрит.
// NB: смещение умножаем на interval, а не отдаём в make_interval(mins => …):
// Prisma биндит число как bigint, а именованный аргумент make_interval ждёт
// int — Postgres такую функцию не находит (42883).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type Audience = "human" | "bot" | "all";

export type TrafficRange = {
  from: Date;
  to: Date;
  /** Смещение таймзоны админа в минутах (UTC+3 → 180). */
  tzOffsetMin: number;
  audience: Audience;
  /** Гранулярность графика: сутки или часы (для периода «сегодня»). */
  bucket: "day" | "hour";
};

function botFilter(audience: Audience): Prisma.Sql {
  if (audience === "human") return Prisma.sql`AND "isBot" = false`;
  if (audience === "bot") return Prisma.sql`AND "isBot" = true`;
  return Prisma.empty;
}

export type Totals = {
  views: number;
  sessions: number;
  visitors: number;
  botViews: number;
  botSessions: number;
  humanViews: number;
  humanVisitors: number;
};

export async function getTotals(r: TrafficRange): Promise<Totals> {
  const rows = await prisma.$queryRaw<
    {
      views: number;
      sessions: number;
      visitors: number;
      bot_views: number;
      bot_sessions: number;
      human_views: number;
      human_visitors: number;
    }[]
  >`
    SELECT count(*)::int AS views,
           count(DISTINCT "sessionId")::int AS sessions,
           count(DISTINCT "visitorId")::int AS visitors,
           count(*) FILTER (WHERE "isBot")::int AS bot_views,
           count(DISTINCT "sessionId") FILTER (WHERE "isBot")::int AS bot_sessions,
           count(*) FILTER (WHERE NOT "isBot")::int AS human_views,
           count(DISTINCT "visitorId") FILTER (WHERE NOT "isBot")::int AS human_visitors
    FROM "PageView"
    WHERE "ts" >= ${r.from} AND "ts" < ${r.to}
  `;
  const x = rows[0];
  return {
    views: x?.views ?? 0,
    sessions: x?.sessions ?? 0,
    visitors: x?.visitors ?? 0,
    botViews: x?.bot_views ?? 0,
    botSessions: x?.bot_sessions ?? 0,
    humanViews: x?.human_views ?? 0,
    humanVisitors: x?.human_visitors ?? 0,
  };
}

export type SessionStats = {
  sessions: number;
  bounces: number;
  bounceRate: number;
  avgDurationSec: number;
  viewsPerSession: number;
  registered: number;
  loggedIn: number;
  jsConfirmed: number;
  newVisitors: number;
};

/**
 * Показатели качества визитов. Отказ — визит из одной страницы: человек
 * пришёл и ушёл, ничего не открыв. Длительность — между первым и последним
 * запросом визита (для отказов она всегда 0, это нормально).
 */
export async function getSessionStats(r: TrafficRange): Promise<SessionStats> {
  const rows = await prisma.$queryRaw<
    {
      sessions: number;
      bounces: number;
      avg_sec: number | null;
      views: number | null;
      registered: number;
      logged_in: number;
      js_confirmed: number;
    }[]
  >`
    SELECT count(*)::int AS sessions,
           count(*) FILTER (WHERE "views" <= 1)::int AS bounces,
           avg(EXTRACT(EPOCH FROM ("lastSeenAt" - "startedAt")))::float AS avg_sec,
           sum("views")::int AS views,
           count(*) FILTER (WHERE "registered")::int AS registered,
           count(*) FILTER (WHERE "loggedIn")::int AS logged_in,
           count(*) FILTER (WHERE "jsConfirmed")::int AS js_confirmed
    FROM "VisitSession"
    WHERE "startedAt" >= ${r.from} AND "startedAt" < ${r.to} ${botFilter(r.audience)}
  `;
  // Новые посетители: те, кто до начала периода не появлялся ни разу.
  const newRows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT "visitorId"
      FROM "VisitSession"
      WHERE "startedAt" >= ${r.from} AND "startedAt" < ${r.to} ${botFilter(r.audience)}
      GROUP BY "visitorId"
      HAVING min("startedAt") >= ${r.from}
    ) t
  `;
  const x = rows[0];
  const sessions = x?.sessions ?? 0;
  const bounces = x?.bounces ?? 0;
  return {
    sessions,
    bounces,
    bounceRate: sessions ? bounces / sessions : 0,
    avgDurationSec: Math.round(x?.avg_sec ?? 0),
    viewsPerSession: sessions ? (x?.views ?? 0) / sessions : 0,
    registered: x?.registered ?? 0,
    loggedIn: x?.logged_in ?? 0,
    jsConfirmed: x?.js_confirmed ?? 0,
    newVisitors: newRows[0]?.n ?? 0,
  };
}

export type SeriesPoint = {
  /** ISO-момент начала корзины (уже сдвинут в таймзону админа). */
  bucket: string;
  humanViews: number;
  humanVisitors: number;
  botViews: number;
};

export async function getSeries(r: TrafficRange): Promise<SeriesPoint[]> {
  const unit = r.bucket === "hour" ? "hour" : "day";
  const rows = await prisma.$queryRaw<
    { b: Date; human_views: number; human_visitors: number; bot_views: number }[]
  >`
    SELECT date_trunc(${unit}, "ts" + (${r.tzOffsetMin}::int * interval '1 minute')) AS b,
           count(*) FILTER (WHERE NOT "isBot")::int AS human_views,
           count(DISTINCT "visitorId") FILTER (WHERE NOT "isBot")::int AS human_visitors,
           count(*) FILTER (WHERE "isBot")::int AS bot_views
    FROM "PageView"
    WHERE "ts" >= ${r.from} AND "ts" < ${r.to}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((x) => ({
    bucket: x.b.toISOString(),
    humanViews: x.human_views,
    humanVisitors: x.human_visitors,
    botViews: x.bot_views,
  }));
}

export type PageRow = { path: string; views: number; visitors: number; entries: number; bounceRate: number };

/** Топ страниц + сколько раз страница была точкой входа и как часто на ней уходили. */
export async function getTopPages(r: TrafficRange, limit = 20): Promise<PageRow[]> {
  const views = await prisma.$queryRaw<{ path: string; views: number; visitors: number }[]>`
    SELECT "path", count(*)::int AS views, count(DISTINCT "visitorId")::int AS visitors
    FROM "PageView"
    WHERE "ts" >= ${r.from} AND "ts" < ${r.to} ${botFilter(r.audience)}
    GROUP BY "path"
    ORDER BY views DESC
    LIMIT ${limit}
  `;
  const entries = await prisma.$queryRaw<{ path: string; entries: number; bounces: number }[]>`
    SELECT "entryPath" AS path, count(*)::int AS entries, count(*) FILTER (WHERE "views" <= 1)::int AS bounces
    FROM "VisitSession"
    WHERE "startedAt" >= ${r.from} AND "startedAt" < ${r.to} ${botFilter(r.audience)}
    GROUP BY "entryPath"
  `;
  const byPath = new Map(entries.map((e) => [e.path, e]));
  return views.map((v) => {
    const e = byPath.get(v.path);
    return {
      path: v.path,
      views: v.views,
      visitors: v.visitors,
      entries: e?.entries ?? 0,
      bounceRate: e && e.entries ? e.bounces / e.entries : 0,
    };
  });
}

export type SourceRow = {
  source: string;
  refHost: string | null;
  sessions: number;
  visitors: number;
  bounceRate: number;
  registered: number;
};

/** Откуда пришли: категория + конкретный хост/метка, по визитам (не по просмотрам). */
export async function getSources(r: TrafficRange, limit = 25): Promise<SourceRow[]> {
  const rows = await prisma.$queryRaw<
    { source: string; ref_host: string | null; sessions: number; visitors: number; bounces: number; registered: number }[]
  >`
    SELECT "source", "refHost" AS ref_host,
           count(*)::int AS sessions,
           count(DISTINCT "visitorId")::int AS visitors,
           count(*) FILTER (WHERE "views" <= 1)::int AS bounces,
           count(*) FILTER (WHERE "registered")::int AS registered
    FROM "VisitSession"
    WHERE "startedAt" >= ${r.from} AND "startedAt" < ${r.to} ${botFilter(r.audience)}
    GROUP BY "source", "refHost"
    ORDER BY sessions DESC
    LIMIT ${limit}
  `;
  return rows.map((x) => ({
    source: x.source,
    refHost: x.ref_host,
    sessions: x.sessions,
    visitors: x.visitors,
    bounceRate: x.sessions ? x.bounces / x.sessions : 0,
    registered: x.registered,
  }));
}

export type BreakdownRow = { key: string; sessions: number; share: number };

/** Универсальный разрез визитов по колонке (устройство, браузер, ОС, язык, страна). */
export async function getBreakdown(
  r: TrafficRange,
  column: "device" | "browser" | "os" | "lang" | "country",
  limit = 10,
): Promise<BreakdownRow[]> {
  const col = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<{ key: string | null; n: number }[]>`
    SELECT ${col} AS key, count(*)::int AS n
    FROM "VisitSession"
    WHERE "startedAt" >= ${r.from} AND "startedAt" < ${r.to} ${botFilter(r.audience)}
    GROUP BY 1
    ORDER BY n DESC
    LIMIT ${limit}
  `;
  const total = rows.reduce((s, x) => s + x.n, 0);
  return rows.map((x) => ({ key: x.key ?? "—", sessions: x.n, share: total ? x.n / total : 0 }));
}

export type BotRow = {
  name: string;
  category: string | null;
  views: number;
  sessions: number;
  lastSeen: string;
  topPath: string | null;
};

/** Кто из роботов ходит и как часто — от SEO (индексируется ли сайт) до сканеров. */
export async function getBots(r: TrafficRange, limit = 25): Promise<BotRow[]> {
  const rows = await prisma.$queryRaw<
    { name: string | null; category: string | null; views: number; sessions: number; last_seen: Date; top_path: string | null }[]
  >`
    SELECT "botName" AS name,
           "botCategory" AS category,
           count(*)::int AS views,
           count(DISTINCT "sessionId")::int AS sessions,
           max("ts") AS last_seen,
           (array_agg("path" ORDER BY "ts" DESC))[1] AS top_path
    FROM "PageView"
    WHERE "ts" >= ${r.from} AND "ts" < ${r.to} AND "isBot" = true
    GROUP BY "botName", "botCategory"
    ORDER BY views DESC
    LIMIT ${limit}
  `;
  return rows.map((x) => ({
    name: x.name ?? "—",
    category: x.category,
    views: x.views,
    sessions: x.sessions,
    lastSeen: x.last_seen.toISOString(),
    topPath: x.top_path,
  }));
}

export type VisitRow = {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  views: number;
  entryPath: string;
  exitPath: string;
  source: string;
  refHost: string | null;
  device: string;
  browser: string | null;
  os: string | null;
  country: string | null;
  lang: string | null;
  isBot: boolean;
  botName: string | null;
  jsConfirmed: boolean;
  registered: boolean;
  loggedIn: boolean;
  authed: boolean;
  userAgent: string | null;
};

/** Последние визиты — «журнал» для ручного разбора подозрительного трафика. */
export async function getRecentVisits(r: TrafficRange, limit = 50): Promise<VisitRow[]> {
  const rows = await prisma.visitSession.findMany({
    where: {
      startedAt: { gte: r.from, lt: r.to },
      ...(r.audience === "all" ? {} : { isBot: r.audience === "bot" }),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return rows.map((s) => ({
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    views: s.views,
    entryPath: s.entryPath,
    exitPath: s.exitPath,
    source: s.source,
    refHost: s.refHost,
    device: s.device,
    browser: s.browser,
    os: s.os,
    country: s.country,
    lang: s.lang,
    isBot: s.isBot,
    botName: s.botName,
    jsConfirmed: s.jsConfirmed,
    registered: s.registered,
    loggedIn: s.loggedIn,
    authed: s.authed,
    userAgent: s.userAgent,
  }));
}

export type LiveState = {
  visitors: number;
  views: number;
  pages: { path: string; visitors: number }[];
  /** Когда пришёл последний просмотр вообще — контроль, что сбор жив. */
  lastHitAt: string | null;
};

/** «Сейчас на сайте»: активность за последние 5 минут. */
export async function getLive(minutes = 5): Promise<LiveState> {
  const since = new Date(Date.now() - minutes * 60_000);
  const [agg, pages, last] = await Promise.all([
    prisma.$queryRaw<{ visitors: number; views: number }[]>`
      SELECT count(DISTINCT "visitorId")::int AS visitors, count(*)::int AS views
      FROM "PageView" WHERE "ts" >= ${since} AND "isBot" = false
    `,
    prisma.$queryRaw<{ path: string; visitors: number }[]>`
      SELECT "path", count(DISTINCT "visitorId")::int AS visitors
      FROM "PageView" WHERE "ts" >= ${since} AND "isBot" = false
      GROUP BY "path" ORDER BY visitors DESC LIMIT 10
    `,
    prisma.pageView.findFirst({ orderBy: { ts: "desc" }, select: { ts: true } }),
  ]);
  return {
    visitors: agg[0]?.visitors ?? 0,
    views: agg[0]?.views ?? 0,
    pages,
    lastHitAt: last?.ts.toISOString() ?? null,
  };
}

export type CampaignRow = { utmSource: string; utmMedium: string | null; utmCampaign: string | null; sessions: number; registered: number };

/** Рекламные/партнёрские метки: ?utm_source=… и короткое ?ref=…. */
export async function getCampaigns(r: TrafficRange, limit = 20): Promise<CampaignRow[]> {
  const rows = await prisma.$queryRaw<
    { utm_source: string; utm_medium: string | null; utm_campaign: string | null; sessions: number; registered: number }[]
  >`
    SELECT "utmSource" AS utm_source, "utmMedium" AS utm_medium, "utmCampaign" AS utm_campaign,
           count(*)::int AS sessions,
           count(*) FILTER (WHERE "registered")::int AS registered
    FROM "VisitSession"
    WHERE "startedAt" >= ${r.from} AND "startedAt" < ${r.to} AND "utmSource" IS NOT NULL ${botFilter(r.audience)}
    GROUP BY 1, 2, 3
    ORDER BY sessions DESC
    LIMIT ${limit}
  `;
  return rows.map((x) => ({
    utmSource: x.utm_source,
    utmMedium: x.utm_medium,
    utmCampaign: x.utm_campaign,
    sessions: x.sessions,
    registered: x.registered,
  }));
}

export type TodayGlance = { visitors: number; views: number; botViews: number };

/**
 * Короткая сводка за сегодня для главной страницы админки — чтобы посещаемость
 * была видна сразу, не заходя в раздел.
 */
export async function getTodayGlance(tzOffsetMin: number, now: Date = new Date()): Promise<TodayGlance> {
  const dayMs = 86_400_000;
  const shifted = now.getTime() + tzOffsetMin * 60_000;
  const from = new Date(Math.floor(shifted / dayMs) * dayMs - tzOffsetMin * 60_000);
  const rows = await prisma.$queryRaw<{ visitors: number; views: number; bot_views: number }[]>`
    SELECT count(DISTINCT "visitorId") FILTER (WHERE NOT "isBot")::int AS visitors,
           count(*) FILTER (WHERE NOT "isBot")::int AS views,
           count(*) FILTER (WHERE "isBot")::int AS bot_views
    FROM "PageView" WHERE "ts" >= ${from}
  `;
  return { visitors: rows[0]?.visitors ?? 0, views: rows[0]?.views ?? 0, botViews: rows[0]?.bot_views ?? 0 };
}
