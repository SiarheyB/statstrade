import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies upfront
const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  exchangeAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
  riskProfile: { findFirst: vi.fn() },
  trade: { findMany: vi.fn() },
}));

const mockCache = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const mockParseRiskProfile = vi.hoisted(() => (
  { enabled: true,
    maxStopsPerDay: 5,
    riskPerTrade: { value: 1000, unit: "amount" },
    lossLimits: { day: { on: true, value: 10, unit: "pct" } }
  }));
const mockRiskPerTradeAmount = vi.hoisted(() => 1000);

// Configure mocks
vi.mock("@/lib/db", () => mockPrisma);
vi.mock("@/lib/cache", () => ({ Cache: mockCache }));
vi.mock("@/lib/risk", () => ({
  parseRiskProfile: mockParseRiskProfile,
  riskPerTradeAmount: mockRiskPerTradeAmount,
}));

import { calculateNetStopsFromTrades, getNetStopsCount, checkRiskLimits } from "@/lib/riskManager";

// --- Tests for calculateNetStopsFromTrades ---
describe("calculateNetStopsFromTrades", () => {
  it("returns 0 for empty trades", () => {
    expect(calculateNetStopsFromTrades([], 1000)).toBe(0);
  });

  it("returns 0 when netR >= 0", () => {
    const trades = [
      { netPnl: -1000, result: "loss" },
      { netPnl: 1500, result: "win" }, // netR = 0.5R -> non-negative
    ];
    expect(calculateNetStopsFromTrades(trades, 1000)).toBe(0);
  });

  it("returns positive count for net negative R", () => {
    const trades = [
      { netPnl: -3000, result: "loss" }, // -3R
      { netPnl: -2000, result: "loss" }, // -2R
    ];
    expect(calculateNetStopsFromTrades(trades, 1000)).toBe(5);
  });

  // Дополнительные тесты для проверки отклонений
  it("cancels stops with mixed wins/losses", () => {
    const trades = [
      { netPnl: -2000, result: "loss" }, // -2R
      { netPnl: 2500, result: "win" },   // +2.5R
    ];
    expect(calculateNetStopsFromTrades(trades, 1000)).toBe(0);
  });

  it("handles threshold at exact R multiple", () => {
    const trades = [
      { netPnl: -2500, result: "loss" }, // -2.5R
    ];
    expect(calculateNetStopsFromTrades(trades, 1000)).toBe(3); // ceil(2.5 - epsilon) = 3
  });

  it("handles single large loss correctly", () => {
    const trades = [
      { netPnl: -10000, result: "loss" }, // -10R
    ];
    expect(calculateNetStopsFromTrades(trades, 1000)).toBe(10);
  });

  it("handles fractional R per trade", () => {
    const trades = [
      { netPnl: -1500, result: "loss" }, // -1.5R
      { netPnl: -800, result: "loss" },  // -0.8R
    ];
    expect(calculateNetStopsFromTrades(trades, 1000)).toBe(3); // ceil(1.5 + 0.8 - epsilon) = 3
  });
});

// --- Tests for getNetStopsCount ---
describe("getNetStopsCount", () => {
  it("returns cached value without DB access", async () => {
    mockCache.get.mockReturnValue(7);
    const result = await getNetStopsCount("u", "e", "day");
    expect(result).toBe(7);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});
