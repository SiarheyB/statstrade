// Aggregate MFE/MAE "exit efficiency" across a batch of trades — reuses the
// same /api/trade-chart endpoint the hover chart already calls per trade, so
// there's no new server route for this. Limits how many trades are analyzed
// and how many requests run in parallel (both admin-configurable, see
// src/lib/features.ts) to avoid hammering the exchange's public API.

import type { SerializedTrade } from "@/lib/types";
import { computeExitAnalysis, candlesLookReal, type Candle } from "@/lib/analytics/exitAnalysis";
import { isExchangeId } from "@/lib/exchangeIds";

export type ExitEfficiencySummary = {
  analyzed: number;
  skipped: number;
  avgMfePct: number;
  avgMaePct: number;
  avgCapturedPct: number;
  // Sum, over analyzed trades, of (best possible P&L − actual P&L) valued at
  // the trade's quantity — a rough "$ left on the table" estimate.
  leftOnTableUsd: number;
  worst: { trade: SerializedTrade; capturedPct: number }[];
};

async function fetchCandles(trade: SerializedTrade): Promise<Candle[] | null> {
  const params = new URLSearchParams({
    exchange: trade.exchange,
    symbol: trade.symbol,
    market: trade.market,
    from: String(new Date(trade.entryTime).getTime()),
    to: String(new Date(trade.exitTime).getTime()),
  });
  try {
    const res = await fetch(`/api/trade-chart?${params}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { candles?: number[][] };
    if (!j.candles) return null;
    return j.candles.map((c) => ({ t: c[0], o: c[1], h: c[2], l: c[3], c: c[4] }));
  } catch {
    return null;
  }
}

// Runs `worker` over `items` with at most `concurrency` in flight at once.
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    await worker(items[idx]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

// Most recent trades first — that's what a trader cares about improving
// next. Exported so the UI can show which trades/exchanges are actually in
// scope *before* running the (expensive) analysis, not just after.
//
// Imported forex/MT4/MT5/manual trades are excluded up front: their
// `exchange` is the import source ("mt4"/"mt5"/"manual"), not a real ccxt
// exchange, so /api/trade-chart has no public candle source for them and
// would always fail. Filtering them out here — instead of letting them
// occupy a slot in the "last maxTrades" window and silently fail later —
// means that budget goes to trades that can actually be analyzed.
export function pickRecentTrades(allTrades: SerializedTrade[], maxTrades: number): SerializedTrade[] {
  return [...allTrades]
    .filter((t) => isExchangeId(t.exchange))
    .sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())
    .slice(0, Math.max(1, maxTrades));
}

export async function computeExitEfficiency(
  allTrades: SerializedTrade[],
  opts: { maxTrades: number; concurrency: number },
): Promise<ExitEfficiencySummary> {
  const trades = pickRecentTrades(allTrades, opts.maxTrades);

  const perTrade: { trade: SerializedTrade; mfePct: number; maePct: number; capturedPct: number; leftUsd: number }[] = [];
  let skipped = 0;

  await runPool(trades, Math.max(1, opts.concurrency), async (trade) => {
    const candles = await fetchCandles(trade);
    if (!candles || !candlesLookReal(candles, trade.entryPrice, trade.exitPrice)) {
      skipped++;
      return;
    }
    const analysis = computeExitAnalysis(candles, trade.side, trade.entryPrice, trade.exitPrice);
    if (!analysis) {
      skipped++;
      return;
    }
    const bestMove =
      trade.side === "long" ? analysis.bestPrice - trade.entryPrice : trade.entryPrice - analysis.bestPrice;
    const actualMove = trade.side === "long" ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice;
    const leftUsd = Math.max(0, bestMove - actualMove) * trade.qty;
    perTrade.push({ trade, mfePct: analysis.mfePct, maePct: analysis.maePct, capturedPct: analysis.capturedPct, leftUsd });
  });

  const n = perTrade.length || 1;
  const avg = (f: (p: (typeof perTrade)[number]) => number) => perTrade.reduce((s, p) => s + f(p), 0) / n;

  return {
    analyzed: perTrade.length,
    skipped,
    avgMfePct: avg((p) => p.mfePct),
    avgMaePct: avg((p) => p.maePct),
    avgCapturedPct: avg((p) => p.capturedPct),
    leftOnTableUsd: perTrade.reduce((s, p) => s + p.leftUsd, 0),
    worst: [...perTrade].sort((a, b) => a.capturedPct - b.capturedPct).slice(0, 5).map((p) => ({
      trade: p.trade,
      capturedPct: p.capturedPct,
    })),
  };
}
