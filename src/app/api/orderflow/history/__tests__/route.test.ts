import { describe, it, expect, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/history/route";

const base = "https://example.com/api/orderflow/history";

describe("GET /api/orderflow/history", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.obCandle.findMany.mockReset().mockResolvedValue([]);
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&before=${Date.now()}`));
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown timeframe", async () => {
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=3m&before=${Date.now()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid symbol (too short)", async () => {
    const res = await GET(new Request(`${base}?symbol=BTC&range=1h&before=${Date.now()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when before is missing/invalid", async () => {
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h`));
    expect(res.status).toBe(400);
  });

  it("returns 200 with candles and hasMore on the happy path", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      t: new Date(now - i * 3600_000),
      o: 100,
      h: 101,
      l: 99,
      c: 100.5,
    }));
    mockPrisma.obCandle.findMany.mockResolvedValue(rows);
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&range=1h&before=${now}&limit=500`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.candles)).toBe(true);
    expect(body.candles.length).toBe(500);
    expect(body.hasMore).toBe(true);
  });

  it("returns 200 with empty candles when the DB call fails (fetchOrderflowCandlesBefore swallows errors)", async () => {
    mockPrisma.obCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&before=${Date.now()}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candles).toEqual([]);
    expect(body.hasMore).toBe(false);
  });
});
