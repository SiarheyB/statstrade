import { describe, it, expect, beforeEach } from "vitest";
import { asUser, asGuest, mockPrisma, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/meta/route";

const base = "https://example.com/api/orderflow/meta";

describe("GET /api/orderflow/meta", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.collectorConfig.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 200 with symbols/exchanges/minCoins", async () => {
    asUser();
    mockPrisma.$queryRaw.mockResolvedValue([{ symbol: "BTCUSDT", exchange: "binance-futures" }]);
    mockPrisma.collectorConfig.findMany.mockResolvedValue([
      { symbol: "BTCUSDT", market: "futures", minCoins: 100, collectAll: false },
    ]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbols).toEqual(["BTCUSDT"]);
    expect(body.exchanges).toEqual(["binance-futures"]);
    expect(body.minCoins).toEqual({ "BTCUSDT|futures": 100 });
  });
});
