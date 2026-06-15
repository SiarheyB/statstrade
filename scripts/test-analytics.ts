import { reconstructTrades } from "../src/lib/analytics/positions";
import { computeMetrics } from "../src/lib/analytics/metrics";
import type { FillInput } from "../src/lib/analytics/types";

// --- 1. Hand-built deterministic case to verify position reconstruction ---
const hand: FillInput[] = [
  // Long BTC: buy 1 @ 100, buy 1 @ 110 (avg 105), sell 2 @ 120 -> +30, fee 0
  f("BTC", "buy", 1, 100, "2024-01-01T00:00:00Z"),
  f("BTC", "buy", 1, 110, "2024-01-01T01:00:00Z"),
  f("BTC", "sell", 2, 120, "2024-01-02T00:00:00Z"),
  // Short ETH: sell 2 @ 200, buy 2 @ 180 -> +40
  f("ETH", "sell", 2, 200, "2024-01-03T00:00:00Z"),
  f("ETH", "buy", 2, 180, "2024-01-04T00:00:00Z"),
  // Flip BTC: buy 1 @ 100, sell 2 @ 90 -> close long -10, open short 1 @ 90; buy 1 @ 80 -> +10
  f("BTC", "buy", 1, 100, "2024-01-05T00:00:00Z"),
  f("BTC", "sell", 2, 90, "2024-01-06T00:00:00Z"),
  f("BTC", "buy", 1, 80, "2024-01-07T00:00:00Z"),
];

const trades = reconstructTrades(hand);
console.log("=== Reconstructed trades ===");
for (const t of trades) {
  console.log(
    `${t.symbol} ${t.side} qty=${t.qty} entry=${t.entryPrice.toFixed(2)} exit=${t.exitPrice.toFixed(2)} gross=${t.grossPnl.toFixed(2)} net=${t.netPnl.toFixed(2)} result=${t.result}`,
  );
}

const expected = [30, 40, -10, 10]; // BTC long, ETH short, BTC long(flip close), BTC short
const got = trades.map((t) => Math.round(t.grossPnl));
const ok =
  trades.length === 4 && expected.every((v, i) => Math.abs(got[i] - v) < 0.01);
console.log("Expected gross:", expected, "Got:", got, ok ? "✓ PASS" : "✗ FAIL");
if (!ok) process.exitCode = 1;

// --- 2. Synthetic dataset to exercise metrics ---
const big: FillInput[] = [];
const base: Record<string, number> = { BTC: 60000, ETH: 3000, SOL: 150 };
let id = 0;
const start = Date.UTC(2024, 0, 1);
for (let i = 0; i < 200; i++) {
  const sym = ["BTC", "ETH", "SOL"][i % 3];
  const p = base[sym];
  const long = Math.random() < 0.6;
  const win = Math.random() < 0.55;
  const move = (Math.random() * 0.03 + 0.005) * (win ? 1 : -1);
  const entry = p * (1 + (Math.random() - 0.5) * 0.05);
  const exit = entry * (1 + (long ? 1 : -1) * move);
  const qty = (200 + Math.random() * 1000) / entry;
  const t0 = new Date(start + i * 8 * 3600 * 1000);
  const t1 = new Date(t0.getTime() + 3600 * 1000 * (1 + Math.random() * 20));
  big.push(g(sym, long ? "buy" : "sell", qty, entry, t0, id++));
  big.push(g(sym, long ? "sell" : "buy", qty, exit, t1, id++));
}
const m = computeMetrics(reconstructTrades(big), 10000);
console.log("\n=== Metrics (200 synthetic trades) ===");
console.log({
  trades: m.tradeCount,
  winRate: m.winRate.toFixed(1) + "%",
  netPnl: m.totalNetPnl.toFixed(2),
  profitFactor: m.profitFactor.toFixed(2),
  expectancy: m.expectancy.toFixed(2),
  maxDD: m.maxDrawdown.toFixed(2),
  maxDDpct: m.maxDrawdownPct.toFixed(2) + "%",
  sharpe: m.sharpe.toFixed(2),
  sortino: m.sortino.toFixed(2),
  calmar: m.calmar.toFixed(2),
  bestTrade: m.bestTrade.toFixed(2),
  worstTrade: m.worstTrade.toFixed(2),
  winStreak: m.largestWinStreak,
  lossStreak: m.largestLossStreak,
  equityPoints: m.equityCurve.length,
  dailyPoints: m.daily.length,
  symbols: m.bySymbol.length,
  long: m.bySide.long,
  short: m.bySide.short,
});
console.log("byDayOfWeek:", m.byDayOfWeek.map((b) => `${b.label}:${b.netPnl.toFixed(0)}`).join(" "));

function f(
  base: string,
  side: "buy" | "sell",
  amount: number,
  price: number,
  iso: string,
): FillInput {
  return {
    symbol: `${base}/USDT`,
    base,
    quote: "USDT",
    market: "spot",
    side,
    price,
    amount,
    fee: 0,
    feeCurrency: "USDT",
    timestamp: new Date(iso),
    exchange: "binance",
    accountId: "acc1",
  };
}

function g(
  base: string,
  side: "buy" | "sell",
  amount: number,
  price: number,
  ts: Date,
  n: number,
): FillInput {
  return {
    symbol: `${base}/USDT`,
    base,
    quote: "USDT",
    market: "spot",
    side,
    price,
    amount,
    fee: price * amount * 0.0005,
    feeCurrency: "USDT",
    timestamp: ts,
    exchange: "binance",
    accountId: "acc-0",
  };
}
