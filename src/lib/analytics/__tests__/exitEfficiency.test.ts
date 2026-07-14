import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeExitEfficiency, pickRecentTrades } from "../exitEfficiency";
import type { SerializedTrade } from "@/lib/types";

describe("Exit Efficiency", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const makeTrade = (overrides: Partial<SerializedTrade>): SerializedTrade => ({
    id: "t1",
    accountId: "acc1",
    exchange: "binance",
    symbol: "BTC/USDT",
    market: "spot",
    base: "BTC",
    quote: "USDT",
    side: "long",
    entryTime: "2024-01-01T10:00:00Z",
    exitTime: "2024-01-01T12:00:00Z",
    entryPrice: 100,
    exitPrice: 110,
    qty: 1,
    fees: 0.5,
    netPnl: 9,
    grossPnl: 10,
    fillCount: 2,
    result: "win",
    ...overrides,
  });

  describe("pickRecentTrades", () => {
    it("returns only exchange trades, most recent first", () => {
      const trades = [
        makeTrade({ id: "t1", exchange: "binance", exitTime: "2024-01-01T10:00:00Z" }),
        makeTrade({ id: "t2", exchange: "mt4", exitTime: "2024-01-03T10:00:00Z" }), // excluded (import source)
        makeTrade({ id: "t3", exchange: "bybit", exitTime: "2024-01-02T10:00:00Z" }),
      ];
      const picked = pickRecentTrades(trades, 10);
      expect(picked.map((t) => t.id)).toEqual(["t3", "t1"]);
    });

    it("limits to maxTrades and at least 1", () => {
      const trades = [
        makeTrade({ id: "t1", exitTime: "2024-01-01T10:00:00Z" }),
        makeTrade({ id: "t2", exitTime: "2024-01-02T10:00:00Z" }),
        makeTrade({ id: "t3", exitTime: "2024-01-03T10:00:00Z" }),
      ];
      expect(pickRecentTrades(trades, 2).map((t) => t.id)).toEqual(["t3", "t2"]);
      expect(pickRecentTrades(trades, 0).map((t) => t.id)).toEqual(["t3"]);
    });
  });

  describe("computeExitEfficiency", () => {
    it("analyzes trades and computes averages", async () => {
      const trade = makeTrade({ id: "t1", entryPrice: 100, exitPrice: 110, qty: 1 });
      const candles = [
        [new Date(trade.entryTime).getTime(), 100, 115, 95, 100],
        [new Date(trade.entryTime).getTime() + 3600_000, 105, 115, 95, 105],
        [new Date(trade.exitTime).getTime(), 110, 115, 95, 110],
      ];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ candles }), { status: 200 }));

      const summary = await computeExitEfficiency([trade], { maxTrades: 5, concurrency: 2 });
      expect(summary.analyzed).toBe(1);
      expect(summary.skipped).toBe(0);
      expect(summary.avgMfePct).toBeGreaterThan(0);
      expect(summary.leftOnTableUsd).toBeGreaterThanOrEqual(0);
    });

    it("skips when fetch fails", async () => {
      const trade = makeTrade({ id: "t1" });
      vi.mocked(fetch).mockResolvedValue(new Response("err", { status: 500 }));

      const summary = await computeExitEfficiency([trade], { maxTrades: 5, concurrency: 1 });
      expect(summary.analyzed).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it("skips when candles invalid", async () => {
      const trade = makeTrade({ id: "t1" });
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ candles: [] }), { status: 200 }));

      const summary = await computeExitEfficiency([trade], { maxTrades: 5, concurrency: 1 });
      expect(summary.analyzed).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it("respects concurrency via runPool", async () => {
      const trades = Array.from({ length: 10 }, (_, i) => makeTrade({ id: `t${i}`, exitTime: `2024-01-${String(10 + i).padStart(2, "0")}T10:00:00Z` }));
      let inFlight = 0;
      let maxInFlight = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return new Response(JSON.stringify({ candles: [[0, 100, 115, 95, 110]] }), { status: 200 });
      });
      await computeExitEfficiency(trades, { maxTrades: 10, concurrency: 3 });
      expect(maxInFlight).toBeLessThanOrEqual(3);
    });
  });
});