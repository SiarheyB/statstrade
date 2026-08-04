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

const base = "https://example.com/api/forex/divergence";

function makeCandles(n: number) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const wobble = i % 7;
    rows.push({
      t: new Date(now - (n - i) * 3600_000),
      o: 1.1 + wobble * 0.001,
      h: 1.1 + wobble * 0.002 + (i % 11 === 0 ? 0.01 : 0),
      l: 1.1 - wobble * 0.002 - (i % 13 === 0 ? 0.01 : 0),
      c: 1.1 + wobble * 0.0015,
    });
  }
  return rows.reverse(); // route queries orderBy desc
}

describe("GET /api/forex/divergence", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAuthUser.mockReset();
    (forexAccessError as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    mockPrisma.fxCandle.findMany.mockReset().mockResolvedValue([]);
    asUser();
    ({ GET } = await import("@/app/api/forex/divergence/route"));
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=4h`));
    expect(res.status).toBe(401);
  });

  it("returns the forexAccessError response when access is denied", async () => {
    (forexAccessError as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=4h`));
    expect(res.status).toBe(403);
  });

  it("returns 400 for unknown period", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=3m`));
    expect(res.status).toBe(400);
  });

  it("returns empty signals when there are fewer than 30 candles", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue(makeCandles(10));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=4h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals).toEqual([]);
  });

  it("returns 200 with a signals array on the happy path", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue(makeCandles(60));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=4h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("EUR/USD");
    expect(body.period).toBe("4h");
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it("aggregates 12h from 1h source candles", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue(makeCandles(60));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=12h`));
    expect(res.status).toBe(200);
    expect(mockPrisma.fxCandle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ interval: "1h" }) }),
    );
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.fxCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=4h`));
    expect(res.status).toBe(500);
  });
});
