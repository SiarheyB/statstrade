import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { forexAccessError } from "@/lib/forexAccess";
import { prisma } from "@/lib/db";
import { candleActivity } from "@/lib/forexActivity";
import { createRouteCache } from "@/lib/routeCache";

export const maxDuration = 20;

const PERIODS = ["5m", "15m", "1h", "4h", "12h", "1d", "1w"] as const;

// Imbalance из свечей: отношение "активности" (proxy объёма — см.
// lib/forexActivity.ts, Twelve Data не отдаёт реальный volume для форекс)
// бычьих свечей к медвежьим.
// Положительный ratio = больше активности на покупку (бычий).
// Отрицательный = больше активности на продажу (медвежий).

const TTL_MS = 5000;
const cache = createRouteCache(TTL_MS);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await forexAccessError(user);
  if (denied) return denied;

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "EUR/USD";
  const period = url.searchParams.get("period") ?? "1h";

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
    const lookbackCount = 80 * candlesPerWindow;

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

    if (candles.length < 10) {
      return NextResponse.json({
        symbol,
        period,
        current: null,
        series: [],
        signal: "neutral",
      });
    }

    // Разворачиваем в хронологическом порядке
    candles.reverse();

    // Агрегируем 12h из 1h
    if (period === "12h") {
      const buckets = new Map<number, { t: number; o: number; h: number; l: number; c: number }>();
      for (const c of candles) {
        const b = Math.floor(c.t.getTime() / 12 / 60 / 60 / 1000) * 12 * 60 * 60 * 1000;
        const existing = buckets.get(b);
        if (!existing) {
          buckets.set(b, { t: b, o: c.o, h: c.h, l: c.l, c: c.c });
        } else {
          existing.h = Math.max(existing.h, c.h);
          existing.l = Math.min(existing.l, c.l);
          existing.c = c.c;
        }
      }
      candles = Array.from(buckets.values())
        .sort((a, b) => a.t - b.t)
        .map(c => ({ t: new Date(c.t), o: c.o, h: c.h, l: c.l, c: c.c }));
    }

    // Для каждой свечи: ratio = активность покупок / общая активность
    // (активность = h-l свечи, proxy объёма — Twelve Data не отдаёт volume для форекс)
    // buyVol = активность если close > open, иначе 0
    // sellVol = активность если close < open, иначе 0
    const series: Array<{ t: number; ratio: number; bidVol: number; askVol: number }> = [];
    let cumulativeBuyVol = 0;
    let cumulativeSellVol = 0;

    for (const c of candles) {
      const isUp = c.c >= c.o;
      const activity = candleActivity(c.h, c.l);
      const buyVol = isUp ? activity : 0;
      const sellVol = isUp ? 0 : activity;
      cumulativeBuyVol += buyVol;
      cumulativeSellVol += sellVol;
      const total = cumulativeBuyVol + cumulativeSellVol;
      const ratio = total > 0 ? (cumulativeBuyVol - cumulativeSellVol) / total : 0;
      series.push({
        t: c.t.getTime(),
        ratio: Math.max(-1, Math.min(1, ratio)),
        bidVol: cumulativeBuyVol,
        askVol: cumulativeSellVol,
      });
    }

    // Текущий imbalance
    const last = series[series.length - 1];
    const current = last ? { ratio: last.ratio, bidVol: last.bidVol, askVol: last.askVol } : null;

    // Сигнал
    let signal = "neutral";
    if (current) {
      if (current.ratio > 0.3) signal = "bullish";
      else if (current.ratio < -0.3) signal = "bearish";
    }

    const data = { symbol, period, current, series, signal };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}