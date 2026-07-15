import { describe, it, expect } from "vitest";
import { toImportedTrade } from "@/lib/mt/to-imported";

describe("toImportedTrade", () => {
  const account = { id: "acc1", accountCurrency: "USD" };
  const base = {
    externalId: "x1",
    symbol: "EURUSD",
    side: "long" as const,
    lots: 0.1,
    entryPrice: 1.1,
    exitPrice: 1.105,
    stopLoss: null,
    takeProfit: null,
    commission: -2.0,
    swap: 0.1,
    grossProfit: 50.0,
    comment: null,
    entryTime: new Date("2024-05-13T14:30:00Z"),
    exitTime: new Date("2024-05-13T15:00:00Z"),
  };

  it("maps a forex long with derived pips, qty and net pnl", () => {
    const r = toImportedTrade(base, account, "mt5", "batch9");
    expect(r.externalId).toBe("x1");
    expect(r.symbol).toBe("EURUSD");
    expect(r.base).toBe("EUR");
    expect(r.quote).toBe("USD");
    expect(r.market).toBe("forex");
    expect(r.contractSize).toBe(100_000);
    expect(r.qty).toBeCloseTo(0.1 * 100_000);
    expect(r.pips).toBeCloseTo(50); // (1.105 - 1.1) / 0.0001
    expect(r.commission).toBe(2.0); // abs(-2)
    expect(r.netPnl).toBeCloseTo(50.0 + 0.1 - 2.0);
    expect(r.currency).toBe("USD");
    expect(r.importBatch).toBe("batch9");
  });

  it("handles a short CFD side and non-pip assets", () => {
    const r = toImportedTrade({ ...base, side: "short", symbol: "BTCUSDT" }, account, "mt5", "b");
    expect(r.side).toBe("short");
    expect(r.market).toBe("cfd");
    expect(r.base).toBe("BTCUSDT");
    expect(r.quote).toBe("USD");
    expect(typeof r.pips).toBe("number");
  });

  it("carries through a non-null comment", () => {
    const r = toImportedTrade({ ...base, comment: "manual" }, account, "mt5", "b");
    expect(r.comment).toBe("manual");
  });
});
