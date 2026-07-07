"use strict";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getNetStopsCount } from "./riskManager";
import { prisma } from "./db";
import { Cache } from "./cache";
import { calculateNetStopsFromTrades, parseRiskProfile } from "./risk";

vi.mock("./db");
vi.mock("./cache");
vi.mock("./exchanges");
vi.mock("./risk");

const mockPrisma = vi.mocked(prisma, { virtual: true });
const mockCache = vi.mocked(Cache, { virtual: true });

let userId = "test-user";
let exchangeId = "test-exchange";
let profile = {
  enabled: true,
  maxStopsPerDay: 3,
  riskPerTrade: { on: true, value: 2, unit: "pct" },
  lossLimits: {
    day: { on: true, value: 5, unit: "pct" },
    week: { on: false, value: 0, unit: "pct" },
    month: { on: false, value: 0, unit: "pct" },
    year: { on: false, value: 0, unit: "pct" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  userId = "test-user";
  exchangeId = "test-exchange";
  profile = {
    enabled: true,
    maxStopsPerDay: 3,
    riskPerTrade: { on: true, value: 2, unit: "pct" },
    lossLimits: {
      day: { on: true, value: 5, unit: "pct" },
      week: { on: false, value: 0, unit: "pct" },
      month: { on: false, value: 0, unit: "pct" },
      year: { on: false, value: 0, unit: "pct" },
    },
  };

  vi.mocked(prisma.user.findUnique).mockResolvedValue({ riskProfile: JSON.stringify(profile) });
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ riskLimits: {} });
  vi.mocked(prisma.trade.findMany).mockResolvedValue([]);
  vi.mocked(prisma.exchangeAccount.findUnique).mockResolvedValue({ balance: 10000, capital: null });
  vi.mocked(Cache.get).mockReturnValue(undefined);
});

describe("calculateNetStopsFromTrades", () => {
  it("returns 0 when there are 2 losses (-1R each) followed by a 3R profit", () => {
    const rAmount = 1000; // 1R = $1000
    const trades = [
      { netPnl: -1000, result: "loss" as const },   // -1R
      { netPnl: -1000, result: "loss" as const },   // -1R
      { netPnl: 3000, result: "win" as const },     // +3R
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("returns 3 when there are 3 losses (-1R each) with no wins", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: -1000, result: "loss" as const },
      { netPnl: -1000, result: "loss" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(3);
  });

  it("returns 2 when there are 2 losses (-1R each) with no wins", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: -1000, result: "loss" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(2);
  });

  it("returns 0 when there are only 3 wins (+R each)", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: 1000, result: "win" as const },
      { netPnl: 1000, result: "win" as const },
      { netPnl: 1000, result: "win" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("returns 0 when there are no trades", () => {
    const rAmount = 1000;
    const result = calculateNetStopsFromTrades([], rAmount);
    expect(result).toBe(0);
  });

  it("returns 0 when RAmount <= 0", () => {
    const rAmount = 0;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: 1000, result: "win" as const },
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("calculates for mixed scenario: -1R, +2R, -2R, +1R", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },   // -1R
      { netPnl: 2000, result: "win" as const },    // +2R
      { netPnl: -2000, result: "loss" as const },  // -2R
      { netPnl: 1000, result: "win" as const },    // +1R
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });

  it("handles small floating point differences (epsilon check)", () => {
    const rAmount = 1000;
    const trades = [
      { netPnl: -1000, result: "loss" as const },
      { netPnl: 3000 - 0.0000001, result: "win" as const }, // very slight rounding error
    ];
    const result = calculateNetStopsFromTrades(trades, rAmount);
    expect(result).toBe(0);
  });
});

describe("getNetStopsCount integration", () => {
  it("returns correct net stops based on mocked database", async () => {
    const rAmount = 1000;
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ riskProfile: JSON.stringify(profile) });
    vi.mocked(prisma.exchangeAccount.findUnique).mockResolvedValue({ balance: 10000, capital: null });
    vi.mocked(prisma.trade.findMany).mockResolvedValue([
      { netPnl: -1000, result: "loss" },
      { netPnl: -1000, result: "loss" },
      { netPnl: 3000, result: "win" },
    ]);

    const result = await getNetStopsCount(userId, exchangeId, "day");
    expect(result).toBe(0);
  });

  it("returns 0 when RAmount is not configured", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ riskProfile: JSON.stringify({}) }); // default profile

    const result = await getNetStopsCount(userId, exchangeId, "day");
    expect(result).toBe(0);
  });

  it("caches results properly", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ riskProfile: JSON.stringify(profile) });
    vi.mocked(prisma.exchangeAccount.findUnique).mockResolvedValue({ balance: 10000, capital: null });
    vi.mocked(prisma.trade.findMany).mockResolvedValue([]);
    vi.mocked(Cache.get).mockReturnValue(undefined);

    const result1 = await getNetStopsCount(userId, exchangeId, "day");
    expect(result1).toBe(0);
    expect(Cache.set).toHaveBeenCalledWith(expect.stringContaining("netStops:"), 0, expect.any(Number));

    const result2 = await getNetStopsCount(userId, exchangeId, "day");
    expect(result2).toBe(0);
    expect(Cache.get).toHaveBeenCalledWith(expect.stringContaining("netStops:"));
  });

  it("reads from cache when present", async () => {
    vi.mocked(Cache.get).mockReturnValue(5); // cached result

    const result = await getNetStopsCount(userId, exchangeId, "day");
    expect(result).toBe(5);
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
  });

  it("returns number of stops according to configured profile", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ riskProfile: JSON.stringify(profile) });
    vi.mocked(prisma.exchangeAccount.findUnique).mockResolvedValue({ balance: 10000, capital: null });
    vi.mocked(prisma.trade.findMany).mockResolvedValue([
      { netPnl: -1000, result: "loss" },
      { netPnl: -1000, result: "loss" },
    ]);

    const result = await getNetStopsCount(userId, exchangeId, "day");
    expect(result).toBe(2);
  });
});