/**
 * Tests for GET /api/orderflow/absorption
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем computeAbsorption и auth.
const mocks = vi.hoisted(() => ({
  computeAbsorption: vi.fn<() => Promise<unknown>>(),
  getAuthUser: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/lib/orderflow", () => ({
  computeAbsorption: mocks.computeAbsorption,
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

// Must import after mocks are set up.
const { GET } = await import("../route");

const mockAbsorption = {
  signals: [
    {
      t: 1700000000000,
      price: 50000,
      range: 0.5,
      volume: 10000,
      avgVolume: 3000,
      volumeMultiplier: 3.33,
      deltaRatio: 0.05,
      duration: 3,
      strength: 4,
      label: 'Strong Absorption',
    },
  ],
  activeCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/orderflow/absorption', () => {
  it('returns 401 without auth', async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const res = await GET(makeReq('http://localhost/api/orderflow/absorption?symbol=BTCUSDT'));
    expect(res.status).toBe(401);
  });

  it('returns 400 without symbol', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    const res = await GET(makeReq('http://localhost/api/orderflow/absorption'));
    expect(res.status).toBe(400);
  });

  it('returns 400 with invalid symbol', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    const res = await GET(makeReq('http://localhost/api/orderflow/absorption?symbol=btc usdt'));
    expect(res.status).toBe(400);
  });

  it('returns 400 with invalid period', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    const res = await GET(makeReq('http://localhost/api/orderflow/absorption?symbol=BTCUSDT&period=3m'));
    expect(res.status).toBe(400);
  });

  it('returns 200 with absorption data', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    mocks.computeAbsorption.mockResolvedValue(mockAbsorption);

    const res = await GET(makeReq('http://localhost/api/orderflow/absorption?symbol=BTCUSDT&period=5m'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe('BTCUSDT');
    expect(body.absorption).toEqual(mockAbsorption);
    expect(body.absorption.signals).toHaveLength(1);
    expect(body.absorption.signals[0].label).toBe('Strong Absorption');
    expect(mocks.computeAbsorption).toHaveBeenCalledOnce();
  });

  it('returns 200 with null absorption (no data)', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    mocks.computeAbsorption.mockResolvedValue(null);

    const res = await GET(makeReq('http://localhost/api/orderflow/absorption?symbol=BTCUSDT'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.absorption).toBeNull();
  });

  it('caches responses for 12s', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    mocks.computeAbsorption.mockResolvedValue(mockAbsorption);

    // Use unique URL to avoid cache from previous tests
    const uniqueSym = 'CACHETEST' + Date.now();
    const res1 = await GET(makeReq(`http://localhost/api/orderflow/absorption?symbol=${uniqueSym}`));
    expect(res1.status).toBe(200);

    // Second call should use cache
    const res2 = await GET(makeReq(`http://localhost/api/orderflow/absorption?symbol=${uniqueSym}`));
    expect(res2.status).toBe(200);
    expect(mocks.computeAbsorption).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on computeAbsorption error', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    mocks.computeAbsorption.mockRejectedValue(new Error('DB error'));

    const uniqueSym = 'ERRTEST' + Date.now();
    const res = await GET(makeReq(`http://localhost/api/orderflow/absorption?symbol=${uniqueSym}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });

  it('passes custom params to computeAbsorption', async () => {
    mocks.getAuthUser.mockResolvedValue({ id: '1' });
    mocks.computeAbsorption.mockResolvedValue(mockAbsorption);

    await GET(makeReq('http://localhost/api/orderflow/absorption?symbol=ETHUSDT&exchange=bybit&period=1h&minVolumeMultiplier=3&maxRangeBars=2&maxDeltaRatio=0.1&minCandles=3&lookback=15'));
    expect(mocks.computeAbsorption).toHaveBeenCalledWith(
      'ETHUSDT',
      'bybit',
      '1h',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({
        minVolumeMultiplier: 3,
        maxRangeBars: 2,
        maxDeltaRatio: 0.1,
        minCandles: 3,
        lookback: 15,
      }),
    );
  });
});