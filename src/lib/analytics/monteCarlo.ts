// Monte Carlo equity simulation from a trader's own historical trade returns
// (bootstrap resampling, with replacement) — the same idea as Edgewonk's
// Simulator/Risk-of-Ruin: no market-data assumptions, just "what if my trades
// come in a different order/mix than they actually did".

export type MonteCarloResult = {
  simulations: number;
  projectedTrades: number;
  // % of simulated paths whose max drawdown from any prior peak reached or
  // exceeded `ruinDrawdownPct` at some point — the "Risk of Ruin" figure.
  riskOfRuinPct: number;
  // Final-equity percentiles across all simulated paths, as a multiple of
  // starting capital (1 = breakeven, 1.5 = +50%, 0.5 = -50%).
  p5: number;
  p50: number;
  p95: number;
  // A handful of representative equity curves (min/median/max outcome) for
  // an optional fan chart, expressed as running equity multiples.
  sampleCurves: { min: number[]; median: number[]; max: number[] };
};

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// xorshift32 — fast, seedable, no external dependency; deterministic given a
// seed so results are reproducible if ever needed for debugging.
function makeRng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s |= 0;
    return ((s >>> 0) / 4294967296 + 1) % 1;
  };
}

export function runMonteCarlo(
  returnsPct: number[], // per-trade return as a fraction of capital (e.g. 0.02 = +2%)
  opts: { simulations: number; projectedTrades: number; ruinDrawdownPct: number },
): MonteCarloResult | null {
  if (returnsPct.length === 0) return null;
  const rng = makeRng(0x9e3779b9);
  const n = Math.max(1, opts.simulations);
  const steps = Math.max(1, opts.projectedTrades);
  const ruinFrac = opts.ruinDrawdownPct / 100;

  const finals: number[] = [];
  let ruinCount = 0;
  let bestFinal = -Infinity;
  let worstFinal = Infinity;
  let bestCurve: number[] = [];
  let worstCurve: number[] = [];
  const medianCandidateCurves: { final: number; curve: number[] }[] = [];

  for (let s = 0; s < n; s++) {
    let equity = 1;
    let peak = 1;
    let maxDd = 0;
    const curve: number[] = [equity];
    for (let i = 0; i < steps; i++) {
      const r = returnsPct[Math.floor(rng() * returnsPct.length)];
      equity *= 1 + r;
      if (equity < 0) equity = 0;
      peak = Math.max(peak, equity);
      const dd = peak > 0 ? (peak - equity) / peak : 0;
      maxDd = Math.max(maxDd, dd);
      curve.push(equity);
    }
    finals.push(equity);
    if (maxDd >= ruinFrac) ruinCount++;
    if (equity > bestFinal) {
      bestFinal = equity;
      bestCurve = curve;
    }
    if (equity < worstFinal) {
      worstFinal = equity;
      worstCurve = curve;
    }
    medianCandidateCurves.push({ final: equity, curve });
  }

  const sortedFinals = [...finals].sort((a, b) => a - b);
  medianCandidateCurves.sort((a, b) => a.final - b.final);
  const medianCurve = medianCandidateCurves[Math.floor(medianCandidateCurves.length / 2)]?.curve ?? [];

  return {
    simulations: n,
    projectedTrades: steps,
    riskOfRuinPct: (ruinCount / n) * 100,
    p5: percentile(sortedFinals, 0.05),
    p50: percentile(sortedFinals, 0.5),
    p95: percentile(sortedFinals, 0.95),
    sampleCurves: { min: worstCurve, median: medianCurve, max: bestCurve },
  };
}
