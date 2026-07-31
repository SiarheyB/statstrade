import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { isTimezone, normalizeTimezone } from "@/lib/timezone";
import { candleActivity } from "@/lib/forexActivity";

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

// Сколько свечей таймфрейма показываем в окне
const CANDLES_IN_WINDOW: Record<string, number> = {
  "5m": 240,  // 20 часов
  "15m": 160, // 40 часов
  "1h": 120,  // 5 дней
  "4h": 90,   // 15 дней
  "12h": 60,  // 30 дней
  "1d": 90,   // 3 месяца
  "1w": 52,   // год
};
const DEFAULT_CANDLES = 100;

// Маппинг таймфрейма → источник для агрегации (если напрямую не поддерживается)
const AGGREGATE_FROM: Record<string, string | undefined> = {
  "12h": "1h",
};

const TTL_MS = 3000;
const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

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
      exchange: "twelvedata",
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

async function computeBA(symbol: string, fromMs: number, toMs: number) {
  const rows = await prisma.fxCandle.findMany({
    where: {
      symbol,
      exchange: "twelvedata",
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
      exchange: "twelvedata",
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
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  try {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const toMs = Date.now();
        const fromMs = toMs - tf * (CANDLES_IN_WINDOW[range] ?? DEFAULT_CANDLES);
        const sourceInterval = AGGREGATE_FROM[range] ?? range;
        const [candles, ba, deltaRes] = await Promise.all([
          fetchCandles(symbol, range, fromMs, toMs),
          computeBA(symbol, fromMs, toMs),
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
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const data = await p;
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}