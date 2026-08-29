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

const base = "https://example.com/api/forex";

describe("GET /api/forex", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAuthUser.mockReset();
    (forexAccessError as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    mockPrisma.fxCandle.findMany.mockReset().mockResolvedValue([]);
    asUser();
    ({ GET } = await import("@/app/api/forex/route"));
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    expect(res.status).toBe(401);
  });

  it("returns the forexAccessError response when access is denied", async () => {
    const denyResp = new Response(JSON.stringify({ error: "denied" }), { status: 403 });
    (forexAccessError as ReturnType<typeof vi.fn>).mockResolvedValue(denyResp);
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    expect(res.status).toBe(403);
  });

  it("returns 400 for unknown timeframe", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=3m`));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid timezone", async () => {
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h&tz=Not/AZone`));
    expect(res.status).toBe(400);
  });

  it("returns 200 with candles/ba/delta/cvd on the happy path", async () => {
    const now = Date.now();
    mockPrisma.fxCandle.findMany.mockResolvedValue([
      { t: new Date(now - 3600_000), o: 1.1, h: 1.2, l: 1.05, c: 1.15, v: 0 },
      { t: new Date(now), o: 1.15, h: 1.25, l: 1.1, c: 1.2, v: 0 },
    ]);
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("EUR/USD");
    expect(body.range).toBe("1h");
    expect(Array.isArray(body.candles)).toBe(true);
    expect(Array.isArray(body.ba)).toBe(true);
    expect(body.delta).not.toBeNull();
    expect(body.cvd).not.toBeNull();
  });

  it("свечи, B/A и дельта считаются из ОДНОЙ выборки, а не из трёх одинаковых", async () => {
    // Раньше fetchCandles, computeBA и computeDelta делали побайтово
    // одинаковый findMany — одни и те же строки ехали из базы трижды на
    // каждый опрос, а страница опрашивает эндпоинт раз в 3 секунды.
    await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    expect(mockPrisma.fxCandle.findMany).toHaveBeenCalledTimes(1);
  });

  it("выборка сужена одним интервалом — иначе в ряд попадут все таймфреймы сразу", async () => {
    // Без фильтра по interval выборка захватывала 5m+15m+1h+4h+1d+1w: ряд с
    // дублирующимися таймстемпами и «пила» на панели B/A.
    await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    const intervals = mockPrisma.fxCandle.findMany.mock.calls.map(
      (c) => (c[0] as { where: { interval?: string } }).where.interval,
    );
    expect(intervals.every((i) => i === "1h")).toBe(true);
  });

  it("uses the aggregation source interval for 12h (not supported upstream)", async () => {
    await GET(new Request(`${base}?symbol=EUR/USD&range=12h`));
    const intervals = mockPrisma.fxCandle.findMany.mock.calls.map(
      (c) => (c[0] as { where: { interval?: string } }).where.interval,
    );
    expect(intervals.every((i) => i === "1h")).toBe(true);
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.fxCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=EUR/USD&range=1h`));
    expect(res.status).toBe(500);
  });
});
