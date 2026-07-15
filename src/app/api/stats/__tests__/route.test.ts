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

describe("GET /api/stats", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([]);
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockPrisma.fill.count.mockResolvedValue(0);
    mockPrisma.importedTrade.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tradeAnnotation.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 200 with metrics and options for a valid request", async () => {
    asUser();
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
});
