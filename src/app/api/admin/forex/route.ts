import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Раздел «Форекс» админ-панели. Совмещает:
//  1) живой статус forex-collector (GET /health) — Finnhub WS (тики, реконнекты),
//     Twelve Data (бэкафилл/fallback), последняя успешная запись;
//  2) агрегаты по факту записи в Postgres (FxCandle) — по каждой паре/таймфрейму:
//     сколько свечей, насколько свежие (lag), глубина истории.
//
// FxCandle — маленькая таблица (тысячи строк на пару/интервал), в отличие от
// ObSnapshot у крипты, поэтому агрегаты считаются обычным GROUP BY без
// отдельного тяжёлого кэша.

const INTERVALS = ["5m", "15m", "1h", "4h", "1d", "1w"] as const;

type CandleRow = { symbol: string; interval: string; count: number; last_t: Date | null; oldest_t: Date | null };

async function fetchCollectorHealth(): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const base = process.env.FX_COLLECTOR_URL;
  if (!base) return { ok: false, error: "FX_COLLECTOR_URL не задан" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base.replace(/\/$/, "")}/health`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `forex-collector ответил ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();

  try {
    const [candles, config, health] = await Promise.all([
      prisma.$queryRaw<CandleRow[]>`
        SELECT symbol, interval, count(*)::int AS count, max(t) AS last_t, min(t) AS oldest_t
        FROM "FxCandle" WHERE exchange = 'finnhub'
        GROUP BY symbol, interval
        ORDER BY symbol, interval
      `,
      prisma.fxCollectorConfig.findMany({ orderBy: { symbol: "asc" } }),
      fetchCollectorHealth(),
    ]);

    // Матрица пара × таймфрейм для удобного рендера в таблице.
    const symbols = [...new Set(candles.map((c) => c.symbol))].sort();
    const bySymbol: Record<string, Record<string, { count: number; lastT: string | null; oldestT: string | null }>> = {};
    for (const row of candles) {
      bySymbol[row.symbol] ??= {};
      bySymbol[row.symbol][row.interval] = {
        count: row.count,
        lastT: row.last_t?.toISOString() ?? null,
        oldestT: row.oldest_t?.toISOString() ?? null,
      };
    }

    return NextResponse.json({
      now: new Date().toISOString(),
      health,
      symbols,
      intervals: INTERVALS,
      bySymbol,
      config: config.map((c) => ({ symbol: c.symbol, enabled: c.enabled, updatedAt: c.updatedAt.toISOString() })),
      envSymbols: (process.env.FX_SYMBOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
