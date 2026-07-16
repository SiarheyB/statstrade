import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/trade-fills/route";

const base = "https://example.com/api/trade-fills";

const mockFill = {
  id: "f-1",
  accountId: "acc-1",
  symbol: "BTCUSDT",
  market: "spot" as const,
  side: "sell" as const,
  price: 50000,
  amount: 0.1,
  cost: 5000,
  realizedPnl: 100,
  timestamp: new Date("2024-01-01T12:00:00Z"),
};

describe("GET /api/trade-fills", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.fill.findMany.mockReset().mockResolvedValue([mockFill as any]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&from=2024-01-01&to=2024-01-02`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required params are missing", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT`));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid date range", async () => {
    asUser();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&from=not-a-date&to=2024-01-02`));
    expect(res.status).toBe(400);
  });

  it("returns exit fills for a long trade", async () => {
    asUser();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z&side=long`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.fills)).toBe(true);
    expect(body.fills.length).toBe(1);
    // long → exit side "sell"
    expect(mockPrisma.fill.findMany.mock.calls[0][0].where.side).toBe("sell");
    expect(body.fills[0].realizedPnl).toBe(100);
  });

  it("returns exit fills for a short trade", async () => {
    asUser();
    const res = await GET(new Request(`${base}?accountId=acc-1&symbol=BTCUSDT&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z&side=short`));
    expect(res.status).toBe(200);
    // short → exit side "buy"
    expect(mockPrisma.fill.findMany.mock.calls[0][0].where.side).toBe("buy");
  });
});
