/**
 * Tests for computeAbsorption — Absorption Pattern Detector
 * src/lib/orderflow.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем Prisma, чтобы fetchOrderflowCandles и computeAbsorption
// получали контролируемые данные.
const mocks = vi.hoisted(() => {
  type CandleRow = { t: Date; o: number; h: number; l: number; c: number };
  type FpRow = { col: number; buy: number; sell: number };

  const findMany = vi.fn<() => Promise<CandleRow[]>>();
  const queryRaw = vi.fn<() => Promise<FpRow[]>>();

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

// Mock Prisma.sql and Prisma.empty for template literal SQL
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((acc, s, i) => acc + String(values[i - 1] ?? "") + s),
    empty: "",
  },
}));

import { computeAbsorption } from "@/lib/orderflow";

const STEP_MS = 60_000; // 1 мин
const START_MS = 1_000_000_000_000;
const BG_CANDLES = 200;
const TOTAL_CANDLES = 250;

// Хелпер: N свечей, фон с нормальным диапазоном, затем паттерн с absorption.
function makeCandles(
  total: number,
  bgRange: number,
  narrowRange: number,
  patternStart: number,
  patternLen: number,
): { t: Date; o: number; h: number; l: number; c: number }[] {
  const rows: { t: Date; o: number; h: number; l: number; c: number }[] = [];
  for (let i = 0; i < total; i++) {
    const base = 50000;
    const isNarrow = i >= patternStart && i < patternStart + patternLen;
    const range = isNarrow ? narrowRange : bgRange;
    rows.push({
      t: new Date(START_MS + i * STEP_MS),
      o: base + i * 0.1,
      h: base + i * 0.1 + range / 2,
      l: base + i * 0.1 - range / 2,
      c: base + i * 0.1,
    });
  }
  return rows;
}

// Хелпер: footprint колонки.
function makeFootprint(
  total: number,
  normalVol: number,
  normalBuyRatio: number,
  patternStart: number,
  patternLen: number,
  patternVol: number,
  patternBuyRatio: number,
): { col: number; buy: number; sell: number }[] {
  const rows: { col: number; buy: number; sell: number }[] = [];
  for (let i = 0; i < total; i++) {
    const isPattern = i >= patternStart && i < patternStart + patternLen;
    const vol = isPattern ? patternVol : normalVol;
    const buyRatio = isPattern ? patternBuyRatio : normalBuyRatio;
    const buy = Math.round(vol * buyRatio);
    const sell = Math.round(vol * (1 - buyRatio));
    rows.push({ col: i, buy, sell });
  }
  return rows;
}

describe("computeAbsorption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there are too few candles", async () => {
    // fetchOrderflowCandles требует CANDLES_IN_WINDOW["1w"] = 200 свечей.
    // Даём < 200 — должно вернуть пустой массив → null.
    mocks.findMany.mockResolvedValue(makeCandles(5, 10, 2, 5, 0));
    mocks.queryRaw.mockResolvedValue([]);

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + 20 * STEP_MS);
    expect(result).toBeNull();
  });

  it("returns null when footprint is empty", async () => {
    mocks.findMany.mockResolvedValue(makeCandles(TOTAL_CANDLES, 10, 2, 200, 3));
    mocks.queryRaw.mockResolvedValue([]);

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS);
    expect(result).toBeNull();
  });

  it("detects an absorption pattern", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 3;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 3000, 0.5),
    );

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS);
    expect(result).not.toBeNull();
    expect(result!.signals.length).toBeGreaterThan(0);
    expect(result!.signals[0].duration).toBe(patternLen);
    expect(result!.signals[0].volumeMultiplier).toBeGreaterThan(2);
    expect(result!.signals[0].deltaRatio).toBeLessThan(0.15);
  });

  it("returns empty signals when volume multiplier is below threshold", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 3;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    // Нормальный объём = 500, паттерн = 500 — недостаточно
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 500, 0.5),
    );

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS);
    expect(result).not.toBeNull();
    expect(result!.signals).toHaveLength(0);
  });

  it("returns empty signals when delta ratio exceeds threshold", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 3;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    // Высокий объём, но сильный дисбаланс дельты (buy/sell = 0.9/0.1 → |Δ|/V = 0.8)
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 3000, 0.9),
    );

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS);
    expect(result).not.toBeNull();
    expect(result!.signals).toHaveLength(0);
  });

  it("respects custom minVolumeMultiplier", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 3;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    // 3000/500 = 6×, но порог 10× — не пройдёт
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 3000, 0.5),
    );

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      minVolumeMultiplier: 10,
    });
    expect(result).not.toBeNull();
    expect(result!.signals).toHaveLength(0);
  });

  it("respects custom maxDeltaRatio", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 3;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    // buy/sell = 1800/1200 → |Δ|/V = 600/3000 = 0.2, порог 0.1 — не пройдёт
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 3000, 0.6),
    );

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      maxDeltaRatio: 0.1,
    });
    expect(result).not.toBeNull();
    expect(result!.signals).toHaveLength(0);
  });

  it("returns empty signals when pattern is shorter than minCandles", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 2;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 3000, 0.5),
    );

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS, {
      minCandles: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.signals).toHaveLength(0);
  });

  it("handles all exchange filter", async () => {
    const patternStart = BG_CANDLES;
    const patternLen = 3;
    mocks.findMany.mockResolvedValue(
      makeCandles(TOTAL_CANDLES, 10, 1.5, patternStart, patternLen),
    );
    mocks.queryRaw.mockResolvedValue(
      makeFootprint(TOTAL_CANDLES, 500, 0.5, patternStart, patternLen, 3000, 0.5),
    );

    const result = await computeAbsorption("BTCUSDT", "all", "1w", START_MS, START_MS + TOTAL_CANDLES * STEP_MS);
    expect(result).not.toBeNull();
    expect(result!.signals.length).toBeGreaterThan(0);
  });

  it("detects multiple separate absorption patterns", async () => {
    const total = 250;
    const pattern1Start = 200;
    const pattern2Start = 230;
    const patternLen = 3;

    const candles = makeCandles(total, 10, 1.5, pattern1Start, patternLen);
    // Override candles 230-232 to also be narrow
    for (let i = pattern2Start; i < pattern2Start + patternLen; i++) {
      candles[i].h = 50000 + i * 0.1 + 0.75;
      candles[i].l = 50000 + i * 0.1 - 0.75;
    }
    mocks.findMany.mockResolvedValue(candles);

    // Both patterns have high volume
    const fp = makeFootprint(total, 500, 0.5, pattern1Start, patternLen, 3000, 0.5);
    // Override for second pattern
    for (let i = pattern2Start; i < pattern2Start + patternLen; i++) {
      const idx = fp.findIndex((r) => r.col === i);
      if (idx >= 0) {
        fp[idx] = { col: i, buy: 1800, sell: 1700 };
      }
    }
    mocks.queryRaw.mockResolvedValue(fp);

    const result = await computeAbsorption("BTCUSDT", "binance", "1w", START_MS, START_MS + total * STEP_MS);
    expect(result).not.toBeNull();
    expect(result!.signals.length).toBe(2);
  });
});