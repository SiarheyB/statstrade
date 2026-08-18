import { describe, it, expect } from "vitest";
import { biasDirection, computeBreakoutSignals, detectPastFalseBreakouts } from "../breakoutSignals";
import type { DailyCandle } from "../levels";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function candle(dayOffset: number, o: number, h: number, l: number, c: number, v?: number): DailyCandle {
  return { t: START + dayOffset * DAY_MS, o, h, l, c, v };
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

  it("tags level_confirmed for a local_stop level that leans breakout, without swaying the bias vote", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100));
    for (let i = 10; i < 15; i++) candles.push(candle(i, 118.5, 119.5, 118, 119));

    const withType = computeBreakoutSignals(candles, LEVEL, ATR, "local_stop");
    expect(withType.for).toContain("level_confirmed");
    const withoutType = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(withoutType.for).not.toContain("level_confirmed");
    // Одинаковый bias с/без метки — она не участвует в голосовании.
    expect(withType.bias).toBe(withoutType.bias);
  });

  it("does not tag level_confirmed for a local_stop level that leans false_breakout", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 6; i++) {
      const base = 90 + i * 6;
      candles.push(candle(i, base, base + 6, base - 1, base + 5));
    }
    const signals = computeBreakoutSignals(candles, LEVEL, ATR, "local_stop");
    expect(signals.bias).toBe("false_breakout");
    expect(signals.for).not.toContain("level_confirmed");
  });

  it("does not tag level_confirmed for other level types", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100));
    for (let i = 10; i < 15; i++) candles.push(candle(i, 118.5, 119.5, 118, 119));
    const signals = computeBreakoutSignals(candles, LEVEL, ATR, "structure_break");
    expect(signals.for).not.toContain("level_confirmed");
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
    // Уровень 120 пробит ТОЛЬКО ЧТО (последнее закрытие 125, до этого цена
    // была под ним) — значит подхода снизу не было, был свежий пробой вверх.
    // Ложный пробой = возврат обратно под уровень, то есть шорт.
    expect(signals.direction).toBe("short");
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

describe("computeBreakoutSignals — volume", () => {
  const LEVEL = 120;
  const ATR = 4;

  it("tags volume_supports_impulse when recent bars trade well above prior volume", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100, 1000));
    // Последние 3 бара — накопление под уровнем на объёме заметно выше фона.
    for (let i = 10; i < 15; i++) candles.push(candle(i, 118.5, 119.5, 118, 119, 1000));
    candles[12] = candle(12, 118.5, 119.5, 118, 119, 2000);
    candles[13] = candle(13, 118.5, 119.5, 118, 119, 2200);
    candles[14] = candle(14, 118.5, 119.5, 118, 119, 2100);

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.for).toContain("volume_supports_impulse");
  });

  it("tags volume_spike_on_pierce when today's bar pierces the level on a volume spike", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100, 1000));
    // Сегодняшний бар: хай проколол уровень 120, но закрылись обратно ниже — с всплеском объёма.
    candles.push(candle(10, 118, 121, 117, 119, 5000));

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.against).toContain("volume_spike_on_pierce");
  });

  it("does not tag volume signals when no source provides volume", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 102, 98, 100));
    candles.push(candle(10, 118, 121, 117, 119));

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.for).not.toContain("volume_supports_impulse");
    expect(signals.against).not.toContain("volume_spike_on_pierce");
  });
});

describe("computeBreakoutSignals — paranormal_no_pullback", () => {
  const LEVEL = 120;
  const ATR = 4;

  it("tags paranormal_no_pullback when a huge bar approaches the level and closes at its own high with no pullback", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 9; i++) candles.push(candle(i, 100, 102, 98, 100));
    // Диапазон 10 (>= 2*ATR=8), закрытие в самом хае — без внутрибарного отката.
    candles.push(candle(9, 106, 116, 106, 115.8));

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.for).toContain("paranormal_no_pullback");
  });

  it("does not tag paranormal_no_pullback when the bar pulled back from its extreme", () => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < 9; i++) candles.push(candle(i, 100, 102, 98, 100));
    // Тот же диапазон, но закрытие в середине бара — был откат внутри дня.
    candles.push(candle(9, 106, 116, 106, 111));

    const signals = computeBreakoutSignals(candles, LEVEL, ATR);
    expect(signals.for).not.toContain("paranormal_no_pullback");
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

  it("follows the actual break when the level was just taken out", () => {
    // Цена под уровнем, но оказалась там не подходом снизу, а свежим пробоем
    // вниз: пробой продолжается вниз (шорт), а не разворачивается в лонг.
    expect(biasDirection("breakout", 120, 100, "down")).toBe("short");
    expect(biasDirection("false_breakout", 120, 100, "down")).toBe("long");
    // Симметрично для пробитого вверх сопротивления.
    expect(biasDirection("breakout", 80, 100, "up")).toBe("long");
    expect(biasDirection("false_breakout", 80, 100, "up")).toBe("short");
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
