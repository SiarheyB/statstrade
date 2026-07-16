import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/risk/route";

vi.mock("@/lib/analytics/positions", () => ({
  reconstructTrades: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/risk", () => ({
  parseRiskProfile: vi.fn().mockImplementation((row) => ({
    enabled: false,
    maxStopsPerDay: null,
    riskPerTrade: { on: false, value: 0, unit: "pct" as const },
    lossLimits: {
      day: { on: false, value: 0, unit: "pct" as const },
      week: { on: false, value: 0, unit: "pct" as const },
      month: { on: false, value: 0, unit: "pct" as const },
      year: { on: false, value: 0, unit: "pct" as const },
    },
  })),
  computeAccountRisk: vi.fn().mockImplementation(
    (accountId: string, trades: any[], balance: number | null, profile: any) => ({
      accountId,
      enabled: false,
      balance,
      state: "off" as const,
      limits: [],
    })
  ),
}));

const base = "https://example.com/api/risk";

describe("GET /api/risk", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([]);
    mockPrisma.fill.findMany.mockResolvedValue([]);
    mockPrisma.riskProfile.findMany.mockResolvedValue([]);
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty accounts when user has no exchange accounts", async () => {
    asUser();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("accounts");
    expect(Array.isArray(body.accounts)).toBe(true);
    expect(body.accounts.length).toBe(0);
    expect(body).toHaveProperty("defaultEnabled");
    expect(body.defaultEnabled).toBe(false);
  });

  it("returns risk data for exchange accounts", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000 },
      { id: "acc-2", label: "Second", exchange: "binance", balance: 5000 },
    ]);
    mockPrisma.fill.findMany.mockResolvedValue([
      {
        id: "fill-1",
        symbol: "BTCUSDT",
        base: "BTC",
        quote: "USDT",
        market: "futures",
        side: "buy",
        price: 50000,
        amount: 0.1,
        fee: 5,
        feeCurrency: "USDT",
        timestamp: new Date("2024-01-01T10:00:00Z"),
        exchange: "bybit",
        accountId: "acc-1",
      },
    ]);
    mockPrisma.riskProfile.findMany.mockResolvedValue([
      { accountId: "", enabled: true, maxStopsPerDay: 3 },
    ]);

    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts.length).toBe(2);
    expect(body.defaultEnabled).toBe(true);
  });

  it("includes per-account risk limits when profile overrides exist", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000 },
    ]);
    mockPrisma.riskProfile.findMany.mockResolvedValue([
      { accountId: "", enabled: false },
      {
        accountId: "acc-1",
        enabled: true,
        maxStopsPerDay: 5,
        riskPerTrade: JSON.stringify({ on: true, value: 2, unit: "pct" }),
        lossLimits: JSON.stringify({ day: { on: true, value: 10, unit: "pct" } }),
      },
    ]);

    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts[0].custom).toBe(true);
    expect(body.accounts[0].enabled).toBe(true);
  });

  it("returns 500 when prisma query fails", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockRejectedValueOnce(new Error("DB error"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });
});