import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { forexAccessError } from "@/lib/forexAccess";
import { prisma } from "@/lib/db";
import { isTimezone, normalizeTimezone } from "@/lib/timezone";
import { candleActivity } from "@/lib/forexActivity";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 30;

// Таймфреймы (совпадают с collector/forex/index.mjs)
// 12h не поддерживается Twelve Data — агрегируем из 1h.
const TF_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

// Сколько свечей таймфрейма показываем в окне.
// Должно быть >= VISIBLE_CANDLES на фронте (src/app/dashboard/forex/page.tsx) —
// иначе computeInitialView упирается в границу загруженных данных и не может
// расширить дефолтный масштаб (свечи остаются «огромными» даже после
// увеличения VISIBLE_CANDLES).
const CANDLES_IN_WINDOW: Record<string, number> = {
  "5m": 2000,  // ~7 суток
  "15m": 1800, // ~18.75 суток
  "1h": 1600,  // ~66.7 дней
  "4h": 1400,  // ~233 дня
  "12h": 700,  // ~350 дней (близко к пределу FX_CANDLE_RETENTION_DAYS)
  "1d": 360,   // ~1 год (близко к пределу FX_CANDLE_RETENTION_DAYS)
  // "1w" ограничен FX_CANDLE_RETENTION_DAYS в коллекторе (365 дней по
  // умолчанию, docker-compose.prod.yml) — больше 52 баров всё равно нет в БД,
  // расширять окно сверх этого смысла не имеет.
  "1w": 52,   // ~1 год
};
const DEFAULT_CANDLES = 360;

// Маппинг таймфрейма → источник для агрегации (если напрямую не поддерживается)
const AGGREGATE_FROM: Record<string, string | undefined> = {
  "12h": "1h",
};

const TTL_MS = 3000;
const cache = createRouteCache(TTL_MS);

type CandleRow = { t: Date; o: number; h: number; l: number; c: number; v: number };
type BaRow = { t: number; bidSum: number; askSum: number; volSum: number };

// Агрегирует свечи из меньшего таймфрейма в больший.
// Например, 12h из 1h: группируем по 12 часов, OHLCV из первой/макс/мин/последней.
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
    .map(b => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

async function fetchCandles(symbol: string, range: string, fromMs: number, toMs: number) {
  const interval = AGGREGATE_FROM[range] ?? range;
  const rows = await prisma.fxCandle.findMany({
    where: {
      symbol,
      exchange: "finnhub",
      interval,
      t: { gte: new Date(fromMs), lte: new Date(toMs) },
    },
    orderBy: { t: "asc" },
    select: { t: true, o: true, h: true, l: true, c: true, v: true },
  });

  if (AGGREGATE_FROM[range]) {
    return aggregateCandles(rows, TF_MS[range]);
  }

  return rows;
}

// ─── B/A из свечей ───────────────────────────────────────────────────────
//
// Twelve Data free tier не даёт bid/ask котировки.
// Аппроксимируем B/A из OHLCV: bid = low, ask = high каждой свечи.
// bidSum/askSum — это цена bid/ask, умноженная на 10000 для отображения.

async function computeBA(symbol: string, fromMs: number, toMs: number, interval: string) {
  // ВАЖНО: фильтр по interval обязателен. Без него выборка захватывала свечи
  // ВСЕХ таймфреймов сразу (5m + 15m + 1h + 4h + 1d + 1w) — ряд получался с
  // дублирующимися таймстемпами и «пилой» на панели B/A, а на широких окнах
  // (range=1w → год истории) в Node тянулись сотни тысяч лишних строк.
  const rows = await prisma.fxCandle.findMany({
    where: {
      symbol,
      exchange: "finnhub",
      interval,
      t: { gte: new Date(fromMs), lte: new Date(toMs) },
    },
    orderBy: { t: "asc" },
    select: { t: true, o: true, h: true, l: true, c: true, v: true },
  });

  if (rows.length === 0) return null;

  // Аппроксимируем bid/ask из каждой свечи
  // bid ≈ low (цена, по которой продавцы готовы продать)
  // ask ≈ high (цена, по которой покупатели готовы купить)
  const result: BaRow[] = rows.map(r => ({
    t: r.t.getTime(),
    bidSum: r.l * 10000,
    askSum: r.h * 10000,
    volSum: r.v,
  }));

  return result;
}

// ─── Delta из свечей ────────────────────────────────────────────────────
//
// Twelve Data не отдаёт volume для форекс вообще (OTC-рынок, нет единой ленты
// сделок) — FxCandle.v всегда 0. Используем диапазон свечи (h-l) как proxy
// «активности» вместо объёма (см. lib/forexActivity.ts).
// Знак дельты — направление свечи: close > open → агрессивная покупка (+).

async function computeDelta(symbol: string, fromMs: number, toMs: number, interval: string) {
  const rows = await prisma.fxCandle.findMany({
    where: {
      symbol,
      exchange: "finnhub",
      interval,
      t: { gte: new Date(fromMs), lte: new Date(toMs) },
    },
    orderBy: { t: "asc" },
    select: { t: true, o: true, h: true, l: true, c: true },
  });

  if (rows.length === 0) return null;

  const delta = rows.map(r => {
    const activity = candleActivity(r.h, r.l);
    const isUp = r.c >= r.o;
    return {
      t: r.t.getTime(),
      delta: isUp ? activity : -activity,
      bidVol: isUp ? activity : 0,
      askVol: isUp ? 0 : activity,
    };
  });

  // CVD = cumulative
  let cum = 0;
  const cvd = delta.map(d => {
    cum += d.delta;
    return { t: d.t, cvd: cum };
  });

  return { delta, cvd };
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await forexAccessError(user);
  if (denied) return denied;

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "EUR/USD";
  const range = url.searchParams.get("range") ?? "1h";
  const tzParam = url.searchParams.get("tz");

  const tf = TF_MS[range];
  if (!tf) return badRequest("Неизвестный таймфрейм");

  // Validate timezone
  let timezone: string | undefined;
  if (tzParam !== null && tzParam !== undefined) {
    if (!isTimezone(tzParam)) return badRequest("Некорректный часовой пояс");
    timezone = normalizeTimezone(tzParam);
  }

  const key = `${symbol}|${range}|${timezone ?? "none"}`;

  try {
    // fetch = кэш + дедупликация «в полёте» (см. lib/routeCache.ts).
    const data = await cache.fetch(key, async () => {
      const toMs = Date.now();
      const fromMs = toMs - tf * (CANDLES_IN_WINDOW[range] ?? DEFAULT_CANDLES);
      const sourceInterval = AGGREGATE_FROM[range] ?? range;
      const [candles, ba, deltaRes] = await Promise.all([
        fetchCandles(symbol, range, fromMs, toMs),
        computeBA(symbol, fromMs, toMs, sourceInterval),
        computeDelta(symbol, fromMs, toMs, sourceInterval),
      ]);
      return {
        symbol,
        range,
        from: fromMs,
        to: toMs,
        candles,
        ba,
        delta: deltaRes?.delta ?? null,
        cvd: deltaRes?.cvd ?? null,
        timezone: timezone || "auto",
      };
    });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}