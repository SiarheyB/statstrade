import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/recommendations/route";

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));

import * as featureConfig from "@/lib/featureConfig";

const base = "https://example.com/api/recommendations";

const mockSetup = {
  id: "ls-1",
  symbol: "BTCUSDT",
  exchange: "binance-futures",
  levelPrice: 60000,
  levelType: "break_point",
  strength: 3,
  distanceAtr: 0.4,
  bias: "breakout",
  signals: { for: ["a"], against: [] },
  atr: 500,
  currentPrice: 60100,
};

describe("GET /api/recommendations", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true } as any);
    mockPrisma.levelSetup.findMany.mockResolvedValue([mockSetup as any]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the feature is disabled", async () => {
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: false } as any);
    const res = await GET(new Request(base));
    expect(res.status).toBe(404);
  });

  it("returns setups on the happy path", async () => {
    asUser();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.setups).toHaveLength(1);
    expect(body.setups[0].symbol).toBe("BTCUSDT");
  });

  it("filters by a valid bias query param", async () => {
    asUser();
    await GET(new Request(`${base}?bias=breakout`));
    expect(mockPrisma.levelSetup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bias: "breakout" } }),
    );
  });

  it("ignores an invalid bias query param", async () => {
    asUser();
    await GET(new Request(`${base}?bias=bogus`));
    expect(mockPrisma.levelSetup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});
