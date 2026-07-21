import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  obCandleFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    obBigTrade: { findMany: mocks.findMany },
    obCandle: {
      findMany: mocks.obCandleFindMany,
    },
  },
}));

import {
  fetchOrderflowCandles,
  computeDelta,
  computeFootprint,
  computeBA,
  computeBigTrades,
  computeOrderflow,
} from "@/lib/orderflow";

beforeEach(() => {
  mocks.queryRaw.mockReset();
  mocks.findMany.mockReset();
  mocks.obCandleFindMany.mockReset();
});

describe("fetchOrderflowCandles", () => {
  beforeEach(() => {
    mocks.obCandleFindMany.mockReset();
  });

  it("maps ObCandle rows to OfCandle", async () => {
    const now = Date.now();
    const fromMs = now - 3_600_000 * 100;
    mocks.obCandleFindMany.mockResolvedValue([
      { t: new Date(fromMs + 1000), o: 100, h: 110, l: 90, c: 105 },
      { t: new Date(now - 600_000), o: 105, h: 115, l: 95, c: 108 },
    ]);

    const out = await fetchOrderflowCandles("BTCUSDT", "binance", "1h", fromMs, now);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ t: fromMs + 1000, o: 100, h: 110, l: 90, c: 105 });
  });

  it("uses 1m fallback for unknown range", async () => {
    mocks.obCandleFindMany.mockResolvedValue([]);

    const out = await fetchOrderflowCandles("BTCUSDT", "binance-spot", "weird", 0, 1);
    expect(out).toEqual([]);
    expect(mocks.obCandleFindMany).toHaveBeenCalledWith({
      where: {
        symbol: "BTCUSDT",
        exchange: "binance-spot",
        interval: "1m",
        t: { gte: new Date(0), lte: new Date(1) },
      },
      orderBy: { t: "asc" },
      select: { t: true, o: true, h: true, l: true, c: true },
    });
  });

  it("returns [] when findMany throws", async () => {
    mocks.obCandleFindMany.mockRejectedValue(new Error("db"));
    const out = await fetchOrderflowCandles("BTCUSDT", "binance", "1h", 0, 1);
    expect(out).toEqual([]);
  });
});

describe("computeDelta", () => {
  it("returns null on empty rows", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await computeDelta("BTCUSDT", "binance", 0, 1000, 4)).toBeNull();
  });

  it("builds buy/sell/delta/cvd arrays and clamps cols", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { col: 0, buy: 10, sell: 4 },
      { col: 3, buy: 5, sell: 9 },
      { col: 99, buy: 1, sell: 1 }, // вне диапазона -> clamp к cols-1
    ]);
    const d = await computeDelta("BTCUSDT", "binance", 0, 1000, 4);
    expect(d).not.toBeNull();
    expect(d!.buy).toEqual([10, 0, 0, 6]);
    expect(d!.sell).toEqual([4, 0, 0, 10]);
    expect(d!.delta).toEqual([6, 0, 0, -4]);
    expect(d!.cvd).toEqual([6, 6, 6, 2]);
    expect(d!.times).toHaveLength(4);
  });
});

describe("computeFootprint", () => {
  it("returns null on empty rows", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await computeFootprint("BTCUSDT", "binance", "15m", 0, 1000)).toBeNull();
  });

  it("groups levels by bucket, skips zero-volume rows, tracks maxVol", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { bucket: BigInt(1000), price: 100, buy: 2, sell: 3 },
      { bucket: BigInt(1000), price: 101, buy: 0, sell: 0 }, // пропускается
      { bucket: BigInt(2000), price: 102, buy: 4, sell: 1 },
    ]);
    const fp = await computeFootprint("BTCUSDT", "binance", "15m", 0, 1000);
    expect(fp).not.toBeNull();
    expect(fp!.interval).toBe(15 * 60_000);
    expect(fp!.maxVol).toBe(5);
    expect(fp!.candles).toEqual([
      { t: 1000, levels: [{ price: 100, buy: 2, sell: 3 }] },
      { t: 2000, levels: [{ price: 102, buy: 4, sell: 1 }] },
    ]);
  });
});

