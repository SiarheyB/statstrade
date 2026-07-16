import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/trade-chart/route";

vi.mock("@/lib/exchanges", () => ({
  getPublicExchange: vi.fn(),
  isExchangeId: vi.fn(() => true),
}));

import * as exchanges from "@/lib/exchanges";

const base = "https://example.com/api/trade-chart";

describe("GET /api/trade-chart", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(exchanges.isExchangeId).mockReturnValue(true);
    vi.mocked(exchanges.getPublicExchange).mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?exchange=bybit&symbol=BTCUSDT&from=1000&to=2000`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when exchange is unsupported", async () => {
    asUser();
    vi.mocked(exchanges.isExchangeId).mockReturnValue(false);
    const res = await GET(new Request(`${base}?exchange=foo&symbol=BTCUSDT&from=1000&to=2000`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when symbol is missing", async () => {
    asUser();
    const res = await GET(new Request(`${base}?exchange=bybit&from=1000&to=2000`));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid time range", async () => {
    asUser();
    const res = await GET(new Request(`${base}?exchange=bybit&symbol=BTCUSDT&from=2000&to=1000`));
    expect(res.status).toBe(400);
  });

  it("returns candles on success", async () => {
    asUser();
    const candles = [[1000, 1, 2, 0.5, 1.5], [2000, 1.5, 2.5, 1, 2]];
    vi.mocked(exchanges.getPublicExchange).mockResolvedValue({
      has: { fetchOHLCV: true },
      fetchOHLCV: vi.fn().mockResolvedValue(candles),
    } as any);
    const res = await GET(new Request(`${base}?exchange=bybit&symbol=BTCUSDT&from=1000&to=2000&market=spot`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.candles)).toBe(true);
    expect(body.candles.length).toBe(2);
    expect(typeof body.timeframe).toBe("string");
  });

  it("returns empty candles when exchange lacks fetchOHLCV", async () => {
    asUser();
    vi.mocked(exchanges.getPublicExchange).mockResolvedValue({
      has: { fetchOHLCV: false },
    } as any);
    const res = await GET(new Request(`${base}?exchange=bybit&symbol=BTCUSDT&from=1000&to=2000`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candles).toEqual([]);
  });
});
