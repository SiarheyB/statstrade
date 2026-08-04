import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { forexAccessError } from "@/lib/forexAccess";

vi.mock("@/lib/forexAccess", () => ({
  forexAccessError: vi.fn().mockResolvedValue(null),
}));

const base = "https://example.com/api/forex/imbalance";

function makeCandles(n: number) {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      t: new Date(now - (n - i) * 3600_000),
      o: 1.1,
      h: 1.12,
      l: 1.09,
      c: i % 2 === 0 ? 1.11 : 1.09,
    });
  }
  return rows.reverse(); // desc order as queried
}

describe("GET /api/forex/imbalance", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAuthUser.mockReset();
    (forexAccessError as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    mockPrisma.fxCandle.findMany.mockReset().mockResolvedValue([]);
    asUser();
    ({ GET } = await import("@/app/api/forex/imbalance/route"));
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1h`));
    expect(res.status).toBe(401);
  });

  it("returns the forexAccessError response when access is denied", async () => {
    (forexAccessError as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1h`));
    expect(res.status).toBe(403);
  });

  it("returns 400 for unknown period", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=3m`));
    expect(res.status).toBe(400);
  });

  it("returns neutral signal with empty series when fewer than 10 candles", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue(makeCandles(5));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBeNull();
    expect(body.series).toEqual([]);
    expect(body.signal).toBe("neutral");
  });

  it("returns 200 with current/series/signal on the happy path", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue(makeCandles(20));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("EUR/USD");
    expect(body.period).toBe("1h");
    expect(body.current).not.toBeNull();
    expect(Array.isArray(body.series)).toBe(true);
    expect(["bullish", "bearish", "neutral"]).toContain(body.signal);
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.fxCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1h`));
    expect(res.status).toBe(500);
  });
});
