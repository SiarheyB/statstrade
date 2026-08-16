import { describe, it, expect } from "vitest";
import {
  assessLevelQuality,
  countCrossings,
  contaminationRatio,
  findPierces,
  maxConsecutivePierces,
  passesQualityGate,
  runwayAtr,
  DEFAULT_THRESHOLDS,
  type LevelQuality,
} from "../quality";
import type { DailyCandle } from "../levels";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const ATR = 4;

function candle(day: number, o: number, h: number, l: number, c: number): DailyCandle {
  return { t: START + day * DAY_MS, o, h, l, c };
}

// Ровный фон под уровнем 120: цена ходит около 100, уровня не касается.
function background(bars: number, from = 0): DailyCandle[] {
  return Array.from({ length: bars }, (_, i) => candle(from + i, 100, 102, 98, 100));
}

describe("countCrossings", () => {
  it("counts none when price stays on one side", () => {
    expect(countCrossings(background(20), 120, ATR, 0.1)).toBe(0);
  });

  it("counts each time closes flip across the level", () => {
    const candles = [
      ...background(3),
      candle(3, 118, 126, 118, 125), // выше уровня
      candle(4, 125, 126, 112, 114), // обратно вниз
      candle(5, 114, 128, 114, 127), // снова выше
    ];
    expect(countCrossings(candles, 120, ATR, 0.1)).toBe(3);
  });

  it("ignores closes inside the deadband around the level", () => {
    const candles = [
      candle(0, 100, 102, 98, 100),
      candle(1, 118, 122, 118, 120.2), // прямо на уровне — не сторона
      candle(2, 100, 102, 98, 100),
    ];
    expect(countCrossings(candles, 120, ATR, 0.1)).toBe(0);
  });
});

describe("findPierces", () => {
  it("counts a wick through the level that closes back, with its depth", () => {
    const candles = [...background(3), candle(3, 118, 123, 117, 118)]; // хай 123 при уровне 120
    const { count, deepestAtr } = findPierces(candles, 120, ATR, 0.25);
    expect(count).toBe(1);
    expect(deepestAtr).toBeCloseTo(3 / ATR, 5);
  });

  it("ignores shallow pokes below the minimum pierce depth", () => {
    const candles = [...background(3), candle(3, 118, 120.5, 117, 118)]; // прокол 0.125×ATR
    expect(findPierces(candles, 120, ATR, 0.25).count).toBe(0);
  });

  it("does not count a bar that closed beyond the level (это пробой, не ЛП)", () => {
    const candles = [...background(3), candle(3, 118, 126, 118, 125)];
    expect(findPierces(candles, 120, ATR, 0.25).count).toBe(0);
  });
});

describe("maxConsecutivePierces", () => {
  it("counts a single pierce as a streak of one", () => {
    const candles = [...background(3), candle(3, 118, 123, 117, 118), ...background(2, 4)];
    expect(maxConsecutivePierces(candles, 120, ATR, 0.08)).toBe(1);
  });

  it("detects two bars in a row piercing the level (уровень распилен)", () => {
    // Как на GEV: бар от 14-го проколол уровень и вернулся, и бар от 15-го тоже.
    const candles = [...background(3), candle(3, 118, 123, 117, 118), candle(4, 118, 124, 117, 119)];
    expect(maxConsecutivePierces(candles, 120, ATR, 0.08)).toBe(2);
  });

  it("does not merge pierces separated by a normal bar", () => {
    const candles = [
      ...background(3),
      candle(3, 118, 123, 117, 118),
      candle(4, 118, 119, 117, 118), // до уровня не дошёл — серия оборвалась
      candle(5, 118, 123, 117, 118),
    ];
    expect(maxConsecutivePierces(candles, 120, ATR, 0.08)).toBe(1);
  });
});

describe("contaminationRatio", () => {
  it("is zero when nothing traded beyond the level", () => {
    expect(contaminationRatio(background(20), 120, ATR, "above", 1)).toBe(0);
  });

  it("grows with the share of bars that traded in the zone past the level", () => {
    const candles = [...background(15), ...Array.from({ length: 5 }, (_, i) => candle(15 + i, 121, 123, 120, 122))];
    expect(contaminationRatio(candles, 120, ATR, "above", 1)).toBeCloseTo(0.25, 5);
  });
});

