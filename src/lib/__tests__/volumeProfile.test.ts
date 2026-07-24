import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import { computeVolumeProfile } from "@/lib/orderflow";

beforeEach(() => {
  mocks.queryRaw.mockReset();
});

function makeCandle(t: number, h: number, l: number, c: number, v: number) {
  return { t: new Date(t), h, l, c, v };
}

describe("computeVolumeProfile", () => {
  const now = Date.now();
  const fromMs = now - 24 * 3_600_000;
  const toMs = now;

  it("returns null on empty candles", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).toBeNull();
  });

  it("single candle → POC = единственный уровень", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 50000, 50000, 50000, 100),
    ]);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).not.toBeNull();
    expect(result!.poc).toBeCloseTo(50000, -1);
    expect(result!.totalVolume).toBe(100);
    expect(result!.pocVolume).toBe(100);
    expect(result!.levels.length).toBe(100);
  });

  it("10 candles with uniform distribution → POC в центре диапазона", async () => {
    const candles = [];
    for (let i = 0; i < 10; i++) {
      candles.push(makeCandle(fromMs + i * 3_600_000, 51000, 49000, 50000, 100));
    }
    mocks.queryRaw.mockResolvedValueOnce(candles);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).not.toBeNull();
    // POC должен быть между 48000 и 52000 (с учётом паддинга)
    expect(result!.poc).toBeGreaterThan(48000);
    expect(result!.poc).toBeLessThan(52000);
    expect(result!.totalVolume).toBe(1000);
  });

  it("10 candles with explicit peak → POC = уровень с пиком", async () => {
    const candles = [];
    for (let i = 0; i < 10; i++) {
      candles.push(makeCandle(fromMs + i * 3_600_000, 51000, 49000, 50000, 100));
    }
    // Добавляем свечу с огромным объёмом на узком range (объём концентрируется)
    candles.push(makeCandle(fromMs + 10 * 3_600_000, 50500, 50400, 50450, 9000));
    mocks.queryRaw.mockResolvedValueOnce(candles);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).not.toBeNull();
    // POC должен быть около 50400-50500 (где огромный объём)
    expect(result!.poc).toBeGreaterThan(50000);
    expect(result!.poc).toBeLessThan(51000);
    // POC volume должен быть выше, чем у остальных уровней
    expect(result!.pocVolume).toBeGreaterThan(100);
  });

  it("Value Area 70%: VAH > VAL", async () => {
    const candles = [];
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(fromMs + i * 3_600_000, 51000, 49000, 50000, 100));
    }
    mocks.queryRaw.mockResolvedValueOnce(candles);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).not.toBeNull();
    expect(result!.vah).toBeGreaterThan(result!.val);
    expect(result!.valueAreaPct).toBe(0.7);
    expect(result!.valueAreaVolume).toBeGreaterThan(0);
  });

  it("all candles at same price → POC = этот уровень, VA = одна строка", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 50000.5, 49999.5, 50000, 100),
      makeCandle(fromMs + 3_600_000, 50000.5, 49999.5, 50000, 200),
    ]);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).not.toBeNull();
    expect(result!.poc).toBeGreaterThan(49900);
    expect(result!.poc).toBeLessThan(50100);
    expect(result!.totalVolume).toBe(300);
  });

  it("different symbols (BTC=50000, ETH=3000) → корректные бины", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 51000, 49000, 50000, 100),
    ]);
    const btc = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(btc).not.toBeNull();
    expect(btc!.poc).toBeGreaterThan(40000);

    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 3100, 2900, 3000, 100),
    ]);
    const eth = await computeVolumeProfile("ETHUSDT", "binance-futures", fromMs, toMs);
    expect(eth).not.toBeNull();
    expect(eth!.poc).toBeLessThan(4000);
  });

  it("large price range (10000-60000) → равномерное распределение бинов", async () => {
    const candles = [];
    for (let i = 0; i < 10; i++) {
      candles.push(makeCandle(
        fromMs + i * 3_600_000,
        60000 - i * 5000,
        10000 + i * 5000,
        35000,
        100,
      ));
    }
    mocks.queryRaw.mockResolvedValueOnce(candles);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    expect(result).not.toBeNull();
    expect(result!.totalVolume).toBe(1000);
    expect(result!.levels.length).toBe(100);
  });

  it("uses custom bins count", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 50000, 50000, 50000, 100),
    ]);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs, { bins: 50 });
    expect(result).not.toBeNull();
    expect(result!.levels.length).toBe(50);
  });

  it("uses custom valueAreaPct", async () => {
    const candles = [];
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(fromMs + i * 3_600_000, 51000, 49000, 50000, 100));
    }
    mocks.queryRaw.mockResolvedValueOnce(candles);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs, { valueAreaPct: 0.5 });
    expect(result).not.toBeNull();
    expect(result!.valueAreaPct).toBe(0.5);
  });

  it("exchange='all' does not filter by exchange", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 50000, 50000, 50000, 100),
    ]);
    const result = await computeVolumeProfile("BTCUSDT", "all", fromMs, toMs);
    expect(result).not.toBeNull();
    expect(result!.totalVolume).toBe(100);
  });

  it("zero volume candles are skipped", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      makeCandle(fromMs + 1000, 50000, 49000, 49500, 0),
      makeCandle(fromMs + 2000, 50000, 49000, 49500, 0),
    ]);
    const result = await computeVolumeProfile("BTCUSDT", "binance-futures", fromMs, toMs);
    // Все объёмы = 0 → POC volume = 0
    expect(result).not.toBeNull();
    expect(result!.totalVolume).toBe(0);
    expect(result!.pocVolume).toBe(0);
  });
});