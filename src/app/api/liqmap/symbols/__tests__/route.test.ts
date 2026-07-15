import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/liqmap/symbols/route";

const base = "https://example.com/api/liqmap/symbols";

const binanceJson = {
  symbols: [
    { symbol: "BTCUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT" },
    { symbol: "ETHUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT" },
    { symbol: "BTCBUSD", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "BUSD" },
    { symbol: "DOTUSDT", status: "BREAK", contractType: "PERPETUAL", quoteAsset: "USDT" },
  ],
};

describe("GET /api/liqmap/symbols", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 200 with filtered USDT perpetual symbols from Binance", async () => {
    asUser();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(binanceJson) }),
    );
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("falls back to built-in list when Binance fetch fails", async () => {
    asUser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbols).toContain("BTCUSDT");
    expect(body.symbols).toContain("ETHUSDT");
  });
});
