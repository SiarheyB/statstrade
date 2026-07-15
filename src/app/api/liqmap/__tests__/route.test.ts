import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/liqmap/route";

vi.mock("@/lib/liqmap", () => ({
  computeLiqMap: vi.fn().mockResolvedValue({ levels: [], maxVol: 0 }),
}));

const base = "https://example.com/api/liqmap";

describe("GET /api/liqmap", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?exchange=all&symbol=BTCUSDT&tf=7d`));
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown exchange", async () => {
    asUser();
    const res = await GET(new Request(`${base}?exchange=invalid&symbol=BTCUSDT&tf=7d`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("биржа") });
  });

  it("returns 400 for unknown timeframe", async () => {
    asUser();
    const res = await GET(new Request(`${base}?exchange=all&symbol=BTCUSDT&tf=9d`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("таймфрейм") });
  });

  it("returns 400 for too-short symbol", async () => {
    asUser();
    const res = await GET(new Request(`${base}?exchange=all&symbol=BTC&tf=7d`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("символ") });
  });

  it("returns 400 when computeLiqMap yields no data", async () => {
    asUser();
    const { computeLiqMap } = await import("@/lib/liqmap");
    (computeLiqMap as unknown as vi.Mock).mockResolvedValueOnce(null);
    const res = await GET(new Request(`${base}?exchange=all&symbol=BTCUSDT&tf=7d`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Нет данных") });
  });

  it("returns 200 with heatmap for a valid request", async () => {
    asUser();
    const res = await GET(new Request(`${base}?exchange=all&symbol=BTCUSDT&tf=7d`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exchange).toBe("all");
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.tf).toBe("7d");
    expect(body.heatmap).toBeDefined();
  });
});
