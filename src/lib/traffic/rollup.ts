// Суточная свёртка посещаемости + чистка сырых просмотров.
//
// Зачем: PageView — самая быстрорастущая таблица приложения (роботы на
// публичном сайте генерируют больше строк, чем люди), а сервер домашний, с 8 ГБ
// памяти и одним диском. Держать сырые события вечно нельзя, но и терять
// историю посещаемости не хочется — поэтому раз в сутки считаем агрегаты в
// TrafficDaily, а сырьё старше ANALYTICS_RETENTION_DAYS удаляем.
//
// Сутки в агрегатах — UTC-шные (у фоновой задачи нет «таймзоны зрителя»);
// оперативные экраны считаются по сырым PageView в зоне админа.
// Запускается кроном хоста: /api/cron/analytics (см. docs/SELF_HOSTING.md).

import { prisma } from "@/lib/db";
import { retentionDays } from "./ingest";

export type RollupResult = {
  days: number;
  rows: number;
  deletedViews: number;
  deletedSessions: number;
};

// Разрезы, которые сохраняются на долгую память. Всё, что не здесь, после
// чистки сырых событий будет недоступно — поэтому список намеренно шире, чем
// «просто просмотры»: источники и страницы нужны как раз в исторической
// динамике («до статьи в канале / после»).
const SCOPES: { scope: string; column: string | null }[] = [
  { scope: "total", column: null },
  { scope: "path", column: '"path"' },
  { scope: "source", column: '"source"' },
  { scope: "refHost", column: '"refHost"' },
  { scope: "device", column: '"device"' },
  { scope: "country", column: '"country"' },
  { scope: "bot", column: '"botName"' },
];

/**
 * Пересчитать агрегаты за последние `days` суток и удалить старое сырьё.
 * Пересчёт идемпотентный (ON CONFLICT DO UPDATE) — повторный запуск за те же
 * сутки не задваивает цифры.
 */
export async function rollupTraffic(days = 3, now: Date = new Date()): Promise<RollupResult> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
  let rows = 0;

  for (const s of SCOPES) {
    const keyExpr = s.column ? `COALESCE(${s.column}, '')` : `''`;
    // Роботы отдельной строкой от людей: сводить их вместе бессмысленно.
    const sql = `
      INSERT INTO "TrafficDaily" ("day", "kind", "scope", "key", "views", "sessions", "visitors")
      SELECT ("ts")::date AS day,
             CASE WHEN "isBot" THEN 'bot' ELSE 'human' END AS kind,
             '${s.scope}' AS scope,
             ${keyExpr} AS key,
             count(*)::int,
             count(DISTINCT "sessionId")::int,
             count(DISTINCT "visitorId")::int
      FROM "PageView"
      WHERE "ts" >= $1
      GROUP BY 1, 2, 3, 4
      ON CONFLICT ("day", "kind", "scope", "key") DO UPDATE
        SET "views" = EXCLUDED."views",
            "sessions" = EXCLUDED."sessions",
            "visitors" = EXCLUDED."visitors"
    `;
    rows += await prisma.$executeRawUnsafe(sql, from);
  }

  const cutoff = new Date(now.getTime() - retentionDays() * 86_400_000);
  const deletedViews = await prisma.pageView.deleteMany({ where: { ts: { lt: cutoff } } });
  // Визиты живут столько же: без своих просмотров они уже ничего не объясняют.
  const deletedSessions = await prisma.visitSession.deleteMany({ where: { startedAt: { lt: cutoff } } });

  return { days, rows, deletedViews: deletedViews.count, deletedSessions: deletedSessions.count };
}

export type DailyPoint = { day: string; kind: string; views: number; sessions: number; visitors: number };

/** Историческая динамика из агрегатов (работает и после чистки сырья). */
export async function getDailyHistory(from: Date, to: Date, scope = "total", key = ""): Promise<DailyPoint[]> {
  const rows = await prisma.trafficDaily.findMany({
    where: { day: { gte: from, lte: to }, scope, key },
    orderBy: { day: "asc" },
  });
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    kind: r.kind,
    views: r.views,
    sessions: r.sessions,
    visitors: r.visitors,
  }));
}
