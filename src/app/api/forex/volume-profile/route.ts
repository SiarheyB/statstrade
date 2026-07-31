import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest } from "@/lib/api";
import { prisma } from "@/lib/db";

export const maxDuration = 20;

// Volume Profile из OHLCV свечей (FxCandle).
// Аппроксимация: распределяем объём каждой свечи пропорционально её диапазону.
// Без данных стакана (depth) — это приблизительный VP, но лучше, чем ничего.

const PERIODS = ["5m", "15m", "1h", "4h", "12h", "1d", "1w"] as const;
const PERIOD_MS: Record<string, number> = {
  "5m": 60 * 60_000,
  "15m": 4 * 60 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

const TTL_MS = 5000;
const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

type CandleRow = { t: Date; o: number; h: number; l: number; c: number; v: number };

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "EUR/USD";
  const period = url.searchParams.get("period") ?? "1d";

  if (!PERIODS.includes(period as typeof PERIODS[number])) {
    return badRequest("Неизвестный период. Допустимые: " + PERIODS.join(", "));
  }

  const key = `${symbol}|${period}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  try {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const windowMs = PERIOD_MS[period];
        const toMs = Date.now();
        const fromMs = toMs - windowMs;

        // Берём свечи за период (используем 5m или 15m для детализации)
        const candles = await prisma.fxCandle.findMany({
          where: {
            symbol,
            exchange: "twelvedata",
            interval: "5m",
            t: { gte: new Date(fromMs), lte: new Date(toMs) },
          },
          orderBy: { t: "asc" },
          select: { o: true, h: true, l: true, c: true },
        });

        if (candles.length === 0) {
          return { symbol, period, poc: null, valueArea: null, levels: [] };
        }

        // Определяем ценовой диапазон и bin size
        const allPrices = candles.flatMap(c => [c.h, c.l, c.o, c.c]);
        const minPrice = Math.min(...allPrices);
        const maxPrice = Math.max(...allPrices);
        const range_ = maxPrice - minPrice || 1;

        // Автоматический bin size: ~50 уровней
        const binSize = Math.pow(10, Math.floor(Math.log10(range_ / 50)));
        const bins = new Map<number, number>();

        // Twelve Data не отдаёт volume для форекс (OTC-рынок) — FxCandle.v
        // всегда 0. Вместо объёма строим TPO-профиль (Time Price Opportunity,
        // тот же принцип, что и в биржевом Market Profile для инструментов
        // без единой ленты сделок): каждая свеча даёт равный вес "1"
        // ценовым уровням, которые она затронула диапазоном h-l.
        for (const c of candles) {
          const binLow = Math.floor(c.l / binSize) * binSize;
          const binHigh = Math.floor(c.h / binSize) * binSize;
          const numBins = Math.max(1, Math.round((binHigh - binLow) / binSize) + 1);
          const weightPerBin = 1 / numBins;

          for (let p = binLow; p <= binHigh + binSize / 2; p += binSize) {
            const key = Math.round(p / binSize) * binSize;
            bins.set(key, (bins.get(key) ?? 0) + weightPerBin);
          }
        }

        // ВАЖНО: TPO-вес одной свечи (weightPerBin) обычно < 1 (свеча покрывает
        // несколько ценовых уровней своим диапазоном h-l, вес делится между
        // ними) — при коротких окнах (мало свечей) Math.round() до целого
        // обнулял почти все уровни разом, и график выглядел полностью пустым.
        // Округляем до сотых, чтобы сохранить относительные различия.
        const levels = Array.from(bins.entries())
          .map(([price, volume]) => ({
            price: Number(price.toFixed(6)),
            volume: Math.round(volume * 100) / 100,
            bidVol: 0,
            askVol: 0,
          }))
          .sort((a, b) => a.price - b.price);

        if (levels.length === 0) {
          return { symbol, period, poc: null, valueArea: null, levels: [] };
        }

        // Point of Control (POC)
        const poc = levels.reduce((a, b) => a.volume > b.volume ? a : b);

        // Value Area: ~70% объёма вокруг POC
        const totalVol = levels.reduce((s, l) => s + l.volume, 0);
        const targetVol = totalVol * 0.7;
        let vaVol = poc.volume;
        let vaLow = poc.price;
        let vaHigh = poc.price;
        let lIdx = levels.indexOf(poc) - 1;
        let hIdx = levels.indexOf(poc) + 1;

        while (vaVol < targetVol && (lIdx >= 0 || hIdx < levels.length)) {
          const down = lIdx >= 0 ? levels[lIdx].volume : 0;
          const up = hIdx < levels.length ? levels[hIdx].volume : 0;
          if (down >= up && lIdx >= 0) {
            vaVol += down;
            vaLow = levels[lIdx].price;
            lIdx--;
          } else if (hIdx < levels.length) {
            vaVol += up;
            vaHigh = levels[hIdx].price;
            hIdx++;
          } else break;
        }

        return {
          symbol,
          period,
          poc: { price: poc.price, volume: poc.volume },
          valueArea: { high: vaHigh, low: vaLow },
          levels,
        };
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const data = await p;
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { symbol, period, poc: null, valueArea: null, levels: [] },
      { status: 200 },
    );
  }
}