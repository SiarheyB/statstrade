/**
 * Тесты для /api/orderflow/divergence
 * src/app/api/orderflow/divergence/route.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем computeDivergence и auth.
const mocks = vi.hoisted(() => ({
  computeDivergence: vi.fn<() => Promise<unknown>>(),
  getAuthUser: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/lib/orderflow", () => ({
  computeDivergence: mocks.computeDivergence,
}));

vi.mock("@/lib/api", () => ({
  getAuthUser: mocks.getAuthUser,
  unauthorized: () => new Response("Unauthorized", { status: 401 }),
  badRequest: (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "content-type": "application/json" } }),
  serverError: (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "content-type": "application/json" } }),
}));

// Helper: create a mock request.
function makeReq(url: string): Request {
  return new Request(url);
}

// Helper: sleep for cache TTL.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Must import after mocks are set up.
const { GET } = await import("../route");

describe("GET /api/orderflow/divergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=BTCUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid data", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeDivergence.mockResolvedValue({
      signals: [
        {
          id: "rb-0-1000000000000",
          type: "regular_bearish",
          strength: 3,
          t: 1000000000000,
          pricePeak: 50000,
          priceTrough: 49000,
          deltaPeak: 100,
          deltaTrough: -50,
          bars: 10,
          confirmed: false,
          label: "Regular Bearish",
        },
      ],
      activeCount: 1,
      totalCount: 1,
    });

    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=BTCUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.period).toBe("24h");
    expect(body.divergence).not.toBeNull();
    expect(body.divergence.signals.length).toBe(1);
    expect(body.divergence.signals[0].type).toBe("regular_bearish");
    expect(body.divergence.totalCount).toBe(1);
  });

  it("returns 200 with null when no divergence", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeDivergence.mockResolvedValue(null);

    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=XRPUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.divergence).toBeNull();
  });

  it("returns 400 for invalid symbol", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=BT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid period", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=BTCUSDT&exchange=binance-futures&period=99h"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid minStrength", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=BTCUSDT&exchange=binance-futures&period=24h&minStrength=99"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid lookbackBars", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=BTCUSDT&exchange=binance-futures&period=24h&lookbackBars=300"));
    expect(res.status).toBe(400);
  });

  it("passes custom params to computeDivergence", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeDivergence.mockResolvedValue(null);

    await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=ETHUSDT&exchange=binance-spot&period=1h&minStrength=3&lookbackBars=30"));

    expect(mocks.computeDivergence).toHaveBeenCalledWith(
      "ETHUSDT",
      "binance-spot",
      "1h",
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({
        minStrength: 3,
        lookbackBars: 30,
      }),
    );
  });

  it("caches identical requests within TTL", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeDivergence.mockResolvedValue({
      signals: [],
      activeCount: 0,
      totalCount: 0,
    });

    // First request.
    const res1 = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=SOLUSDT&exchange=binance-futures&period=24h"));
    expect(res1.status).toBe(200);

    // Second request should use cache (not call computeDivergence again).
    const res2 = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=SOLUSDT&exchange=binance-futures&period=24h"));
    expect(res2.status).toBe(200);
    expect(mocks.computeDivergence).toHaveBeenCalledTimes(1);
  });

  it("returns 500 on computation error", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeDivergence.mockRejectedValue(new Error("db error"));

    const res = await GET(makeReq("http://localhost/api/orderflow/divergence?symbol=ADAUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(500);
  });
});