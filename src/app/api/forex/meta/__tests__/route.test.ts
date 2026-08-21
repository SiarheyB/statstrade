import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { forexAccessError } from "@/lib/forexAccess";

vi.mock("@/lib/forexAccess", () => ({
  forexAccessError: vi.fn().mockResolvedValue(null),
}));

const base = "https://example.com/api/forex/meta";

describe("GET /api/forex/meta", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAuthUser.mockReset();
    (forexAccessError as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    delete process.env.FX_SYMBOLS;
    asUser();
    ({ GET } = await import("@/app/api/forex/meta/route"));
  });

  afterEach(() => {
    delete process.env.FX_SYMBOLS;
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns the forexAccessError response when access is denied", async () => {
    (forexAccessError as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }));
    const res = await GET(new Request(base));
    expect(res.status).toBe(403);
  });

  it("returns default major pairs when FX_SYMBOLS is unset", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pairs)).toBe(true);
    expect(body.pairs.length).toBe(7);
    expect(body.pairs[0]).toEqual({
      symbol: "EUR/USD",
      base: "EUR",
      quote: "USD",
      label: "Euro / US Dollar",
    });
  });

  it("includes gold in the defaults with a readable label", async () => {
    const res = await GET(new Request(base));
    const body = await res.json();
    expect(body.pairs).toContainEqual({
      symbol: "XAU/USD",
      base: "XAU",
      quote: "USD",
      label: "Gold / US Dollar",
    });
  });

  it("generates a label for unknown pairs from FX_SYMBOLS", async () => {
    process.env.FX_SYMBOLS = "EUR/CAD";
    vi.resetModules();
    ({ GET } = await import("@/app/api/forex/meta/route"));
    const res = await GET(new Request(base));
    const body = await res.json();
    expect(body.pairs).toEqual([{ symbol: "EUR/CAD", base: "EUR", quote: "CAD", label: "EUR / CAD" }]);
  });

  // Пара, добавленная через админку, должна появляться в списке на графике без
  // передеплоя — до этого список брался только из ENV.
  it("prefers enabled pairs from FxCollectorConfig over FX_SYMBOLS", async () => {
    process.env.FX_SYMBOLS = "EUR/USD";
    mockPrisma.fxCollectorConfig.findMany.mockResolvedValueOnce([{ symbol: "XAU/USD" }]);
    vi.resetModules();
    ({ GET } = await import("@/app/api/forex/meta/route"));
    const res = await GET(new Request(base));
    const body = await res.json();
    expect(body.pairs).toEqual([{ symbol: "XAU/USD", base: "XAU", quote: "USD", label: "Gold / US Dollar" }]);
  });

  it("falls back to FX_SYMBOLS when the database is unavailable", async () => {
    process.env.FX_SYMBOLS = "GBP/USD";
    mockPrisma.fxCollectorConfig.findMany.mockRejectedValueOnce(new Error("db down"));
    vi.resetModules();
    ({ GET } = await import("@/app/api/forex/meta/route"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pairs).toEqual([
      { symbol: "GBP/USD", base: "GBP", quote: "USD", label: "British Pound / US Dollar" },
    ]);
  });
});
