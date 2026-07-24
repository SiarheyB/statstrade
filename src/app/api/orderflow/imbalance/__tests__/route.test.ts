/**
 * Тесты для /api/orderflow/imbalance
 * src/app/api/orderflow/imbalance/route.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем computeImbalance, computeSpeedOfTape и auth.
const mocks = vi.hoisted(() => ({
  computeImbalance: vi.fn<() => Promise<unknown>>(),
  computeSpeedOfTape: vi.fn<() => Promise<unknown>>(),
  getAuthUser: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/lib/orderflow", () => ({
  computeImbalance: mocks.computeImbalance,
  computeSpeedOfTape: mocks.computeSpeedOfTape,
}));

vi.mock("@/lib/api", () => ({
  getAuthUser: mocks.getAuthUser,
  unauthorized: () => new Response("Unauthorized", { status: 401 }),
  badRequest: (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "content-type": "application/json" } }),
  serverError: (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "content-type": "application/json" } }),
}));

function makeReq(url: string): Request {
  return new Request(url);
}

const { GET } = await import("../route");

describe("GET /api/orderflow/imbalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=BTCUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid data", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeImbalance.mockResolvedValue({
      times: [1000],
      ratio: [0],
      fullBid: [0.5],
      fullAsk: [0.5],
      nearBid: [0.5],
      nearAsk: [0.5],
      alerts: [],
    });
    mocks.computeSpeedOfTape.mockResolvedValue({
      times: [1000],
      tradesPerMin: [50],
      maxSpeed: 50,
      avgSpeed: 50,
      spikes: [],
    });

    const res = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=BTCUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.imbalance).not.toBeNull();
    expect(body.speedOfTape).not.toBeNull();
    expect(body.imbalance.ratio[0]).toBe(0);
  });

  it("returns 200 with null when no data", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeImbalance.mockResolvedValue(null);
    mocks.computeSpeedOfTape.mockResolvedValue(null);

    const res = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=XRPUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imbalance).toBeNull();
    expect(body.speedOfTape).toBeNull();
  });

  it("returns 400 for invalid symbol", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    const res = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=BT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid period", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    const res = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=BTCUSDT&exchange=binance-futures&period=99h"));
    expect(res.status).toBe(400);
  });

  it("caches identical requests within TTL", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeImbalance.mockResolvedValue({
      times: [1000],
      ratio: [0],
      fullBid: [0.5],
      fullAsk: [0.5],
      nearBid: [0.5],
      nearAsk: [0.5],
      alerts: [],
    });
    mocks.computeSpeedOfTape.mockResolvedValue({
      times: [1000],
      tradesPerMin: [50],
      maxSpeed: 50,
      avgSpeed: 50,
      spikes: [],
    });

    const res1 = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=SOLUSDT&exchange=binance-futures&period=24h"));
    expect(res1.status).toBe(200);

    const res2 = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=SOLUSDT&exchange=binance-futures&period=24h"));
    expect(res2.status).toBe(200);
    expect(mocks.computeImbalance).toHaveBeenCalledTimes(1);
  });

  it("returns 500 on computation error", async () => {
    mocks.getAuthUser.mockResolvedValue({ id: "1" });
    mocks.computeImbalance.mockRejectedValue(new Error("db error"));

    const res = await GET(makeReq("http://localhost/api/orderflow/imbalance?symbol=ADAUSDT&exchange=binance-futures&period=24h"));
    expect(res.status).toBe(500);
  });
});