describe("computeBA", () => {
  it("uses the rollup fast path and returns ratios", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { col: 0, full_bid: 10, full_ask: 10, near_bid: 5, near_ask: 5 },
      { col: 1, full_bid: 0, full_ask: 0, near_bid: 0, near_ask: 0 },
    ]);
    const ba = await computeBA("BTCUSDT", "binance", 0, 1000, 2);
    expect(ba).not.toBeNull();
    expect(ba!.times).toHaveLength(2);
    expect(ba!.full).toEqual([0.5, 0.5]);
    expect(ba!.near).toEqual([0.5, 0.5]);
  });

  it("falls back to raw path when rollup is empty", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]); // rollup пуст
    mocks.queryRaw.mockResolvedValueOnce([
      { col: 0, full_bid: 20, full_ask: 10, near_bid: 8, near_ask: 2 },
      { col: 1, full_bid: 6, full_ask: 6, near_bid: 0, near_ask: 0 },
    ]);
    const ba = await computeBA("BTCUSDT", "binance", 0, 1000, 2);
    expect(ba).not.toBeNull();
    expect(ba!.full[0]).toBeCloseTo(20 / 30, 5);
    expect(ba!.near[0]).toBeCloseTo(8 / 10, 5);
    expect(ba!.full[1]).toBe(0.5);
  });
});

describe("computeBigTrades", () => {
  it("maps rows to BigTrade with epoch t", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { t: new Date(1000), price: 50000, qty: 0.5, side: "buy", exchange: "binance" },
      { t: new Date(2000), price: 50010, qty: 1.2, side: "sell", exchange: "binance" },
    ]);
    const out = await computeBigTrades("BTCUSDT", "binance", 0, 3000, 60);
    expect(out).toEqual([
      { t: 1000, price: 50000, qty: 0.5, side: "buy", exchange: "binance" },
      { t: 2000, price: 50010, qty: 1.2, side: "sell", exchange: "binance" },
    ]);
  });
});

describe("computeOrderflow", () => {
  it("returns null when both rollup and legacy cells are empty", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]); // rollup cells
    mocks.queryRaw.mockResolvedValueOnce([]); // legacy cells
    expect(await computeOrderflow("BTCUSDT", "binance", 0, 1000)).toBeNull();
  });

  it("builds heatmap from rollup (fast path) with last-snapshot profile", async () => {
    // 1: cells rollup, 2: colStats, 3: lastRows
    mocks.queryRaw
      .mockResolvedValueOnce([
        { col: 0, price: 100, vol: 50 },
        { col: 1, price: 105, vol: 30 },
      ])
      .mockResolvedValueOnce([
        { col: 0, n: 1, ex: 1 },
        { col: 1, n: 1, ex: 1 },
      ])
      .mockResolvedValueOnce([
        { t: new Date(1000), exchange: "binance", price: 100, bidVol: 5, askVol: 7 },
      ]);
    const hm = await computeOrderflow("BTCUSDT", "binance", 0, 1000);
    expect(hm).not.toBeNull();
    expect(hm!.bins).toBe(110);
    expect(hm!.cols).toBe(240);
    expect(hm!.grid).toHaveLength(240);
    expect(hm!.grid[0]).toHaveLength(110);
    expect(hm!.maxVal).toBe(50);
    expect(hm!.price).toBe(100);
    expect(hm!.profileMax).toBe(12);
    expect(hm!.times).toHaveLength(240);
  });

  it("falls back to legacy raw path and uses mid price when no last snapshot", async () => {
    // 1: rollup cells empty, 2: legacy cells, 3: legacy colStats, 4: lastRows empty
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ col: 0, price: 100, vol: 40 }])
      .mockResolvedValueOnce([{ col: 0, n: 1, ex: 1 }])
      .mockResolvedValueOnce([]);
    const hm = await computeOrderflow("BTCUSDT", "binance", 0, 1000);
    expect(hm).not.toBeNull();
    expect(hm!.maxVal).toBe(40);
    // без lastRows цена = середина диапазона
    expect(hm!.price).toBeGreaterThan(99);
    expect(hm!.profileMax).toBe(0);
  });
});