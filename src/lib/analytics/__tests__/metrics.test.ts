import { describe, it, expect } from "vitest";
import { computeMetrics } from "../metrics";
import type { RoundTripTrade, TradeResult, TradeSide } from "../types";

function makeTrade(overrides: Partial<RoundTripTrade> = {}): RoundTripTrade {
  const entry = overrides.entryTime ?? new Date("2024-01-01T10:00:00Z");
  const exit = overrides.exitTime ?? new Date("2024-01-01T12:00:00Z");
  return {
    id: "t1",
    symbol: "BTC/USDT",
    base: "BTC",
    quote: "USDT",
    market: "spot",
    exchange: "binance",
    accountId: "acc1",
    side: "long" as TradeSide,
    entryTime: entry,
    exitTime: exit,
    durationMs: exit.getTime() - entry.getTime(),
    qty: 1,
    entryPrice: 100,
    exitPrice: 110,
    grossPnl: 10,
    fees: 1,
    netPnl: 9,
    returnPct: 9,
    fillCount: 2,
    result: "win" as TradeResult,
    ...overrides,
  };
}

describe("computeMetrics", () => {
  it("returns zeros for empty trades", () => {
    const m = computeMetrics([]);
    expect(m.tradeCount).toBe(0);
    expect(m.totalNetPnl).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.grossProfit).toBe(0);
    expect(m.grossLoss).toBe(0);
    expect(m.finalEquity).toBe(10000);
    expect(m.profitFactor).toBe(0);
    expect(m.sharpe).toBe(0);
    expect(m.sortino).toBe(0);
    expect(m.calmar).toBe(0);
    expect(m.ulcerIndex).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
    expect(m.equityCurve).toEqual([]);
    expect(m.daily).toEqual([]);
    expect(m.bySymbol).toEqual([]);
    expect(m.bySide.long.trades).toBe(0);
    expect(m.bySide.short.trades).toBe(0);
  });

  it("computes basic P&L metrics", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 100, result: "win", grossPnl: 100, fees: 0, returnPct: 10 }),
      makeTrade({ id: "t2", netPnl: -50, result: "loss", grossPnl: -50, fees: 0, returnPct: -5 }),
    ];
    const m = computeMetrics(trades, 1000);

    expect(m.tradeCount).toBe(2);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.winRate).toBe(50);
    expect(m.totalNetPnl).toBe(50);
    expect(m.grossProfit).toBe(100);
    expect(m.grossLoss).toBe(50);
    expect(m.finalEquity).toBe(1050);
    expect(m.roiPct).toBe(5);
    expect(m.profitFactor).toBeCloseTo(100 / 50, 5);
    expect(m.payoffRatio).toBeCloseTo(100 / 50, 5);
    expect(m.avgTradePnl).toBe(25);
    expect(m.expectancy).toBe(25);
  });

  it("handles all wins (infinite profitFactor)", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 100, result: "win", grossPnl: 100 }),
      makeTrade({ id: "t2", netPnl: 50, result: "win", grossPnl: 50 }),
    ];
    const m = computeMetrics(trades, 1000);
    expect(m.profitFactor).toBe(Infinity);
    expect(m.payoffRatio).toBe(Infinity);
    expect(m.recoveryFactor).toBe(Infinity);
    expect(m.winLossRatio).toBe(Infinity);
  });

  it("handles all losses (zero grossProfit)", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: -100, result: "loss", grossPnl: -100 }),
      makeTrade({ id: "t2", netPnl: -50, result: "loss", grossPnl: -50 }),
    ];
    const m = computeMetrics(trades, 1000);
    expect(m.profitFactor).toBe(0);
    expect(m.payoffRatio).toBe(0);
    expect(m.winLossRatio).toBe(0);
    expect(m.recoveryFactor).toBe(-150 / 150); // totalNetPnl > 0 check fails, so finite
  });

  it("handles breakeven trades", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 0, result: "breakeven", grossPnl: 0 }),
      makeTrade({ id: "t2", netPnl: 100, result: "win", grossPnl: 100 }),
    ];
    const m = computeMetrics(trades);
    expect(m.breakevens).toBe(1);
    expect(m.winRate).toBe(50); // 1 win of 2
    expect(m.lossRate).toBe(0);
  });

  it("computes streaks correctly", () => {
    const trades = [
      makeTrade({ id: "t1", result: "win" }),
      makeTrade({ id: "t2", result: "win" }),
      makeTrade({ id: "t3", result: "loss" }),
      makeTrade({ id: "t4", result: "loss" }),
      makeTrade({ id: "t5", result: "loss" }),
    ];
    const m = computeMetrics(trades);
    expect(m.largestWinStreak).toBe(2);
    expect(m.largestLossStreak).toBe(3);
  });

  it("computes equity curve", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 100, exitTime: new Date("2024-01-01T12:00:00Z") }),
      makeTrade({ id: "t2", netPnl: -30, exitTime: new Date("2024-01-02T12:00:00Z") }),
    ];
    const m = computeMetrics(trades, 1000);
    expect(m.equityCurve.length).toBe(3); // initial + 2 trades
    expect(m.equityCurve[0].equity).toBe(1000);
    expect(m.equityCurve[1].equity).toBe(1100);
    expect(m.equityCurve[2].equity).toBe(1070);
  });

  it("computes max drawdown", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 100, exitTime: new Date("2024-01-01T12:00:00Z") }), // 1100
      makeTrade({ id: "t2", netPnl: -200, exitTime: new Date("2024-01-02T12:00:00Z") }), // 900
      makeTrade({ id: "t3", netPnl: 50, exitTime: new Date("2024-01-03T12:00:00Z") }), // 950
    ];
    const m = computeMetrics(trades, 1000);
    expect(m.maxDrawdown).toBe(200); // from 1100 to 900
    expect(m.maxDrawdownPct).toBeCloseTo((200 / 1100) * 100, 5);
  });

  it("computes Sharpe/Sortino/volatility", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 100, exitTime: new Date("2024-01-01T12:00:00Z") }),
      makeTrade({ id: "t2", netPnl: -50, exitTime: new Date("2024-01-02T12:00:00Z") }),
      makeTrade({ id: "t3", netPnl: 80, exitTime: new Date("2024-01-03T12:00:00Z") }),
    ];
    const m = computeMetrics(trades, 1000);
    expect(m.sharpe).toBeGreaterThanOrEqual(0);
    expect(m.sortino).toBeGreaterThanOrEqual(0);
    expect(m.volatilityPct).toBeGreaterThanOrEqual(0);
    expect(m.downsideDevPct).toBeGreaterThanOrEqual(0);
  });

  it("computes bySide breakdowns", () => {
    const trades = [
      makeTrade({ id: "t1", side: "long", netPnl: 100, result: "win" }),
      makeTrade({ id: "t2", side: "long", netPnl: -50, result: "loss" }),
      makeTrade({ id: "t3", side: "short", netPnl: 75, result: "win" }),
    ];
    const m = computeMetrics(trades);
    expect(m.longTrades).toBe(2);
    expect(m.shortTrades).toBe(1);
    expect(m.longNetPnl).toBe(50);
    expect(m.shortNetPnl).toBe(75);
    expect(m.longWinRate).toBe(50);
    expect(m.shortWinRate).toBe(100);
  });

  it("computes bySymbol breakdowns", () => {
    const trades = [
      makeTrade({ id: "t1", symbol: "BTC/USDT", netPnl: 100, result: "win", entryPrice: 100, qty: 1 }),
      makeTrade({ id: "t2", symbol: "ETH/USDT", netPnl: -50, result: "loss", entryPrice: 200, qty: 2 }),
      makeTrade({ id: "t3", symbol: "BTC/USDT", netPnl: 25, result: "win", entryPrice: 100, qty: 1 }),
    ];
    const m = computeMetrics(trades);
    expect(m.symbolsTraded).toBe(2);
    expect(m.bySymbol.length).toBe(2);
    expect(m.bySymbol[0].symbol).toBe("BTC/USDT");
    expect(m.bySymbol[0].netPnl).toBe(125);
    expect(m.bySymbol[0].trades).toBe(2);
  });

  it("computes byExchange breakdowns", () => {
    const trades = [
      makeTrade({ id: "t1", exchange: "binance", netPnl: 100, result: "win" }),
      makeTrade({ id: "t2", exchange: "bybit", netPnl: -50, result: "loss" }),
    ];
    const m = computeMetrics(trades);
    expect(m.byExchange.length).toBe(2);
    expect(m.byExchange[0].label).toBe("Binance");
    expect(m.byExchange[1].label).toBe("Bybit");
  });

  it("computes byDayOfWeek and byHour using UTC", () => {
    const trades = [
      makeTrade({ id: "t1", exitTime: new Date("2024-01-01T10:00:00Z") }), // Monday
      makeTrade({ id: "t2", exitTime: new Date("2024-01-02T14:00:00Z") }), // Tuesday
    ];
    const m = computeMetrics(trades);
    expect(m.byDayOfWeek.length).toBeGreaterThan(0);
    expect(m.byHour.length).toBeGreaterThan(0);
    // 2024-01-01 is Monday (UTCDay = 1)
    const monday = m.byDayOfWeek.find((b) => b.key === "1");
    expect(monday).toBeTruthy();
    expect(monday!.trades).toBe(1);
    // 2024-01-02 is Tuesday (UTCDay = 2)
    const tuesday = m.byDayOfWeek.find((b) => b.key === "2");
    expect(tuesday).toBeTruthy();
    expect(tuesday!.trades).toBe(1);
  });

  it("computes byMonth correctly", () => {
    const trades = [
      makeTrade({ id: "t1", exitTime: new Date("2024-01-15T12:00:00Z") }),
      makeTrade({ id: "t2", exitTime: new Date("2024-02-15T12:00:00Z") }),
    ];
    const m = computeMetrics(trades);
    expect(m.byMonth.length).toBe(2);
    expect(m.byMonth[0].label).toBe("Янв 2024");
    expect(m.byMonth[1].label).toBe("Фев 2024");
  });

  it("computes byEntryPoint/byEntryType/byMistake/byPattern with UNSET fallback", () => {
    const trades = [
      makeTrade({ id: "t1", entryPoint: "Breakout", netPnl: 100, result: "win" }),
      makeTrade({ id: "t2", entryType: "Aggressive", netPnl: -50, result: "loss" }),
      makeTrade({ id: "t3", mistake: "Early exit", netPnl: -20, result: "loss" }),
      makeTrade({ id: "t4", pattern: "Reversal", netPnl: 75, result: "win" }),
      makeTrade({ id: "t5" }), // unset fields
    ];
    const m = computeMetrics(trades);
    expect(m.byEntryPoint.length).toBe(2); // "Breakout" + UNSET
    expect(m.byEntryType.length).toBe(2); // "Aggressive" + UNSET
    expect(m.byMistake.length).toBeGreaterThanOrEqual(1);
    expect(m.byPattern.length).toBe(2); // "Reversal" + UNSET
  });

  it("computes bySession (forex-style UTC bins)", () => {
    const trades = [
      makeTrade({ id: "t1", entryTime: new Date("2024-01-01T08:00:00Z") }), // London
      makeTrade({ id: "t2", entryTime: new Date("2024-01-01T14:00:00Z") }), // London/NY
      makeTrade({ id: "t3", entryTime: new Date("2024-01-01T18:00:00Z") }), // New York
      makeTrade({ id: "t4", entryTime: new Date("2024-01-01T02:00:00Z") }), // Asia
    ];
    const m = computeMetrics(trades);
    expect(m.bySession.length).toBeGreaterThan(0);
    const london = m.bySession.find((b) => b.label === "London");
    expect(london).toBeTruthy();
    expect(london!.trades).toBe(1);
  });

  it("computes forex fields (pips/lots/swap/commission)", () => {
    const trades = [
      makeTrade({ id: "t1", pips: 50, lots: 2, swap: -1, commission: 5 }),
      makeTrade({ id: "t2", pips: 30, lots: 1.5, swap: -2, commission: 3 }),
    ];
    const m = computeMetrics(trades);
    expect(m.totalPips).toBe(80);
    expect(m.avgPips).toBe(40);
    expect(m.totalLots).toBe(3.5);
    expect(m.avgLot).toBe(1.75);
    expect(m.totalSwap).toBe(-3);
    expect(m.totalCommission).toBe(8);
  });

  it("computes avgRR from stop-loss trades", () => {
    const trades = [
      // Long, entry 100, stop 90 (risk 10), exit 120 (move +20) => +2R
      makeTrade({ id: "t1", side: "long", entryPrice: 100, exitPrice: 120, stopLoss: 90 }),
      // Long, entry 100, stop 90 (risk 10), exit 80 (move -20) => -2R
      makeTrade({ id: "t2", side: "long", entryPrice: 100, exitPrice: 80, stopLoss: 90 }),
      // No stop-loss => ignored
      makeTrade({ id: "t3", side: "long", entryPrice: 100, exitPrice: 110 }),
    ];
    const m = computeMetrics(trades);
    expect(m.avgRR).toBeCloseTo(0, 5); // (+2 + -2) / 2 = 0
  });

  it("handles stop-loss with zero risk (skipped)", () => {
    const trades = [
      makeTrade({ id: "t1", side: "long", entryPrice: 100, exitPrice: 110, stopLoss: 100 }),
    ];
    const m = computeMetrics(trades);
    expect(m.avgRR).toBe(0); // risk = 0 => skipped
  });

  it("computes daily series (cumulative P&L)", () => {
    const trades = [
      makeTrade({ id: "t1", netPnl: 100, exitTime: new Date("2024-01-01T12:00:00Z") }),
      makeTrade({ id: "t2", netPnl: 50, exitTime: new Date("2024-01-01T14:00:00Z") }), // same day
      makeTrade({ id: "t3", netPnl: -30, exitTime: new Date("2024-01-02T12:00:00Z") }),
    ];
    const m = computeMetrics(trades, 1000);
    expect(m.tradingDays).toBe(2);
    expect(m.daily.length).toBe(2);
    expect(m.daily[0].pnl).toBe(150); // 100 + 50 same day
    expect(m.daily[0].cumulative).toBe(150);
    expect(m.daily[1].pnl).toBe(-30);
    expect(m.daily[1].cumulative).toBe(120);
    expect(m.percentWinningDays).toBe(50);
  });

  it("uses custom initialCapital", () => {
    const trades = [makeTrade({ id: "t1", netPnl: 100 })];
    const m = computeMetrics(trades, 5000);
    expect(m.initialCapital).toBe(5000);
    expect(m.finalEquity).toBe(5100);
    expect(m.roiPct).toBe(2);
  });
});