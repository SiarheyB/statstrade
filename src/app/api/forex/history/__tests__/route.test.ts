import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { forexAccessError } from "@/lib/forexAccess";
import { GET } from "@/app/api/forex/history/route";

vi.mock("@/lib/forexAccess", () => ({
  forexAccessError: vi.fn().mockResolvedValue(null),
}));

const base = "https://example.com/api/forex/history";

describe("GET /api/forex/history", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    (forexAccessError as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    mockPrisma.fxCandle.findMany.mockReset().mockResolvedValue([]);
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h&before=${Date.now()}`));
    expect(res.status).toBe(401);
  });

  it("returns the forexAccessError response when access is denied", async () => {
    (forexAccessError as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h&before=${Date.now()}`));
    expect(res.status).toBe(403);
  });

  it("returns 400 for unknown timeframe", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=3m&before=${Date.now()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when before is missing/invalid", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when before is <= 0", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h&before=0`));
    expect(res.status).toBe(400);
  });

  it("returns 200 with candles and hasMore on the happy path", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      t: new Date(now - i * 3600_000),
      o: 1.1,
      h: 1.12,
      l: 1.09,
      c: 1.11,
      v: 0,
    }));
    mockPrisma.fxCandle.findMany.mockResolvedValue(rows);
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h&before=${now}&limit=500`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.candles)).toBe(true);
    expect(body.candles.length).toBe(500);
    expect(body.hasMore).toBe(true);
  });

  it("aggregates 12h candles from the 1h source interval", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue([]);
    await GET(new Request(`${base}?symbol=EUR/USD&range=12h&before=${Date.now()}`));
    expect(mockPrisma.fxCandle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ interval: "1h" }) }),
    );
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.fxCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h&before=${Date.now()}`));
    expect(res.status).toBe(500);
  });
});
