import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/route";

vi.mock("@/lib/orderflow", () => ({
  computeOrderflow: vi.fn().mockResolvedValue({ bins: [], maxVol: 0 }),
  fetchOrderflowCandles: vi.fn().mockResolvedValue([]),
  computeDelta: vi.fn().mockResolvedValue({ series: [] }),
  computeFootprint: vi.fn().mockResolvedValue({ candles: [] }),
  computeBA: vi.fn().mockResolvedValue({ series: [] }),
  computeBigTrades: vi.fn().mockResolvedValue([]),
}));

const base = "https://example.com/api/orderflow";

describe("GET /api/orderflow", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h`));
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown timeframe", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=9h`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("таймфрейм") });
  });

  it("returns 400 for too-short symbol", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTC&range=1h`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("символ") });
  });

  it("returns 400 for invalid timezone", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&tz=Mars/Phobos`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("часовой пояс") });
  });

  it("returns 200 with assembled payload for a valid request", async () => {
    asUser();
    const res = await GET(
      new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&range=1h`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.exchange).toBe("binance-futures");
    expect(body.range).toBe("1h");
    expect(body.heatmap).toBeDefined();
    expect(body.candles).toEqual([]);
    expect(body.timezone).toBe("auto");
  });
});
