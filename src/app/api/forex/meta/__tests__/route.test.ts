import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
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
    expect(body.pairs.length).toBe(6);
    expect(body.pairs[0]).toEqual({
      symbol: "EUR/USD",
      base: "EUR",
      quote: "USD",
      label: "Euro / US Dollar",
    });
  });

  it("generates a label for unknown pairs from FX_SYMBOLS", async () => {
    process.env.FX_SYMBOLS = "XAU/USD";
    vi.resetModules();
    ({ GET } = await import("@/app/api/forex/meta/route"));
    const res = await GET(new Request(base));
    const body = await res.json();
    expect(body.pairs).toEqual([{ symbol: "XAU/USD", base: "XAU", quote: "USD", label: "XAU / USD" }]);
  });
});
