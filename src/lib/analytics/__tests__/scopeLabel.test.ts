import { describe, it, expect, vi } from "vitest";
import { scopeLabel } from "../scopeLabel";
import type { AccountSummary, SerializedTrade } from "@/lib/types";

describe("scopeLabel", () => {
  const mockAccounts: AccountSummary[] = [
    { id: "acc1", label: "Main Account", exchange: "binance" },
    { id: "acc2", label: "Test Account", exchange: "bybit" },
  ];

  it("returns empty string when no trades", () => {
    expect(scopeLabel([], mockAccounts)).toBe("");
  });

  it("returns exchange label when account not found", () => {
    const trades = [
      { accountId: "unknown", exchange: "kraken" },
    ] as Pick<SerializedTrade, "accountId" | "exchange">[];

    expect(scopeLabel(trades, mockAccounts)).toBe("kraken");
  });

  it("returns account label (exchange) when account found", () => {
    const trades = [
      { accountId: "acc1", exchange: "binance" },
    ] as Pick<SerializedTrade, "accountId" | "exchange">[];

    expect(scopeLabel(trades, mockAccounts)).toBe("Main Account (binance)");
  });

  it("deduplicates identical labels", () => {
    const trades = [
      { accountId: "acc1", exchange: "binance" },
      { accountId: "acc1", exchange: "binance" },
    ] as Pick<SerializedTrade, "accountId" | "exchange">[];

    expect(scopeLabel(trades, mockAccounts)).toBe("Main Account (binance)");
  });

  it("joins multiple different labels with comma", () => {
    const trades = [
      { accountId: "acc1", exchange: "binance" },
      { accountId: "acc2", exchange: "bybit" },
    ] as Pick<SerializedTrade, "accountId" | "exchange">[];

    const result = scopeLabel(trades, mockAccounts);
    expect(result).toContain("Main Account (binance)");
    expect(result).toContain("Test Account (bybit)");
    expect(result.split(", ").length).toBe(2);
  });

  it("handles mixed known/unknown accounts", () => {
    const trades = [
      { accountId: "acc1", exchange: "binance" }, // known
      { accountId: "unknown", exchange: "kraken" }, // unknown
    ] as Pick<SerializedTrade, "accountId" | "exchange">[];

    const result = scopeLabel(trades, mockAccounts);
    expect(result).toContain("Main Account (binance)");
    expect(result).toContain("kraken");
  });
});