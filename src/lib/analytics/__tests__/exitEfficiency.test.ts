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
});
