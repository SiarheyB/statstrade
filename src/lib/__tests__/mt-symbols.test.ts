import { describe, it, expect } from "vitest";
import { normalizeSymbol } from "@/lib/mt/symbols";

describe("normalizeSymbol", () => {
  it("normalizes a forex pair (two known currencies)", () => {
    const r = normalizeSymbol("eurusd");
    expect(r).toMatchObject({ symbol: "EURUSD", base: "EUR", quote: "USD", market: "forex", contractSize: 100_000 });
  });

  it("uses a JPY pip size of 0.01", () => {
    expect(normalizeSymbol("usdjpy").pipSize).toBe(0.01);
  });

  it("strips broker suffixes", () => {
    const r = normalizeSymbol("EURUSD.m");
    expect(r.symbol).toBe("EURUSD");
  });

  it("normalizes metals", () => {
    const gold = normalizeSymbol("XAUUSD");
    expect(gold).toMatchObject({ market: "metal", base: "XAU", quote: "USD", contractSize: 100, pipSize: 0.01 });
    expect(normalizeSymbol("XAGUSD").contractSize).toBe(5000);
  });

  it("falls back to a CFD with account-currency quote", () => {
    const r = normalizeSymbol("US30", "EUR");
    expect(r.market).toBe("cfd");
    expect(r.quote).toBe("EUR");
    expect(r.contractSize).toBe(1);
  });
});
