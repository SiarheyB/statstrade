/**
 * Тесты для computeDivergence — обнаружение дивергенций цена vs дельта/CVD
 * src/lib/orderflow.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем Prisma на уровне модуля, чтобы fetchOrderflowCandles и computeDelta
// получали контролируемые данные из БД.
const mocks = vi.hoisted(() => {
  type CandleRow = { t: Date; o: number; h: number; l: number; c: number };
  type DeltaRow = { col: number; buy: number; sell: number };

  const findMany = vi.fn<() => Promise<CandleRow[]>>();
  const queryRaw = vi.fn<() => Promise<DeltaRow[]>>();

  return {
    findMany,
    queryRaw,
    prisma: {
      obCandle: { findMany },
      $queryRaw: queryRaw,
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import { computeDivergence } from "@/lib/orderflow";

// CANDLES_IN_WINDOW для "1w" = 200 — минимальное количество, которое
// fetchOrderflowCandles требует, чтобы не падать на Binance fallback.
// Используем TOTAL_CANDLES = 240, чтобы каждый candleStepMs совпадал
// ровно с одним дельта-бакетом (computeDelta делит окно на 240 колонок).
// Генерируем 200 "фоновых" свечей с плоской ценой, затем 40 свечей с
// паттерном дивергенции (total = 240).
const BG_CANDLES = 200;
const PATTERN_CANDLES = 40;
const TOTAL_CANDLES = BG_CANDLES + PATTERN_CANDLES; // 240
const STEP_MS = 60_000; // 1 мин
const START_MS = 1_000_000_000_000;

// Хелпер: создаёт фон + паттерн дивергенции.
// bgPrice — цена для фоновых свечей.
// patternHighs, patternLows — паттерн последних 10 свечей.
function makeCandles(
  bgPrice: number,
  patternHighs: number[],
  patternLows: number[],
): { t: Date; o: number; h: number; l: number; c: number }[] {
  const rows: { t: Date; o: number; h: number; l: number; c: number }[] = [];
  // Фон: плоские свечи
  for (let i = 0; i < BG_CANDLES; i++) {
    rows.push({
      t: new Date(START_MS + i * STEP_MS),
      o: bgPrice,
      h: bgPrice,
      l: bgPrice,
      c: bgPrice,
    });
  }
  // Паттерн: 10 свечей с дивергенцией
  for (let i = 0; i < patternHighs.length; i++) {
    const idx = BG_CANDLES + i;
    rows.push({
      t: new Date(START_MS + idx * STEP_MS),
      o: patternLows[i],
      h: patternHighs[i],
      l: patternLows[i],
      c: (patternHighs[i] + patternLows[i]) / 2,
    });
  }
  return rows;
}

// Хелпер: генерирует строки delta в формате $queryRaw для 240 колонок.
// bgDelta — фоновая дельта, pattern — паттерн последних 10 свечей.
function makeDelta(
  bgDelta: number,
  pattern: number[],
): { col: number; buy: number; sell: number }[] {
  const totalMs = TOTAL_CANDLES * STEP_MS;
  const cols = 240;
  const bucketMs = totalMs / cols;
  const rows: { col: number; buy: number; sell: number }[] = [];

  function addDelta(col: number, d: number) {
    const clamped = Math.max(0, Math.min(cols - 1, col));
    if (d >= 0) {
      rows.push({ col: clamped, buy: d, sell: 0 });
    } else {
      rows.push({ col: clamped, buy: 0, sell: Math.abs(d) });
    }
  }

  // Фон
  for (let i = 0; i < BG_CANDLES; i++) {
    const cStart = START_MS + i * STEP_MS;
    const colStart = Math.floor((cStart - START_MS) / bucketMs);
    const colEnd = Math.floor((cStart + STEP_MS - 1 - START_MS) / bucketMs);
    const nCols = Math.max(1, colEnd - colStart + 1);
    const perCol = bgDelta / nCols;
    for (let c = colStart; c <= colEnd; c++) {
      addDelta(c, perCol);
    }
  }

  // Паттерн
  for (let i = 0; i < pattern.length; i++) {
    const idx = BG_CANDLES + i;
    const cStart = START_MS + idx * STEP_MS;
    const colStart = Math.floor((cStart - START_MS) / bucketMs);
    const colEnd = Math.floor((cStart + STEP_MS - 1 - START_MS) / bucketMs);
    const nCols = Math.max(1, colEnd - colStart + 1);
    const perCol = pattern[i] / nCols;
    for (let c = colStart; c <= colEnd; c++) {
      addDelta(c, perCol);
    }
  }
  return rows;
}

describe("computeDivergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there are too few candles", async () => {
    mocks.findMany.mockResolvedValue(makeCandles(100, [105, 110], [99, 104]).slice(0, 1));
    mocks.queryRaw.mockResolvedValue([]);

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + 100 * STEP_MS);
    expect(result).toBeNull();
  });

  it("returns null when delta is empty", async () => {
    mocks.findMany.mockResolvedValue(makeCandles(100, [105, 110], [99, 104]));
    mocks.queryRaw.mockResolvedValue([]);

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + 100 * STEP_MS);
    expect(result).toBeNull();
  });

  it("no divergence when price and delta move together", async () => {
    // Последние 10 свечей: цена растёт, дельта растёт — нет дивергенции
    const highs = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118];
    const lows = [99, 101, 103, 105, 107, 109, 111, 113, 115, 117];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    mocks.queryRaw.mockResolvedValue(makeDelta(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      lookbackBars: 10,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    expect(result!.signals.length).toBe(0);
  });

  it("detects Regular Bearish Divergence (price HH, delta LH)", async () => {
    // Цена: peaks at 2 (115) and 6 (120) → HH
    // Дельта: 8 at peak 2, 5 at peak 6 → LH
    const highs = [100, 110, 115, 112, 109, 106, 120, 117, 114, 111];
    const lows = [99, 109, 114, 111, 108, 105, 119, 116, 113, 110];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    mocks.queryRaw.mockResolvedValue(makeDelta(0, [2, 5, 8, 3, 1, 0, 5, 2, 0, -1]));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      lookbackBars: 10,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    const rb = result!.signals.filter((s) => s.type === "regular_bearish");
    expect(rb.length).toBeGreaterThanOrEqual(1);
    expect(rb[0].label).toBe("Regular Bearish");
  });

  it("detects Regular Bullish Divergence (price LL, delta HL)", async () => {
    // Цена: 102 → 97 → 92 → 95 → ... → 85 (troughs at 2 and 6: LL)
    // Дельта: -8 → -3 (HL: -8→-3)
    const highs = [102, 97, 92, 95, 98, 101, 87, 90, 93, 96];
    const lows = [100, 95, 90, 93, 96, 99, 85, 88, 91, 94];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    mocks.queryRaw.mockResolvedValue(makeDelta(0, [-2, -5, -8, -3, -1, 0, -3, 0, 1, 2]));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      lookbackBars: 10,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    const rbu = result!.signals.filter((s) => s.type === "regular_bullish");
    expect(rbu.length).toBeGreaterThanOrEqual(1);
    expect(rbu[0].label).toBe("Regular Bullish");
  });

  it("detects Hidden Bullish Divergence (price LH, delta HH)", async () => {
    // Цена: 110 → 115 → 112 → ... → 108 (peaks at 1 and 6: LH)
    // Дельта: 5 → 21 (HH)
    const highs = [110, 115, 112, 109, 106, 103, 108, 105, 102, 99];
    const lows = [108, 113, 110, 107, 104, 101, 106, 103, 100, 97];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    mocks.queryRaw.mockResolvedValue(makeDelta(0, [2, 5, 8, 12, 15, 18, 21, 24, 27, 30]));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      lookbackBars: 10,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    const hb = result!.signals.filter((s) => s.type === "hidden_bullish");
    expect(hb.length).toBeGreaterThanOrEqual(1);
    expect(hb[0].label).toBe("Hidden Bullish");
  });

  it("detects Hidden Bearish Divergence (price HL, delta LL)", async () => {
    // Цена: troughs at 1 (85) and 6 (95) → HL
    // Дельта: -8 at trough 1, -12 at trough 6 → LL
    const highs = [92, 87, 90, 93, 96, 99, 97, 100, 103, 106];
    const lows = [90, 85, 88, 91, 94, 97, 95, 98, 101, 104];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    mocks.queryRaw.mockResolvedValue(makeDelta(0, [-4, -8, -5, -3, -1, 0, -12, -10, -8, -6]));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      lookbackBars: 10,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    const hbe = result!.signals.filter((s) => s.type === "hidden_bearish");
    expect(hbe.length).toBeGreaterThanOrEqual(1);
    expect(hbe[0].label).toBe("Hidden Bearish");
  });

  it("filters by minStrength = 3", async () => {
    // 15 свечей, peaks at 2 (110) and 11 (130) → bars = 9 → strength = 4
    const highs = [100, 105, 110, 108, 106, 104, 102, 100, 98, 105, 115, 130, 125, 120, 115];
    const lows = [99, 104, 109, 107, 105, 103, 101, 99, 97, 104, 114, 129, 124, 119, 114];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    // Delta: 8 at peak 2, 5 at peak 11 → LH
    const delta = [2, 5, 8, 3, 1, 0, -1, -2, -3, 0, 3, 5, 2, 0, -1];
    mocks.queryRaw.mockResolvedValue(makeDelta(0, delta));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      minStrength: 3,
      lookbackBars: 15,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    expect(result!.signals.length).toBeGreaterThanOrEqual(1);
    for (const s of result!.signals) {
      expect(s.strength).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns empty when no divergence", async () => {
    const highs = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const lows = [99, 100, 101, 102, 103, 104, 105, 106, 107, 108];
    mocks.findMany.mockResolvedValue(makeCandles(100, highs, lows));
    mocks.queryRaw.mockResolvedValue(makeDelta(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

    const result = await computeDivergence("BTCUSDT", "binance-futures", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      lookbackBars: 10,
      minDivergenceBars: 2,
      maxDivergenceBars: 20,
    });
    expect(result).not.toBeNull();
    expect(result!.signals.length).toBe(0);
    expect(result!.totalCount).toBe(0);
    expect(result!.activeCount).toBe(0);
  });
});