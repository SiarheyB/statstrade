import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/recommendations/[symbol]/candles/route";

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));

import * as featureConfig from "@/lib/featureConfig";

const base = "https://example.com/api/recommendations/BTCUSDT/candles";

function params(symbol: string) {
  return { params: Promise.resolve({ symbol }) };
}

describe("GET /api/recommendations/[symbol]/candles", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true } as any);
    mockPrisma.obCandle.findMany.mockResolvedValue([
      { t: new Date(1000), o: 1, h: 2, l: 0.5, c: 1.5 },
    ] as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base), params("BTCUSDT"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the feature is disabled", async () => {
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: false } as any);
    const res = await GET(new Request(base), params("BTCUSDT"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for a too-short symbol", async () => {
    asUser();
    const res = await GET(new Request(base), params("BTC"));
    expect(res.status).toBe(400);
  });

  it("returns candles on the happy path", async () => {
    asUser();
    const res = await GET(new Request(base), params("btcusdt"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.candles).toHaveLength(1);
    expect(body.candles[0]).toEqual({ t: 1000, o: 1, h: 2, l: 0.5, c: 1.5 });
  });

  it("asks the DB for the NEWEST candles and returns them oldest-first", async () => {
    asUser();
    // База отдаёт по убыванию (новейшая первой) — ответ должен быть развёрнут
    // в хронологический порядок, иначе график рисуется задом наперёд.
    mockPrisma.obCandle.findMany.mockResolvedValue([
      { t: new Date(3000), o: 3, h: 4, l: 2, c: 3.5 },
      { t: new Date(2000), o: 2, h: 3, l: 1, c: 2.5 },
      { t: new Date(1000), o: 1, h: 2, l: 0.5, c: 1.5 },
    ]);

    const res = await GET(new Request(base), params("btcusdt"));
    const body = await res.json();

    // С `asc` + `take` пришёл бы кусок истории годичной давности, а не подход
    // к уровню, ради которого график и рисуется.
    expect(mockPrisma.obCandle.findMany.mock.calls[0][0].orderBy).toEqual({ t: "desc" });
    expect(body.candles.map((c: { t: number }) => c.t)).toEqual([1000, 2000, 3000]);
  });
});
