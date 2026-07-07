"use strict";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateNetStopsFromTrades } from "./riskManager";

describe("calculateNetStopsFromTrades", () => {
  it("returns 0 when there are 2 losses (-1R each) followed by a 3R profit", () => {
    const rAmount = 1000; // 1R = $1000
    const trades = [
      { netPnl: -1000, result: "loss" as const }, // -1R
      { netPnl: -1000, result: "loss" as const }, // -1R
      { netPnl: 3000, result: "win" as const }, // +3R
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("returns 3 when there are 3 losses (-1R each) with no wins", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: -1000, result: "loss" as const },
      { netPnl: -1000, result: "loss" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(3);
  });

  it("returns 2 when there are 2 losses (-1R each) with no wins", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: -1000, result: "loss" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(2);
  });

  it("returns 0 when there are only 3 wins (+R each)", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: 1000, result: "win" as const },
      { netPnl: 1000, result: "win" as const },
      { netPnl: 1000, result: "win" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("returns 0 when there are no trades", () => {
    const rAmount = 1000;
    const result = calculateNetStopsFromTrades([], rAmount);
    expect(result).toBe(0);
  });

  it("returns 0 when RAmount <= 0", () => {
    const rAmount = 0;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: 1000, result: "win" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("calculates for mixed scenario: -1R, +2R, -2R, +1R", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const }, // -1R
      { netPnl: 2000, result: "win" as const }, // +2R
      { netPnl: -2000, result: "loss" as const }, // -2R
      { netPnl: 1000, result: "win" as const }, // +1R
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("handles small floating point differences (epsilon check)", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: 3000 - 0.0000001, result: "win" as const }, // very slight rounding error
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });
});