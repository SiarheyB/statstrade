// MFE/MAE (Maximum Favorable/Adverse Excursion) and best-exit analysis for a
// single closed trade, computed from OHLC candles spanning its entry→exit
// window. Only meaningful with REAL market data (not the schematic fallback
// TradeChart draws when candles don't line up with the trade's prices) —
// callers must gate on that themselves.

export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type ExitAnalysis = {
  // Best price reachable in the trader's favor during the hold — the
  // theoretical "perfect exit".
  bestPrice: number;
  // MFE/MAE as % of entry price (always >= 0).
  mfePct: number;
  maePct: number;
  // How much of the maximum favorable move was actually captured by the real
  // exit, 0-100+ (>100 impossible by construction, clamped). Negative if the
  // trade closed worse than entry while price still moved favorably at some
  // point (rare, but shows up on losers that once were green).
  capturedPct: number;
};

export function computeExitAnalysis(
  candles: Candle[],
  side: "long" | "short",
  entryPrice: number,
  exitPrice: number,
): ExitAnalysis | null {
  if (candles.length === 0 || !Number.isFinite(entryPrice) || entryPrice === 0) return null;

  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);

  const isLong = side === "long";
  const bestPrice = isLong ? maxHigh : minLow;
  const favorableExtreme = isLong ? maxHigh - entryPrice : entryPrice - minLow;
  const adverseExtreme = isLong ? entryPrice - minLow : maxHigh - entryPrice;

  const mfePct = (Math.max(0, favorableExtreme) / entryPrice) * 100;
  const maePct = (Math.max(0, adverseExtreme) / entryPrice) * 100;

  const actualMove = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
  const capturedPct = favorableExtreme > 0 ? (actualMove / favorableExtreme) * 100 : 0;

  return { bestPrice, mfePct, maePct, capturedPct };
}

// Shared "is this actually real market data" check — candles are only usable
// for MFE/MAE if the trade's own entry/exit prices fall within them (±5%).
// Used by both the single-trade hover chart (TradeChart) and the aggregate
// exit-efficiency analytics, so the two never disagree on what counts as real.
export function candlesLookReal(candles: Candle[], entryPrice: number, exitPrice: number): boolean {
  if (candles.length <= 2) return false;
  const closes = candles.map((c) => c.c);
  const cMin = Math.min(...closes);
  const cMax = Math.max(...closes);
  const within = (p: number) => p >= cMin * 0.95 && p <= cMax * 1.05;
  return within(entryPrice) && within(exitPrice);
}
