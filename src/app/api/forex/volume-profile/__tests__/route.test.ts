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

const base = "https://example.com/api/forex/volume-profile";

describe("GET /api/forex/volume-profile", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAuthUser.mockReset();
    (forexAccessError as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    mockPrisma.fxCandle.findMany.mockReset().mockResolvedValue([]);
    asUser();
    ({ GET } = await import("@/app/api/forex/volume-profile/route"));
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1d`));
    expect(res.status).toBe(401);
  });

  it("returns the forexAccessError response when access is denied", async () => {
    (forexAccessError as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1d`));
    expect(res.status).toBe(403);
  });

  it("returns 400 for unknown period", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=3m`));
    expect(res.status).toBe(400);
  });

  it("returns empty levels when there are no candles", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1d`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.levels).toEqual([]);
    expect(body.poc).toBeNull();
    expect(body.valueArea).toBeNull();
  });

  it("returns 200 with poc/valueArea/levels on the happy path", async () => {
    mockPrisma.fxCandle.findMany.mockResolvedValue([
      { o: 1.1, h: 1.12, l: 1.09, c: 1.11 },
      { o: 1.11, h: 1.13, l: 1.1, c: 1.12 },
      { o: 1.12, h: 1.14, l: 1.11, c: 1.13 },
    ]);
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1d`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("EUR/USD");
    expect(body.period).toBe("1d");
    expect(body.poc).not.toBeNull();
    expect(body.valueArea).not.toBeNull();
    expect(body.levels.length).toBeGreaterThan(0);
  });

  it("degrades gracefully to a 200 empty response when prisma throws", async () => {
    mockPrisma.fxCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&period=1d`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.levels).toEqual([]);
  });
});