describe("runwayAtr", () => {
  it("returns Infinity when there is no significant level beyond", () => {
    expect(runwayAtr(120, [90, 100], ATR, "above")).toBe(Infinity);
  });

  it("measures the distance to the nearest level in the breakout direction", () => {
    expect(runwayAtr(120, [100, 128, 140], ATR, "above")).toBeCloseTo(2, 5);
    expect(runwayAtr(120, [100, 128, 140], ATR, "below")).toBeCloseTo(5, 5);
  });
});

describe("assessLevelQuality", () => {
  it("describes a clean level the last bar closed right under", () => {
    const candles = [...background(40), candle(40, 118, 119.5, 117.5, 119.4)];
    const q = assessLevelQuality(candles, 120, ATR, 119.4, [140]);

    expect(q.side).toBe("above");
    expect(q.crossings).toBe(0);
    expect(q.falseBreakouts).toBe(0);
    expect(q.contamination).toBe(0);
    expect(q.closeDistanceAtr).toBeCloseTo(0.15, 5);
    expect(q.touched).toBe(true);
    expect(q.approachGapAtr).toBeCloseTo(0.125, 5); // (120 - 119.5) / 4
    expect(q.approachNetMoveAtr).toBeCloseTo(4.85, 5); // |119.4 - 100| / 4, окно 10 баров
    expect(q.runwayAtr).toBeCloseTo(5, 5);
  });

  it("does not count today's own approach as a pierce", () => {
    // Сегодняшний бар прокалывает уровень и закрывается обратно — это текущий
    // сетап, а не «грязная» история слева.
    const candles = [...background(40), candle(40, 118, 124, 117, 118)];
    expect(assessLevelQuality(candles, 120, ATR, 118, []).falseBreakouts).toBe(0);
  });

  it("counts shallow pierces as a streak (реальный кейс GEV)", () => {
    // Второй прокол мельче minPierceAtr (0.08×ATR) и по отдельности сошёл бы за
    // шум — ровно так GEV и проходил гейт. Два дня подряд за уровнем — распил.
    const candles = [
      ...background(40),
      candle(40, 118, 120.37, 117, 118), // +0.094×ATR за уровень 120
      candle(41, 118, 120.26, 117, 119), // +0.066×ATR
    ];
    const q = assessLevelQuality(candles, 120, ATR, 119, []);
    expect(q.falseBreakouts).toBe(1); // по порогу шума виден только первый
    expect(q.consecutiveFalseBreakouts).toBe(2);
    expect(passesQualityGate(q, "breakout", CALM).rejectedBy).toContain("consecutive_false_breakouts");
  });

  it("sees a pierce streak that ends on the last closed bar", () => {
    // Кейс GEV: предпоследний и последний закрытые бары оба проткнули уровень и
    // вернулись. falseBreakouts (без последнего бара) насчитает всего один —
    // распил виден только через серию.
    const candles = [...background(40), candle(40, 118, 123, 117, 118), candle(41, 118, 124, 117, 119)];
    const q = assessLevelQuality(candles, 120, ATR, 119, []);
    expect(q.falseBreakouts).toBe(1);
    expect(q.consecutiveFalseBreakouts).toBe(2);
    expect(passesQualityGate(q, "breakout", CALM).rejectedBy).toContain("consecutive_false_breakouts");
  });
});

function quality(overrides: Partial<LevelQuality> = {}): LevelQuality {
  return {
    side: "above",
    crossings: 0,
    falseBreakouts: 0,
    deepestFalseBreakoutAtr: 0,
    consecutiveFalseBreakouts: 0,
    contamination: 0,
    runwayAtr: Infinity,
    closeDistanceAtr: 0.1,
    touched: true,
    approachGapAtr: 0.1,
    approachRatio: 0.5,
    gapApproach: false,
    approachNetMoveAtr: 0.3,
    ...overrides,
  };
}

const CALM = { for: ["small_bars_approach"], against: [] };
const NEUTRAL = { for: [], against: [] };

