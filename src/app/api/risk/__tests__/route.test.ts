import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/risk/route";

vi.mock("@/lib/analytics/materialize", () => ({
  ensureAccountTrades: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/risk", () => ({
  parseRiskProfile: vi.fn().mockImplementation((row) => {
    if (!row) {
      return {
        enabled: false,
        maxStopsPerDay: null,
        riskPerTrade: { on: false, value: 0, unit: "pct" as const },
        lossLimits: {
          day: { on: false, value: 0, unit: "pct" as const },
          week: { on: false, value: 0, unit: "pct" as const },
          month: { on: false, value: 0, unit: "pct" as const },
          year: { on: false, value: 0, unit: "pct" as const },
        },
      };
    }

    return {
      enabled: !!row.enabled,
      maxStopsPerDay: row.maxStopsPerDay ?? null,
      riskPerTrade: row.riskPerTrade ? JSON.parse(row.riskPerTrade) : { on: false, value: 0, unit: "pct" as const },
      lossLimits: row.lossLimits ? JSON.parse(row.lossLimits) : {
        day: { on: false, value: 0, unit: "pct" as const },
        week: { on: false, value: 0, unit: "pct" as const },
        month: { on: false, value: 0, unit: "pct" as const },
        year: { on: false, value: 0, unit: "pct" as const },
      },
    };
  }),
  computeAccountRisk: vi.fn().mockImplementation(
    (accountId: string, trades: any[], balance: number | null, profile: any) => ({
      accountId,
      enabled: !!profile?.enabled,
      balance,
      state: profile?.enabled ? "ok" : "off",
      limits: profile?.enabled ? [{ key: "stops", unit: "count", used: 0, limit: 5, pct: 0, state: "ok" }] : [],
    })
  ),
}));

const base = "https://example.com/api/risk";

describe("GET /api/risk", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([]);
    mockPrisma.tradeHourly.findMany.mockResolvedValue([]);
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
    mockPrisma.tradeHourly.findMany.mockResolvedValue([
      { accountId: "acc-1", hour: new Date("2024-01-01T10:00:00Z"), netPnl: -120, wins: 0, losses: 1, winR: 0, lossR: -1, trades: 1 },
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

  it("reads hourly aggregates (not fills, not raw trades) from the start of the year", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000, tradesRebuiltAt: new Date() },
    ]);

    const res = await GET(new Request(base));
    expect(res.status).toBe(200);

    // Ни реконструкции из филлов, ни построчного чтения сделок — только
    // почасовые агрегаты.
    expect(mockPrisma.fill.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.trade.findMany).not.toHaveBeenCalled();
    const args = mockPrisma.tradeHourly.findMany.mock.calls[0][0];
    expect(args.where.accountId).toEqual({ in: ["acc-1"] });
    const from = args.where.hour.gte as Date;
    expect(from.getTime()).toBe(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  });

  it("shifts the window with the caller timezone offset", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000, tradesRebuiltAt: new Date() },
    ]);

    await GET(new Request(`${base}?tzOffset=180`));
    const from = mockPrisma.tradeHourly.findMany.mock.calls[0][0].where.hour.gte as Date;
    const now = new Date();
    const local = new Date(now.getTime() + 3 * 3600_000);
    expect(from.getTime()).toBe(Date.UTC(local.getUTCFullYear(), 0, 1) - 3 * 3600_000);
  });

  it("ignores an out-of-range tzOffset", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000, tradesRebuiltAt: new Date() },
    ]);

    await GET(new Request(`${base}?tzOffset=99999`));
    const from = mockPrisma.tradeHourly.findMany.mock.calls[0][0].where.hour.gte as Date;
    expect(from.getTime()).toBe(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  });

  it("skips the aggregate query entirely when the user has no exchange accounts", async () => {
    asUser();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    expect(mockPrisma.tradeHourly.findMany).not.toHaveBeenCalled();
  });

  it("returns 500 when prisma query fails", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockRejectedValueOnce(new Error("DB error"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });
});