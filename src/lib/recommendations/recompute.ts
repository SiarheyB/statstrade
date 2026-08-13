/**
 * recompute.ts — пересчёт "картины дня" (LevelSetup) для всех пар, по
 * которым коллектор насканил дневные свечи (см. TRADE_RECOMMENDATIONS_PLAN.md,
 * п.4-5). Truncate + refill: таблица не история, а срез "на сегодня".
 */

import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { detectLevels, filterLevelsNearPrice, computeAtr, type DailyCandle } from "./levels";
import { computeBreakoutSignals } from "./breakoutSignals";

const EXCHANGE = "binance-futures";
const INTERVAL = "1d";
const MIN_CANDLES = 20;

export interface RecomputeResult {
  symbolsScanned: number;
  levelsWritten: number;
}

// Все символы, по которым в ObCandle есть хотя бы одна 1d-свеча на этой бирже.
async function listCandidateSymbols(): Promise<string[]> {
  const rows = await prisma.obCandle.findMany({
    where: { exchange: EXCHANGE, interval: INTERVAL },
    distinct: ["symbol"],
    select: { symbol: true },
  });
  return rows.map((r) => r.symbol);
}

async function loadCandles(symbol: string): Promise<DailyCandle[]> {
  const rows = await prisma.obCandle.findMany({
    where: { symbol, exchange: EXCHANGE, interval: INTERVAL },
    orderBy: { t: "asc" },
    take: 300,
  });
  return rows.map((r) => ({ t: r.t.getTime(), o: r.o, h: r.h, l: r.l, c: r.c }));
}

export async function recomputeRecommendations(): Promise<RecomputeResult> {
  const feature = await getFeatureConfig("tradeRecommendations");
  const maxDistanceAtr = feature.maxDistanceAtr;
  const symbols = await listCandidateSymbols();
  const rows: {
    symbol: string;
    exchange: string;
    levelPrice: number;
    levelType: string;
    strength: number;
    distanceAtr: number;
    bias: string;
    signals: { for: string[]; against: string[] };
    atr: number;
    currentPrice: number;
    candlesFrom: Date;
    candlesTo: Date;
  }[] = [];

  for (const symbol of symbols) {
    const candles = await loadCandles(symbol);
    if (candles.length < MIN_CANDLES) continue;

    const atr = computeAtr(candles);
    if (atr <= 0) continue;
    const currentPrice = candles[candles.length - 1].c;
    const candlesFrom = new Date(candles[0].t);
    const candlesTo = new Date(candles[candles.length - 1].t);

    const levels = detectLevels(candles);
    const nearby = filterLevelsNearPrice(levels, currentPrice, atr, maxDistanceAtr);

    for (const level of nearby) {
      const signals = computeBreakoutSignals(candles, level.price, atr);
      rows.push({
        symbol,
        exchange: EXCHANGE,
        levelPrice: level.price,
        levelType: level.type,
        strength: level.strength,
        distanceAtr: Math.abs(level.price - currentPrice) / atr,
        bias: signals.bias,
        signals: { for: signals.for, against: signals.against },
        atr,
        currentPrice,
        candlesFrom,
        candlesTo,
      });
    }
  }

  await prisma.$transaction([
    prisma.levelSetup.deleteMany({}),
    ...(rows.length > 0
      ? [
          prisma.levelSetup.createMany({
            data: rows.map((r) => ({ ...r, signals: r.signals })),
          }),
        ]
      : []),
  ]);

  return { symbolsScanned: symbols.length, levelsWritten: rows.length };
}