describe("passesQualityGate", () => {
  it("passes a clean level with a calm approach as a breakout setup", () => {
    expect(passesQualityGate(quality(), "breakout", CALM).ok).toBe(true);
  });

  it.each([
    ["close_far_from_level", { closeDistanceAtr: 0.9 }],
    ["did_not_reach_level", { touched: false }],
    ["level_chopped", { crossings: 4 }],
    ["too_many_false_breakouts", { falseBreakouts: 3 }],
    ["consecutive_false_breakouts", { consecutiveFalseBreakouts: 2 }],
    ["deep_false_breakout", { deepestFalseBreakoutAtr: 1.2 }],
    ["contaminated_zone", { contamination: 0.4 }],
    ["no_runway", { runwayAtr: 0.3 }],
  ])("rejects with %s", (reason, overrides) => {
    const res = passesQualityGate(quality(overrides as Partial<LevelQuality>), "breakout", CALM);
    expect(res.ok).toBe(false);
    expect(res.rejectedBy).toContain(reason);
  });

  it("requires a calm approach for a breakout", () => {
    const res = passesQualityGate(quality({ approachRatio: 2 }), "breakout", { for: [], against: [] });
    expect(res.rejectedBy).toContain("no_breakout_preconditions");
  });

  it("rejects a breakout that approached the level through a gap", () => {
    const res = passesQualityGate(quality({ gapApproach: true }), "breakout", CALM);
    expect(res.rejectedBy).toContain("no_breakout_preconditions");
  });

  it("requires a fast approach — sustained net move or a gap — for a false breakout", () => {
    const calm = passesQualityGate(quality({ approachGapAtr: 1.5 }), "false_breakout", NEUTRAL);
    expect(calm.rejectedBy).toContain("no_false_breakout_preconditions");

    expect(passesQualityGate(quality({ approachGapAtr: 1.5, approachNetMoveAtr: 2 }), "false_breakout", NEUTRAL).ok).toBe(true);
    expect(passesQualityGate(quality({ approachGapAtr: 1.5, gapApproach: true }), "false_breakout", NEUTRAL).ok).toBe(true);
  });

  it("does not count a noisy last few bars as a fast approach when the multi-day net move stayed small (закруглення — a breakout plus, not an LP precondition)", () => {
    // AIXBTUSDT/TXNUSDT/BIRBUSDT/SCRUSDT-кейс: пара крупных баров в хвосте
    // долгого пологого закругления к уровню — approachRatio может быть
    // большим, но approachNetMoveAtr (весь путь подхода) остаётся маленьким.
    const res = passesQualityGate(
      quality({ approachGapAtr: 1.2, approachRatio: 1.8, approachNetMoveAtr: 0.6 }),
      "false_breakout",
      { for: [], against: ["big_bars_approach"] },
    );
    expect(res.ok).toBe(false);
    expect(res.rejectedBy).toContain("no_false_breakout_preconditions");
  });

  it("rejects a false breakout when yesterday's bar already sat close to the level (no room left for today's pierce-and-return)", () => {
    // Именно кейс из карточки SNXXUSDT: подход близкий (approachGapAtr мал),
    // хотя быстрый подход формально есть — это не настоящая предпосылка ЛП.
    const res = passesQualityGate(quality({ approachGapAtr: 0.2, approachNetMoveAtr: 2 }), "false_breakout", NEUTRAL);
    expect(res.ok).toBe(false);
    expect(res.rejectedBy).toContain("close_near_level");
  });

  it("passes a false breakout when yesterday's bar stopped a full ATR short of the level with a fast approach", () => {
    const res = passesQualityGate(quality({ approachGapAtr: 1, approachNetMoveAtr: 2 }), "false_breakout", NEUTRAL);
    expect(res.ok).toBe(true);
  });

  it("keeps the documented thresholds", () => {
    // Пороги — «договор» с методичкой, меняем осознанно, а не случайной правкой.
    expect(DEFAULT_THRESHOLDS.maxCrossings).toBe(1);
    expect(DEFAULT_THRESHOLDS.maxFalseBreakouts).toBe(1);
    expect(DEFAULT_THRESHOLDS.maxCloseDistanceAtr).toBe(0.25);
    expect(DEFAULT_THRESHOLDS.minFalseBreakoutApproachGapAtr).toBe(1);
    expect(DEFAULT_THRESHOLDS.fastApproachWindow).toBe(10);
    expect(DEFAULT_THRESHOLDS.minFastApproachNetMoveAtr).toBe(1.5);
  });
});
