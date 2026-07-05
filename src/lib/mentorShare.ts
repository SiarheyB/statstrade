import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { computeMetrics } from "@/lib/analytics/metrics";
import type { RoundTripTrade, TradeSide, TradeResult } from "@/lib/analytics/types";

// High-entropy, URL-safe token — the ONLY credential for a share link (no
// user id in the URL, never enumerable). 24 bytes = 192 bits.
export function generateShareToken(): string {
  return randomBytes(24).toString("hex");
}

// Deliberately independent from /api/stats's buildBase(): a mentor snapshot
// only needs the big-picture numbers (no per-tag filters, no annotations), so
// this stays simple rather than threading an unauthenticated request through
// the full authenticated stats pipeline.
export async function computePublicSummary(userId: string) {
  const [tradeRows, importedRows, accounts] = await Promise.all([
    prisma.trade.findMany({ where: { account: { userId } }, orderBy: { exitTime: "asc" } }),
    prisma.importedTrade.findMany({ where: { account: { userId } }, orderBy: { exitTime: "asc" } }),
    prisma.exchangeAccount.findMany({ where: { userId }, select: { balance: true } }),
  ]);

  const cryptoTrades: RoundTripTrade[] = tradeRows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    base: r.base,
    quote: r.quote,
    market: r.market,
    exchange: r.exchange,
    accountId: r.accountId,
    side: r.side as TradeSide,
    entryTime: r.entryTime,
    exitTime: r.exitTime,
    durationMs: r.exitTime.getTime() - r.entryTime.getTime(),
    qty: r.qty,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    grossPnl: r.grossPnl,
    fees: r.fees,
    netPnl: r.netPnl,
    returnPct: r.returnPct,
    fillCount: r.fillCount,
    result: r.result as TradeResult,
  }));
  const importedTrades: RoundTripTrade[] = importedRows.map((it) => ({
    id: `${it.accountId}:${it.externalId}`,
    symbol: it.symbol,
    base: it.base,
    quote: it.quote,
    market: it.market,
    exchange: it.source,
    accountId: it.accountId,
    side: it.side as TradeSide,
    entryTime: it.entryTime,
    exitTime: it.exitTime,
    durationMs: it.exitTime.getTime() - it.entryTime.getTime(),
    qty: it.qty,
    entryPrice: it.entryPrice,
    exitPrice: it.exitPrice,
    grossPnl: it.grossProfit + it.swap,
    fees: it.commission,
    netPnl: it.netPnl,
    returnPct: 0,
    fillCount: 1,
    result: it.netPnl > 1e-9 ? "win" : it.netPnl < -1e-9 ? "loss" : "breakeven",
    lots: it.lots,
    pips: it.pips,
    swap: it.swap,
  }));

  const trades = [...cryptoTrades, ...importedTrades].sort(
    (a, b) => a.exitTime.getTime() - b.exitTime.getTime(),
  );
  const capital = accounts.reduce((s, a) => s + (a.balance ?? 0), 0) || 10000;
  const metrics = computeMetrics(trades, capital);

  return {
    totalTrades: trades.length,
    winRate: metrics.winRate,
    profitFactor: metrics.profitFactor,
    netPnl: metrics.totalNetPnl,
    expectancy: metrics.expectancy,
    maxDrawdownPct: metrics.maxDrawdownPct,
    equityCurve: metrics.equityCurve,
    firstTradeAt: trades[0]?.entryTime.toISOString() ?? null,
    lastTradeAt: trades[trades.length - 1]?.exitTime.toISOString() ?? null,
  };
}
