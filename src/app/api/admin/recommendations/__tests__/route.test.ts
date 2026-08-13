import { describe, it, expect, vi, beforeEach } from "vitest";
import { asAdmin, asNonAdmin, mockGetAdminSession, mockPrisma, mockRecordAudit } from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/admin/recommendations/route";

vi.mock("@/lib/recommendations/recompute", () => ({
  recomputeRecommendations: vi.fn().mockResolvedValue({ symbolsScanned: 5, levelsWritten: 12 }),
}));

import * as recompute from "@/lib/recommendations/recompute";

describe("/api/admin/recommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReset();
    asAdmin();
    mockPrisma.levelSetup.count.mockResolvedValue(12);
    mockPrisma.levelSetup.findMany.mockResolvedValue([{ symbol: "BTCUSDT" }]);
    mockPrisma.levelSetup.groupBy.mockResolvedValue([
      { bias: "breakout", _count: { _all: 7 } },
      { bias: "false_breakout", _count: { _all: 5 } },
    ]);
    mockPrisma.levelSetup.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-13T12:00:00Z"),
      candlesTo: new Date("2026-08-12T00:00:00Z"),
    });
  });

  describe("GET", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await GET();
      expect(res.status).toBe(404);
    });

    it("returns the current status on the happy path", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBe(12);
      expect(body.symbolsCovered).toBe(1);
      expect(body.byBias).toEqual({ breakout: 7, false_breakout: 5 });
      expect(body.lastComputedAt).toBeTruthy();
    });
  });

  describe("POST", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await POST();
      expect(res.status).toBe(404);
      expect(recompute.recomputeRecommendations).not.toHaveBeenCalled();
    });

    it("triggers a recompute and records an audit entry", async () => {
      const res = await POST();
      expect(res.status).toBe(200);
      expect(recompute.recomputeRecommendations).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.anything(),
        "recommendations.recompute",
        expect.objectContaining({ targetType: "LevelSetup" }),
      );
      const body = await res.json();
      expect(body.lastRun).toEqual({ symbolsScanned: 5, levelsWritten: 12 });
      expect(body.total).toBe(12);
    });
  });
});
