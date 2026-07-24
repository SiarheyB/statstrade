import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/volume-profile/route";

vi.mock("@/lib/orderflow", () => ({
  computeVolumeProfile: vi.fn(),
}));

import { computeVolumeProfile } from "@/lib/orderflow";

const base = "https://example.com/api/orderflow/volume-profile";

describe("GET /api/orderflow/volume-profile", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(computeVolumeProfile).mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT`));
    expect(res.status).toBe(401);
  });

  it("returns 200 with volume profile data", async () => {
    asUser();
    const mockProfile = {
      poc: 50000,
      vah: 51000,
      val: 49000,
      levels: [
        { price: 49000, volume: 100, isPoc: false, isVa: true, pct: 50 },
        { price: 50000, volume: 200, isPoc: true, isVa: true, pct: 100 },
        { price: 51000, volume: 100, isPoc: false, isVa: true, pct: 50 },
      ],
      totalVolume: 1000,
      pocVolume: 200,
      valueAreaVolume: 700,
      valueAreaPct: 0.7,
      binSize: 100,
    };
    vi.mocked(computeVolumeProfile).mockResolvedValue(mockProfile);

    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&period=24h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.exchange).toBe("binance-futures");
    expect(body.period).toBe("24h");
    expect(body.volumeProfile).toBeDefined();
    expect(body.volumeProfile.poc).toBe(50000);
    expect(body.volumeProfile.vah).toBe(51000);
    expect(body.volumeProfile.val).toBe(49000);
    expect(body.volumeProfile.levels).toHaveLength(3);
  });

  it("returns 200 with null for empty data", async () => {
    asUser();
    vi.mocked(computeVolumeProfile).mockResolvedValue(null);

    const res = await GET(new Request(`${base}?symbol=ETHUSDT&period=24h`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.volumeProfile).toBeNull();
  });

  it("returns 400 for invalid symbol", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BT`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("символ") });
  });

  it("returns 400 for invalid period", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&period=999h`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("период") });
  });

  it("returns 400 for invalid bins", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&bins=9999`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("bins") });
  });

  it("returns 400 for invalid valueAreaPct", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&valueAreaPct=2`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("valueAreaPct") });
  });

  it("passes custom bins to computeVolumeProfile", async () => {
    asUser();
    vi.mocked(computeVolumeProfile).mockResolvedValue(null);

    await GET(new Request(`${base}?symbol=BTCUSDT&bins=50`));
    expect(computeVolumeProfile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ bins: 50 }),
    );
  });

  it("passes custom valueAreaPct to computeVolumeProfile", async () => {
    asUser();
    vi.mocked(computeVolumeProfile).mockResolvedValue(null);

    await GET(new Request(`${base}?symbol=ETHUSDT&valueAreaPct=0.5`));
    expect(computeVolumeProfile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ valueAreaPct: 0.5 }),
    );
  });

  it("uses cache within TTL", async () => {
    asUser();
    vi.mocked(computeVolumeProfile).mockResolvedValue({
      poc: 50000, vah: 51000, val: 49000,
      levels: [], totalVolume: 1000, pocVolume: 200,
      valueAreaVolume: 700, valueAreaPct: 0.7, binSize: 100,
    });

    // Первый запрос — уникальный cache key.
    await GET(new Request(`${base}?symbol=SOLUSDT&period=24h`));
    expect(computeVolumeProfile).toHaveBeenCalledTimes(1);

    // Второй запрос (в пределах TTL) — должен использовать кэш.
    await GET(new Request(`${base}?symbol=SOLUSDT&period=24h`));
    expect(computeVolumeProfile).toHaveBeenCalledTimes(1);
  });

  it("returns 500 on computeVolumeProfile error", async () => {
    asUser();
    vi.mocked(computeVolumeProfile).mockRejectedValue(new Error("db error"));

    const res = await GET(new Request(`${base}?symbol=ADAUSDT`));
    expect(res.status).toBe(500);
  });
});