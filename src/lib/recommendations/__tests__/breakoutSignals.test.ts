import { describe, it, expect } from "vitest";
import { biasDirection, computeBreakoutSignals, detectPastFalseBreakouts } from "../breakoutSignals";
import type { DailyCandle } from "../levels";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function candle(dayOffset: number, o: number, h: number, l: number, c: number): DailyCandle {
  return { t: START + dayOffset * DAY_MS, o, h, l, c };
}

describe("computeBreakoutSignals", () => {
  const LEVEL = 120;
  const ATR = 4;

  it("leans breakout when small bars approach with accumulation right under the level", () => {
    const candles: DailyCandle[] = [];
    // Фон подальше от уровня
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100));
    // Узкое накопление прямо под уровнем, малые бары, закрытие близко к уровню
    for (let i = 10; i < 15; i++) candles.push(candle(i, 118.5, 119.5, 118, 119));

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.for).toContain("accumulation_before_level");
    expect(signals.for).toContain("small_bars_approach");
    expect(signals.for).toContain("close_near_level");
    expect(signals.bias).toBe("breakout");
    // Уровень 120 выше цены (~119) → пробой отрабатывается вверх.
    expect(signals.direction).toBe("long");
  });

  it("leans false_breakout on big bars, far close, and a long unrelieved move with no accumulation", () => {
    const candles: DailyCandle[] = [];
    // Длинный безоткатный подход большими барами, без накопления, close далеко от уровня
    for (let i = 0; i < 6; i++) {
      const base = 90 + i * 6;
      candles.push(candle(i, base, base + 6, base - 1, base + 5));
    }
    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.against).toContain("big_bars_approach");
    expect(signals.against).toContain("long_move_no_accumulation");
    expect(signals.against).toContain("close_far_from_level");
    expect(signals.bias).toBe("false_breakout");
    // Цена ушла выше уровня 120 (последнее закрытие 125), т.е. уровень снизу →
    // ложный пробой вниз = отбой вверх, лонг.
    expect(signals.direction).toBe("long");
  });

  it("tags near_retest when the level was touched within the last 10 bars", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 6; i++) candles.push(candle(i, 100, 102, 98, 100));
    candles.push(candle(6, 119, 120.5, 118, 119.5)); // касание уровня 120
    for (let i = 7; i < 12; i++) candles.push(candle(i, 100, 102, 98, 100));
    candles.push(candle(12, 118.5, 119.5, 118, 119)); // подход снова, через 6 баров

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.for).toContain("near_retest");
  });

  it("tags far_retest when the last touch was more than 30 bars ago", () => {
    const candles: DailyCandle[] = [];
    candles.push(candle(0, 119, 120.5, 118, 119.5)); // раннее касание
    for (let i = 1; i < 40; i++) candles.push(candle(i, 100, 102, 98, 100));
    candles.push(candle(40, 118.5, 119.5, 118, 119)); // подход через 40 баров

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.against).toContain("far_retest");
  });

  it("returns neutral/empty on too little history", () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 100)];
    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals).toEqual({ for: [], against: [], bias: "neutral", direction: null });
  });

  it("flips direction when the level sits below the current price", () => {
    const candles: DailyCandle[] = [];
    // Накопление прямо НАД уровнем 120: цена ~121, уровень снизу.
    for (let i = 0; i < 10; i++) candles.push(candle(i, 140, 142, 138, 140));
    for (let i = 10; i < 15; i++) candles.push(candle(i, 121, 121.5, 120.5, 121));

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.bias).toBe("breakout");
    // Уровень ниже цены → пробой вниз = шорт.
    expect(signals.direction).toBe("short");
  });
});

describe("biasDirection", () => {
  it("maps bias + level position to a trade side", () => {
    expect(biasDirection("breakout", 120, 100)).toBe("long");
    expect(biasDirection("breakout", 80, 100)).toBe("short");
    expect(biasDirection("false_breakout", 120, 100)).toBe("short");
    expect(biasDirection("false_breakout", 80, 100)).toBe("long");
    expect(biasDirection("neutral", 120, 100)).toBeNull();
  });
});

describe("detectPastFalseBreakouts", () => {
  const LEVEL = 100;

  it("detects a close beyond the level with no follow-through on the next bar", () => {
    const candles: DailyCandle[] = [
      candle(0, 95, 97, 94, 96), // prev.c < level
      candle(1, 96, 103, 95, 102), // cur.c > level — пробой
      candle(2, 101, 102, 96, 97), // next.c < level — вернулись, нет продолжения
    ];
    const events = detectPastFalseBreakouts(candles, LEVEL);
    expect(events.length).toBe(1);
    expect(events[0].direction).toBe("up");
    expect(events[0].barIndex).toBe(1);
  });

  it("does not flag a genuine breakout that keeps closing beyond the level", () => {
    const candles: DailyCandle[] = [
      candle(0, 95, 97, 94, 96),
      candle(1, 96, 103, 95, 102),
      candle(2, 102, 106, 101, 105), // продолжение за уровнем — не ЛП
    ];
    expect(detectPastFalseBreakouts(candles, LEVEL)).toEqual([]);
  });
});
