import { describe, it, expect } from "vitest";
import {
  computeAtr,
  isParanormalBar,
  detectLevels,
  mergeLevels,
  filterLevelsNearPrice,
  type DailyCandle,
  type DetectedLevel,
} from "../levels";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function candle(dayOffset: number, o: number, h: number, l: number, c: number): DailyCandle {
  return { t: START + dayOffset * DAY_MS, o, h, l, c };
}

// Плоские бары фиксированного диапазона — база для ATR/фона без сигналов.
function flatSeries(count: number, price: number, range = 2): DailyCandle[] {
  return Array.from({ length: count }, (_, i) => candle(i, price, price + range / 2, price - range / 2, price));
}

describe("computeAtr", () => {
  it("averages normal bar ranges", () => {
    const candles = flatSeries(10, 100, 4); // range=4 each
    expect(computeAtr(candles, 5)).toBeCloseTo(4, 5);
  });

  it("excludes paranormal outlier bars from the average", () => {
    const candles = flatSeries(9, 100, 4);
    candles.push(candle(9, 100, 130, 70, 110)); // range=60, way above baseline
    const atr = computeAtr(candles, 5);
    expect(atr).toBeCloseTo(4, 5);
  });
});

describe("isParanormalBar", () => {
  it("flags bars with range >= 2x ATR", () => {
    const atr = 5;
    expect(isParanormalBar(candle(0, 100, 111, 100, 110), atr)).toBe(true); // range=11
    expect(isParanormalBar(candle(0, 100, 105, 100, 103), atr)).toBe(false); // range=5
  });
});

describe("detectLevels — break_point / parabar", () => {
  it("finds a swing high as a break_point level", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 15; i++) candles.push(candle(i, 100 + i, 101 + i, 99 + i, 100 + i)); // uptrend
    candles.push(candle(15, 115, 120, 114, 116)); // pivot high at 120
    for (let i = 16; i < 30; i++) candles.push(candle(i, 116 - (i - 15), 117 - (i - 15), 115 - (i - 15), 116 - (i - 15))); // downtrend after

    const levels = detectLevels(candles);
    const hit = levels.find((l) => Math.abs(l.price - 120) < 0.01);
    expect(hit).toBeDefined();
    expect(["break_point", "parabar", "mirror", "historical"]).toContain(hit!.type);
  });

  it("classifies a pivot formed by a paranormal bar as parabar", () => {
    const candles: DailyCandle[] = flatSeries(10, 100, 2);
    // Огромный бар посреди плоского фона — паранормальный, формирует пик.
    candles.push(candle(10, 100, 140, 99, 138));
    candles.push(...Array.from({ length: 10 }, (_, i) => candle(11 + i, 100, 101, 99, 100)));

    const levels = detectLevels(candles, { pivotWing: 3 });
    const parabar = levels.find((l) => l.type === "parabar");
    expect(parabar).toBeDefined();
    expect(parabar!.price).toBeCloseTo(140, 5);
  });
});

describe("detectLevels — gap", () => {
  it("detects a gap between prev close and next open beyond ATR threshold", () => {
    const candles = flatSeries(10, 100, 2); // ATR ~= 2
    // Разрыв вверх: prevClose=100, next open=110 — далеко больше 0.3*ATR
    candles.push(candle(10, 110, 112, 109, 111));
    candles.push(...flatSeries(10, 111, 2).map((c, i) => candle(11 + i, c.o, c.h, c.l, c.c)));

    const levels = detectLevels(candles);
    const gapLevels = levels.filter((l) => l.type === "gap");
    expect(gapLevels.length).toBeGreaterThan(0);
    const prices = gapLevels.map((l) => l.price);
    expect(prices.some((p) => Math.abs(p - 100) < 0.5)).toBe(true);
    expect(prices.some((p) => Math.abs(p - 110) < 0.5)).toBe(true);
  });
});

describe("detectLevels — range_border", () => {
  it("finds upper/lower bounds of a tight consolidation window", () => {
    // 25 баров в узком диапазоне 99-101 (ширина 2, ATR тоже ~2 -> <=1.2xATR).
    // >=20 баров — минимум, который detectLevels вообще рассматривает.
    const candles = flatSeries(25, 100, 2);
    const levels = detectLevels(candles, { rangeBorderWindow: 10 });
    const borders = levels.filter((l) => l.type === "range_border");
    expect(borders.length).toBeGreaterThan(0);
  });
});

describe("mergeLevels", () => {
  it("merges levels within tolerance into one with combined strength", () => {
    const a: DetectedLevel = { price: 100, type: "break_point", strength: 1, touches: [{ barIndex: 0, t: 0, side: "resistance" }], formedAt: 0, lastTouchedAt: 0 };
    const b: DetectedLevel = { price: 100.5, type: "break_point", strength: 2, touches: [{ barIndex: 1, t: 1, side: "support" }], formedAt: 1, lastTouchedAt: 1 };
    const merged = mergeLevels([a, b], 10, 0.15); // tolerance = 1.5, diff = 0.5 -> merges
    expect(merged.length).toBe(1);
    expect(merged[0].strength).toBe(3);
    expect(merged[0].touches.length).toBe(2);
  });

  it("keeps far-apart levels separate", () => {
    const a: DetectedLevel = { price: 100, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 };
    const b: DetectedLevel = { price: 200, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 };
    const merged = mergeLevels([a, b], 10, 0.15);
    expect(merged.length).toBe(2);
  });
});

describe("filterLevelsNearPrice", () => {
  it("keeps only levels within maxDistanceAtr, sorted by distance", () => {
    const levels: DetectedLevel[] = [
      { price: 100, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
      { price: 110, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
      { price: 200, type: "break_point", strength: 1, touches: [], formedAt: 0, lastTouchedAt: 0 },
    ];
    const atr = 10;
    const currentPrice = 105;
    const near = filterLevelsNearPrice(levels, currentPrice, atr, 1.5); // <=15 away
    expect(near.map((l) => l.price)).toEqual([100, 110]);
  });
});
