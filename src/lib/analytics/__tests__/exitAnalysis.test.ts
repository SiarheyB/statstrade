import { describe, it, expect } from "vitest";
import { computeExitAnalysis } from "../exitAnalysis";
import type { RoundTripTrade } from "../types";

describe("Exit Analysis", () => {
  it("computes correct MFE/MAE for winning trade", () => {
    // Create mock candles that would produce the expected MFE/MAE
    // Entry: 100, Exit: 110, Max: 115, Min: 95
    const candles = [
      { t: new Date("2024-01-01T10:00:00Z").getTime(), o: 100, h: 115, l: 95, c: 100 }, // entry candle
      { t: new Date("2024-01-01T11:00:00Z").getTime(), o: 105, h: 115, l: 100, c: 110 }, // exit candle
    ];

    const analysis = computeExitAnalysis(candles, "long", 100, 110);

    expect(analysis).not.toBeNull();
    // MFE%: max(0, maxHigh - entryPrice) / entryPrice * 100 = (115 - 100) / 100 * 100 = 15%
    expect(analysis!.mfePct).toBeCloseTo(15, 4);
    // MAE%: max(0, entryPrice - minLow) / entryPrice * 100 = (100 - 95) / 100 * 100 = 5%
    expect(analysis!.maePct).toBeCloseTo(5, 4);
    // capturedPct: (actualMove / favorableExtreme) * 100 = (110 - 100) / (115 - 100) * 100 = 10/15 * 100 ≈ 66.6667%
    expect(analysis!.capturedPct).toBeCloseTo((10 / 15) * 100, 4);
  });

  it("handles losing trade correctly", () => {
    // For short trade: Entry: 1000, Exit: 950, Max: 900, Min: 970
    const candles = [
      { t: new Date("2024-01-01T10:00:00Z").getTime(), o: 1000, h: 970, l: 900, c: 950 }, // entry to exit candle
      { t: new Date("2024-01-01T11:00:00Z").getTime(), o: 950, h: 970, l: 900, c: 950 }, // exit candle
    ];

    const analysis = computeExitAnalysis(candles, "short", 1000, 950);

    expect(analysis).not.toBeNull();
    // MFE%: max(0, entryPrice - minLow) / entryPrice * 100 = (1000 - 900) / 1000 * 100 = 10%
    expect(analysis!.mfePct).toBeCloseTo(10, 4);
    // MAE%: max(0, maxHigh - entryPrice) / entryPrice * 100 = max(0, 970 - 1000) / 1000 * 100 = 0%
    expect(analysis!.maePct).toBeCloseTo(0, 4);
    // capturedPct: (actualMove / favorableExtreme) * 100 = (1000 - 950) / (1000 - 900) * 100 = 50/100 * 100 = 50%
    expect(analysis!.capturedPct).toBeCloseTo(50, 4);
  });

  it("computes captured percentage correctly", () => {
    // Entry: 100, Exit: 120, Max: 130, Min: 90
    const candles = [
      { t: new Date("2024-01-01T10:00:00Z").getTime(), o: 100, h: 130, l: 90, c: 100 }, // entry
      { t: new Date("2024-01-01T11:00:00Z").getTime(), o: 120, h: 130, l: 90, c: 120 }, // exit
    ];

    const analysis = computeExitAnalysis(candles, "long", 100, 120);

    expect(analysis).not.toBeNull();
    const expectedCaptured = ((120 - 100) / (130 - 100)) * 100; // 20/30 * 100 ≈ 66.6667%
    expect(analysis!.capturedPct).toBeCloseTo(expectedCaptured, 4);
    // MFE%: max(0, maxHigh - entryPrice) / entryPrice * 100 = (130 - 100) / 100 * 100 = 30%
    expect(analysis!.mfePct).toBeCloseTo(30, 4);
    // MAE%: max(0, entryPrice - minLow) / entryPrice * 100 = (100 - 90) / 100 * 100 = 10%
    expect(analysis!.maePct).toBeCloseTo(10, 4);
  });

  it("handles breakeven trade correctly", () => {
    // Entry: 50, Exit: 50, Max: 60, Min: 40
    const candles = [
      { t: new Date("2024-01-01T10:00:00Z").getTime(), o: 50, h: 60, l: 40, c: 50 }, // entry
      { t: new Date("2024-01-01T11:00:00Z").getTime(), o: 50, h: 60, l: 40, c: 50 }, // exit
    ];

    const analysis = computeExitAnalysis(candles, "long", 50, 50);

    expect(analysis).not.toBeNull();
    // MFE%: max(0, maxHigh - entryPrice) / entryPrice * 100 = (60 - 50) / 50 * 100 = 20%
    expect(analysis!.mfePct).toBeCloseTo(20, 4);
    // MAE%: max(0, entryPrice - minLow) / entryPrice * 100 = (50 - 40) / 50 * 100 = 20%
    expect(analysis!.maePct).toBeCloseTo(20, 4);
    // capturedPct: 0 because there's no favorable extreme movement
    expect(analysis!.capturedPct).toBeCloseTo(0, 4);
  });

  it("handles negative captured percentage correctly for losing trades", () => {
    // Entry: 1, Exit: 0.8, MaxPrice: 0.9, MinPrice: 0.7
    const candles = [
      { t: new Date("2024-01-01T10:00:00Z").getTime(), o: 1, h: 0.9, l: 0.7, c: 0.8 }, // entry to exit
      { t: new Date("2024-01-01T11:00:00Z").getTime(), o: 0.8, h: 0.9, l: 0.7, c: 0.8 }, // exit
    ];

    const analysis = computeExitAnalysis(candles, "long", 1, 0.8);

    expect(analysis).not.toBeNull();
    // MFE%: max(0, maxHigh - entryPrice) / entryPrice * 100 = max(0, 0.9 - 1) / 1 * 100 = 0%
    expect(analysis!.mfePct).toBeCloseTo(0, 4);
    // MAE%: max(0, entryPrice - minLow) / entryPrice * 100 = (1 - 0.7) / 1 * 100 = 30%
    expect(analysis!.maePct).toBeCloseTo(30, 4);
    // capturedPct: 0 because there's no favorable movement
    expect(analysis!.capturedPct).toBeCloseTo(0, 4);
  });
});