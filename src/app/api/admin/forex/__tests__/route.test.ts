import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { asAdmin, asNonAdmin, mockGetAdminSession, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/admin/forex/route";


describe("GET /api/admin/forex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReset();
    asAdmin();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.fxCollectorConfig.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FX_COLLECTOR_URL;
    delete process.env.FX_SYMBOLS;
  });

  it("returns 404 when not an admin", async () => {
    asNonAdmin();
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 200 with graceful fallback when FX_COLLECTOR_URL unset", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health.ok).toBe(false);
    expect(body.symbols).toEqual([]);
    expect(body.config).toEqual([]);
  });

  it("returns 200 and aggregates candles/config/health on happy path", async () => {
    process.env.FX_COLLECTOR_URL = "http://fx-collector";
    process.env.FX_SYMBOLS = "EUR/USD, GBP/USD";
    const now = new Date("2026-01-01T00:00:00Z");
    mockPrisma.$queryRaw.mockResolvedValue([
      { symbol: "EUR/USD", interval: "1h", count: 10, last_t: now, oldest_t: now },
    ]);
    mockPrisma.fxCollectorConfig.findMany.mockResolvedValue([
      { symbol: "EUR/USD", enabled: true, updatedAt: now },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      }),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health.ok).toBe(true);
    expect(body.symbols).toEqual(["EUR/USD"]);
    expect(body.bySymbol["EUR/USD"]["1h"].count).toBe(10);
    expect(body.config).toEqual([{ symbol: "EUR/USD", enabled: true, updatedAt: now.toISOString() }]);
    expect(body.envSymbols).toEqual(["EUR/USD", "GBP/USD"]);
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
