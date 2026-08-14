import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { fillMissingMfe, pendingMfeCount } from "@/lib/analytics/mfe";

// Агрегат Exit efficiency (MFE/MAE) — ИЗ СОХРАНЁННЫХ КОЛОНОК Trade.
//
// Раньше это считал браузер: на каждый клик «Посчитать» страница «Аналитика»
// делала до maxTrades запросов к публичному API биржи за свечами, считала
// MFE/MAE и выбрасывала результат. Десятки секунд, риск rate-limit, и каждый
// следующий клик — заново. У закрытой сделки MFE/MAE неизменны, поэтому теперь
// они считаются один раз фоново (lib/analytics/mfe.ts) и лежат в БД.
//
// Здесь остаётся только агрегация — целиком в Postgres, строки в Node не едут.

export const maxDuration = 30;

// Сколько сделок досчитываем за один заход на страницу. Небольшая порция:
// эндпоинт должен отвечать быстро, а очередь всё равно разгребается за
// несколько заходов (плюс фоновый прогон при старте контейнера).
const DRAIN_LIMIT = 15;

type AggRow = {
  analyzed: number;
  avg_mfe: number | null;
  avg_mae: number | null;
  avg_captured: number | null;
  left_on_table: number;
};

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const accounts = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId },
      select: { id: true },
    });
    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) {
      return NextResponse.json({
        analyzed: 0, skipped: 0, pending: 0,
        avgMfePct: 0, avgMaePct: 0, avgCapturedPct: 0, leftOnTableUsd: 0, worst: [],
      });
    }

    const inIds = Prisma.join(ids);
    // «Недобранное» = (лучший возможный ход − реальный ход) × объём, только
    // положительная часть. Знак хода зависит от стороны сделки.
    const bestMove = Prisma.sql`(CASE WHEN "side" = 'long' THEN "bestPrice" - "entryPrice" ELSE "entryPrice" - "bestPrice" END)`;
    const realMove = Prisma.sql`(CASE WHEN "side" = 'long' THEN "exitPrice" - "entryPrice" ELSE "entryPrice" - "exitPrice" END)`;

    const [agg, worst, skipped, pending] = await Promise.all([
      prisma.$queryRaw<AggRow[]>`
        SELECT COUNT(*)::int AS analyzed,
               AVG("mfePct")::float8 AS avg_mfe,
               AVG("maePct")::float8 AS avg_mae,
               AVG("capturedPct")::float8 AS avg_captured,
               COALESCE(SUM(GREATEST(0, ${bestMove} - ${realMove}) * "qty"), 0)::float8 AS left_on_table
        FROM "Trade"
        WHERE "accountId" IN (${inIds}) AND "mfeAt" IS NOT NULL
      `,
      prisma.trade.findMany({
        where: { accountId: { in: ids }, mfeAt: { not: null } },
        orderBy: { capturedPct: "asc" },
        take: 5,
        select: { id: true, symbol: true, capturedPct: true },
      }),
      // Сделки, по которым данных так и не нашлось (делистнутая пара, биржа не
      // отдаёт историю так глубоко) — счётчик попыток исчерпан.
      prisma.trade.count({ where: { accountId: { in: ids }, mfeAt: null, mfeAttempts: { gte: 3 } } }),
      prisma.trade.count({ where: { accountId: { in: ids }, mfeAt: null, mfeAttempts: { lt: 3 } } }),
    ]);

    const a = agg[0];
    const payload = {
      analyzed: a?.analyzed ?? 0,
      skipped,
      pending,
      avgMfePct: a?.avg_mfe ?? 0,
      avgMaePct: a?.avg_mae ?? 0,
      avgCapturedPct: a?.avg_captured ?? 0,
      leftOnTableUsd: a?.left_on_table ?? 0,
      worst: worst.map((w) => ({
        id: w.id,
        symbol: w.symbol,
        capturedPct: w.capturedPct ?? 0,
      })),
    };

    // Догружаем очередь фоном: ответ не ждёт биржу.
    if (pending > 0 && (await pendingMfeCount()) > 0) {
      void fillMissingMfe({ limit: DRAIN_LIMIT }).catch(() => {});
    }

    return NextResponse.json(payload);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
