import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { forexAccessError } from "@/lib/forexAccess";
import { normalizeFxSymbol } from "@/lib/forexSymbol";
import { prisma } from "@/lib/db";
import { candleActivity } from "@/lib/forexActivity";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 20;

const PERIODS = ["1m", "5m", "15m", "1h", "4h", "12h", "1d", "1w"] as const;

// Divergence из свечей: расхождение цены и "активности" (proxy объёма —
// Twelve Data не отдаёт реальный volume для форекс, см. lib/forexActivity.ts).
// Бычья дивергенция: цена делает новый минимум, но активность падает.
// Медвежья дивергенция: цена делает новый максимум, но активность падает.

const TTL_MS = 5000;
const cache = createRouteCache(TTL_MS);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await forexAccessError(user);
  if (denied) return denied;

  const url = new URL(req.url);
  const symbol = normalizeFxSymbol(url.searchParams.get("symbol"));
  if (!symbol) return badRequest("Некорректная валютная пара");
  const period = url.searchParams.get("period") ?? "4h";

  if (!PERIODS.includes(period as typeof PERIODS[number])) {
    return badRequest("Неизвестный период. Допустимые: " + PERIODS.join(", "));
  }

  const key = `${symbol}|${period}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit);

  try {
    // 12h не поддерживается Twelve Data — агрегируем из 1h
    const sourceInterval = period === "12h" ? "1h" : period;
    const candlesPerWindow = period === "12h" ? 12 : 1;
    const lookbackCount = 100 * candlesPerWindow;

    let candles = await prisma.fxCandle.findMany({
      where: {
        symbol,
        exchange: "finnhub",
        interval: sourceInterval,
      },
      orderBy: { t: "desc" },
      take: lookbackCount,
      select: { t: true, o: true, h: true, l: true, c: true },
    });

    if (candles.length < 30) {
      return NextResponse.json({ symbol, period, signals: [] });
    }

    // Агрегируем 12h из 1h
    if (period === "12h") {
      const tf = 12 * 60 * 60_000;
      const buckets = new Map<number, { t: number; o: number; h: number; l: number; c: number }>();
      for (const r of candles) {
        const b = Math.floor(r.t.getTime() / tf) * tf;
        const existing = buckets.get(b);
        if (!existing) {
          buckets.set(b, { t: b, o: r.o, h: r.h, l: r.l, c: r.c });
        } else {
          existing.h = Math.max(existing.h, r.h);
          existing.l = Math.min(existing.l, r.l);
          existing.c = r.c;
        }
      }
      candles = Array.from(buckets.values())
        .sort((a, b) => a.t - b.t)
        .map(c => ({ t: new Date(c.t), o: c.o, h: c.h, l: c.l, c: c.c }));
    }

    // Разворачиваем в хронологическом порядке
    candles.reverse();

    // Форма сигнала совпадает с DivergenceSignal (src/lib/orderflow.ts) —
    // тем же типом пользуется общий компонент DivergenceHistory на обеих
    // страницах (orderflow/forex). pricePeak/deltaTrough — текущий экстремум,
    // priceTrough/deltaPeak — более ранний экстремум, с которым сравниваем.
    const signals: Array<{
      id: string;
      t: number;
      type: "regular_bearish" | "regular_bullish";
      strength: number;
      pricePeak: number;
      priceTrough: number;
      deltaPeak: number;
      deltaTrough: number;
      bars: number;
      confirmed: boolean;
      label: string;
    }> = [];

    const strengthOf = (volRatio: number): number =>
      volRatio < 0.35 ? 5 : volRatio < 0.5 ? 4 : volRatio < 0.65 ? 3 : 2;

    // Ищем дивергенцию: сравниваем последовательные пики/впадины
    for (let i = 5; i < candles.length - 5; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const next = candles[i + 1];

      // Локальный максимум
      if (curr.h > prev.h && curr.h > next.h) {
        // Ищем предыдущий максимум в пределах 15 свечей назад
        for (let j = i - 3; j >= Math.max(0, i - 15); j--) {
          if (candles[j].h > candles[j - 1]?.h && candles[j].h > candles[j + 1]?.h) {
            // Проверяем медвежью дивергенцию: цена выше, активность ниже
            const currActivity = candleActivity(curr.h, curr.l);
            const peakActivity = candleActivity(candles[j].h, candles[j].l);
            if (curr.h > candles[j].h && currActivity < peakActivity * 0.8) {
              // Активность падает при росте цены — медвежья дивергенция
              const volRatio = peakActivity > 0 ? currActivity / peakActivity : 1;
              signals.push({
                id: `fx-rb-${i}-${curr.t.getTime()}`,
                t: curr.t.getTime(),
                type: "regular_bearish",
                strength: strengthOf(volRatio),
                pricePeak: curr.h,
                priceTrough: candles[j].h,
                deltaPeak: peakActivity,
                deltaTrough: currActivity,
                bars: i - j,
                confirmed: false,
                label: "Regular Bearish",
              });
            }
            break;
          }
        }
      }

      // Локальный минимум
      if (curr.l < prev.l && curr.l < next.l) {
        // Ищем предыдущий минимум в пределах 15 свечей назад
        for (let j = i - 3; j >= Math.max(0, i - 15); j--) {
          if (candles[j].l < candles[j - 1]?.l && candles[j].l < candles[j + 1]?.l) {
            // Проверяем бычью дивергенцию: цена ниже, активность ниже
            const currActivity = candleActivity(curr.h, curr.l);
            const troughActivity = candleActivity(candles[j].h, candles[j].l);
            if (curr.l < candles[j].l && currActivity < troughActivity * 0.8) {
              // Активность падает при падении цены — бычья дивергенция
              const volRatio = troughActivity > 0 ? currActivity / troughActivity : 1;
              signals.push({
                id: `fx-rbu-${i}-${curr.t.getTime()}`,
                t: curr.t.getTime(),
                type: "regular_bullish",
                strength: strengthOf(volRatio),
                pricePeak: curr.l,
                priceTrough: candles[j].l,
                deltaPeak: troughActivity,
                deltaTrough: currActivity,
                bars: i - j,
                confirmed: false,
                label: "Regular Bullish",
              });
            }
            break;
          }
        }
      }
    }

    // Ограничиваем количество сигналов (не более 10)
    const limited = signals.slice(-10);

    const data = { symbol, period, signals: limited };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}