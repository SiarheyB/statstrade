import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { recomputeRecommendations } from "../recompute";
import * as featureConfig from "@/lib/featureConfig";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function row(dayOffset: number, o: number, h: number, l: number, c: number) {
  return { symbol: "BTCUSDT", exchange: "binance-futures", interval: "1d", t: new Date(START + dayOffset * DAY_MS), o, h, l, c, v: 0 };
}

// Flat series with one fractal pivot high near the end so detectLevels finds
// a break_point level close to the last close (current price).
function seriesWithPivot() {
  const rows = Array.from({ length: 30 }, (_, i) => row(i, 100, 102, 98, 100));
  rows[25] = row(25, 100, 110, 98, 100); // pivot high at 110
  return rows;
}

describe("recomputeRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxDistanceAtr: 1.5 } as any);
    mockPrisma.levelSetup.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.levelSetup.createMany.mockResolvedValue({ count: 0 });
  });

  it("skips symbols with too few candles", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "SHORTUSDT" }])
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => row(i, 100, 101, 99, 100)));

    const result = await recomputeRecommendations();
    expect(result.symbolsScanned).toBe(1);
    expect(result.levelsWritten).toBe(0);
    expect(mockPrisma.levelSetup.createMany).not.toHaveBeenCalled();
  });

  it("truncates and refills LevelSetup with detected levels near price", async () => {
    mockPrisma.obCandle.findMany
      .mockResolvedValueOnce([{ symbol: "BTCUSDT" }])
      .mockResolvedValueOnce(seriesWithPivot());

    const result = await recomputeRecommendations();
    expect(result.symbolsScanned).toBe(1);
    expect(result.levelsWritten).toBeGreaterThan(0);
    expect(mockPrisma.levelSetup.deleteMany).toHaveBeenCalledWith({});
    expect(mockPrisma.levelSetup.createMany).toHaveBeenCalledTimes(1);
    const data = mockPrisma.levelSetup.createMany.mock.calls[0][0].data as unknown[];
    expect(data.length).toBe(result.levelsWritten);
    expect((data[0] as { symbol: string }).symbol).toBe("BTCUSDT");
  });
});
