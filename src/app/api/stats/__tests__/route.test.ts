import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/stats/route";

vi.mock("@/lib/analytics/materialize", () => ({
  ensureAccountTrades: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/statsCache", () => ({
  getCached: vi.fn().mockReturnValue(undefined),
  setCached: vi.fn(),
  statsVersion: vi.fn().mockReturnValue(1),
}));

const base = "https://example.com/api/stats";

const mockTrade = {
  id: "trade-1",
  symbol: "BTCUSDT",
  base: "BTC",
  quote: "USDT",
  market: "futures",
  exchange: "bybit",
  accountId: "acc-1",
  side: "long" as const,
  entryTime: new Date("2024-01-01T10:00:00Z"),
  exitTime: new Date("2024-01-01T12:00:00Z"),
  durationMs: 7200000,
  qty: 0.1,
  entryPrice: 50000,
  exitPrice: 51000,
  grossPnl: 100,
  fees: 5,
  netPnl: 95,
  returnPct: 2.0,
  fillCount: 2,
  result: "win" as const,
};

const mockUser = {
  userId: "user-1",
  entryPointOptions: ["breakout", "pullback"],
  entryTypeOptions: ["market", "limit"],
  mistakeOptions: ["fomo", "revenge"],
  patternOptions: ["double_top", "head_shoulders"],
};

describe("GET /api/stats", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000, tradesRebuiltAt: new Date() },
    ]);
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockPrisma.fill.count.mockResolvedValue(0);
    mockPrisma.importedTrade.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.tradeAnnotation.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 200 with metrics and options for a valid request", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    mockPrisma.fill.count.mockResolvedValue(2);
    const res = await GET(new Request(`${base}?market=all`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("metrics");
    expect(body).toHaveProperty("accounts");
    expect(body).toHaveProperty("entryPointOptions");
    expect(Array.isArray(body.trades)).toBe(true);
  });

  it("returns 500 when a prisma query fails", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockRejectedValueOnce(new Error("DB error"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });

  it("filters by market=spot", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(`${base}?market=spot`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.tradeCount).toBeGreaterThanOrEqual(0);
  });

  it("filters by market=futures", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(`${base}?market=futures`));
    expect(res.status).toBe(200);
  });

  it("filters by market=forex (imported trades)", async () => {
    asUser();
    mockPrisma.importedTrade.findMany.mockResolvedValue([{
      accountId: "acc-1",
      externalId: "ext-1",
      symbol: "EURUSD",
      base: "EUR",
      quote: "USD",
      market: "forex",
      source: "mt4",
      side: "long" as const,
      entryTime: new Date("2024-01-01T10:00:00Z"),
      exitTime: new Date("2024-01-01T12:00:00Z"),
      qty: 1.0,
      entryPrice: 1.05,
      exitPrice: 1.06,
      grossProfit: 100,
      swap: 0,
      commission: 5,
      netPnl: 95,
      currency: "USD",
      lots: 1.0,
      pips: 100,
      stopLoss: 1.04,
    }]);
    const res = await GET(new Request(`${base}?market=forex`));
    expect(res.status).toBe(200);
  });

  it("filters by accountId", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000, tradesRebuiltAt: new Date() },
      { id: "acc-2", label: "Second", exchange: "binance", balance: 5000, tradesRebuiltAt: new Date() },
    ]);
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(`${base}?accountId=acc-1`));
    expect(res.status).toBe(200);
  });

  it("filters by symbol", async () => {
    asUser();
    const tradeWithSymbol = { ...mockTrade, symbol: "ETHUSDT" };
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithSymbol]);
    const res = await GET(new Request(`${base}?symbol=ETHUSDT`));
    expect(res.status).toBe(200);
  });

  it("filters by date range (from)", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(`${base}?from=2024-01-01T00:00:00Z`));
    expect(res.status).toBe(200);
  });

  it("filters by date range (to)", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(`${base}?to=2024-12-31T23:59:59Z`));
    expect(res.status).toBe(200);
  });

  it("filters by entryPoint", async () => {
    asUser();
    const tradeWithEntry = { ...mockTrade, entryPoint: "breakout" };
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithEntry]);
    mockPrisma.tradeAnnotation.findMany.mockResolvedValue([
      { userId: "user-1", tradeKey: "trade-1", entryPoint: "breakout" }
    ]);
    const res = await GET(new Request(`${base}?entryPoint=breakout`));
    expect(res.status).toBe(200);
  });

  it("filters by entryType", async () => {
    asUser();
    const tradeWithEntry = { ...mockTrade, entryType: "market" };
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithEntry]);
    mockPrisma.tradeAnnotation.findMany.mockResolvedValue([
      { userId: "user-1", tradeKey: "trade-1", entryType: "market" }
    ]);
    const res = await GET(new Request(`${base}?entryType=market`));
    expect(res.status).toBe(200);
  });

  it("filters by mistake", async () => {
    asUser();
    const tradeWithMistake = { ...mockTrade, mistake: "fomo" };
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithMistake]);
    mockPrisma.tradeAnnotation.findMany.mockResolvedValue([
      { userId: "user-1", tradeKey: "trade-1", mistake: "fomo" }
    ]);
    const res = await GET(new Request(`${base}?mistake=fomo`));
    expect(res.status).toBe(200);
  });

  it("filters by pattern", async () => {
    asUser();
    const tradeWithPattern = { ...mockTrade, pattern: "double_top" };
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithPattern]);
    mockPrisma.tradeAnnotation.findMany.mockResolvedValue([
      { userId: "user-1", tradeKey: "trade-1", pattern: "double_top" }
    ]);
    const res = await GET(new Request(`${base}?pattern=double_top`));
    expect(res.status).toBe(200);
  });

  it("handles initialCapital parameter", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(`${base}?initialCapital=50000`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
  });

  it("returns empty trades array when no trades match filters", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockPrisma.fill.count.mockResolvedValue(0);
    mockPrisma.importedTrade.findMany.mockResolvedValue([]);
    const res = await GET(new Request(`${base}?symbol=NONEXISTENT`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.trades)).toBe(true);
    expect(body.trades.length).toBe(0);
  });

  it("handles user with no custom options (uses defaults)", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue({
      entryPointOptions: null,
      entryTypeOptions: null,
      mistakeOptions: null,
      patternOptions: null,
    });
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryPointOptions).toBeDefined();
    expect(body.entryTypeOptions).toBeDefined();
  });

  it("handles non-existent account gracefully", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit", balance: 10000, tradesRebuiltAt: new Date() },
    ]);
    mockPrisma.trade.findMany.mockResolvedValue([]);
    const res = await GET(new Request(`${base}?accountId=non-existent`));
    expect(res.status).toBe(200);
  });

  it("includes fill count in response", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    mockPrisma.fill.count.mockResolvedValue(5);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fillCount).toBe(5);
  });

  it("includes all option arrays in response", async () => {
    asUser();
    mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.entryPointOptions)).toBe(true);
    expect(Array.isArray(body.entryTypeOptions)).toBe(true);
    expect(Array.isArray(body.mistakeOptions)).toBe(true);
    expect(Array.isArray(body.patternOptions)).toBe(true);
  });
});