import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { forexAccessError } from "@/lib/forexAccess";
import { prisma } from "@/lib/db";

export const maxDuration = 30;

// Догрузка истории свечей "влево" по курсору (аналог /api/orderflow/history).
// 12h агрегируется из 1h — как и в основном /api/forex, поэтому запрашиваем
// с запасом (лимит*12) из часовых свечей и агрегируем на лету.
const TF_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};
const AGGREGATE_FROM: Record<string, string | undefined> = { "12h": "1h" };
const MAX_LIMIT = 1000;

type CandleRow = { t: Date; o: number; h: number; l: number; c: number; v: number };

function aggregateCandles(rows: CandleRow[], targetMs: number): CandleRow[] {
  const buckets = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
  for (const r of rows) {
    const ms = r.t.getTime();
    const b = Math.floor(ms / targetMs) * targetMs;
    const existing = buckets.get(b);
    if (!existing) {
      buckets.set(b, { t: b, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
    } else {
      existing.h = Math.max(existing.h, r.h);
      existing.l = Math.min(existing.l, r.l);
      existing.c = r.c;
      existing.v += r.v;
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.t - b.t)
    .map((b) => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await forexAccessError(user);
  if (denied) return denied;

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "EUR/USD";
  const range = url.searchParams.get("range") ?? "1h";
  const beforeParam = url.searchParams.get("before");
  const limitParam = url.searchParams.get("limit");

  if (!TF_MS[range]) return badRequest("Неизвестный таймфрейм");
  const before = beforeParam ? Number(beforeParam) : NaN;
  if (!Number.isFinite(before) || before <= 0) return badRequest("Некорректный параметр before");
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || 500));

  try {
    const interval = AGGREGATE_FROM[range] ?? range;
    const dbLimit = AGGREGATE_FROM[range] ? limit * 12 : limit;
    const rows = await prisma.fxCandle.findMany({
      where: { symbol, exchange: "finnhub", interval, t: { lt: new Date(before) } },
      orderBy: { t: "desc" },
      take: dbLimit,
      select: { t: true, o: true, h: true, l: true, c: true, v: true },
    });
    const ascRows = [...rows].reverse();
    const candles = AGGREGATE_FROM[range] ? aggregateCandles(ascRows, TF_MS[range]) : ascRows;
    const hasMore = rows.length === dbLimit;
    return NextResponse.json({ candles, hasMore });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
