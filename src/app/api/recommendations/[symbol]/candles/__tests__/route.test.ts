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

  it("returns 403 when the feature is disabled", async () => {
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: false } as any);
    const res = await GET(new Request(base), params("BTCUSDT"));
    expect(res.status).toBe(403);
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

// Свечи для рекомендаций пишет суточный скан, поэтому сегодняшний бар в БД
// устаревает к обеду. Роут дотягивает его с биржи — иначе «сегодня уже
// пройдено N×ATR» в карточке показывало бы утреннее состояние.
describe("живой сегодняшний бар", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true } as any);
    // Роут запрашивает orderBy: desc и разворачивает сам — мок отдаёт в том
    // же порядке, что и БД: сначала самая свежая свеча.
    mockPrisma.obCandle.findMany.mockResolvedValue([
      { t: new Date(172_800_000), o: 1.5, h: 1.6, l: 1.4, c: 1.55, v: 20 },
      { t: new Date(86_400_000), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as any);
  });

  it("replaces the last bar with the exchange one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [[172_800_000, "1.5", "9.9", "0.1", "9.0", "999"]],
      })),
    );
    const res = await GET(new Request(base), params("BTCUSDT"));
    const body = await res.json();
    expect(body.candles).toHaveLength(2);
    // Тот же бар по времени — обновлён, а не добавлен вторым.
    expect(body.candles[1]).toMatchObject({ t: 172_800_000, h: 9.9, l: 0.1, c: 9 });
    // Закрытая история из БД не трогается.
    expect(body.candles[0]).toMatchObject({ h: 2, l: 0.5 });
    expect(typeof body.liveBarAt).toBe("number");
    vi.unstubAllGlobals();
  });

  it("appends the bar when today is missing from the DB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [[259_200_000, "1.6", "1.9", "1.5", "1.8", "5"]],
      })),
    );
    const res = await GET(new Request(base), params("BTCUSDT"));
    const body = await res.json();
    expect(body.candles).toHaveLength(3);
    expect(body.candles[2]).toMatchObject({ t: 259_200_000, c: 1.8 });
    vi.unstubAllGlobals();
  });

  it("falls back to the DB when the exchange is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const res = await GET(new Request(base), params("BTCUSDT"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.candles).toHaveLength(2);
    expect(body.candles[1]).toMatchObject({ h: 1.6, l: 1.4 });
    // Клиент по этому полю подписывает, что данные из ночного скана.
    expect(body.liveBarAt).toBeNull();
    vi.unstubAllGlobals();
  });
});
