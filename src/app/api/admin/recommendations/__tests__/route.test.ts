import { describe, it, expect, vi, beforeEach } from "vitest";
import { asAdmin, asNonAdmin, mockGetAdminSession, mockPrisma, mockRecordAudit } from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/admin/recommendations/route";

vi.mock("@/lib/recommendations/recompute", () => ({
  recomputeRecommendations: vi.fn().mockResolvedValue({ symbolsScanned: 5, levelsWritten: 12, neutralSkipped: 3 }),
}));

vi.mock("@/lib/recommendations/candleScan", () => ({
  refreshDailyCandles: vi.fn().mockResolvedValue({ ok: true, done: 683, total: 683 }),
  getCandleScanStatus: vi.fn().mockResolvedValue({
    running: true,
    done: 333,
    total: 683,
    startedAt: "2026-08-13T18:17:48.621Z",
    finishedAt: null,
    error: null,
  }),
}));

import * as recompute from "@/lib/recommendations/recompute";
import { resetRecomputeProgress } from "@/lib/recommendations/progress";

describe("/api/admin/recommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReset();
    resetRecomputeProgress();
    asAdmin();
    mockPrisma.levelSetup.count.mockResolvedValue(12);
    mockPrisma.levelSetup.findMany.mockResolvedValue([{ symbol: "BTCUSDT" }]);
    // groupBy вызывается дважды — по bias и по direction; отвечаем по аргументу,
    // а не очередью Once, чтобы порядок вызовов не влиял на тест.
    mockPrisma.levelSetup.groupBy.mockReset();
    mockPrisma.levelSetup.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "direction"
        ? [
            { direction: "long", _count: { _all: 8 } },
            { direction: "short", _count: { _all: 4 } },
          ]
        : [
            { bias: "breakout", _count: { _all: 7 } },
            { bias: "false_breakout", _count: { _all: 5 } },
          ],
    );
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
      expect(body.byDirection).toEqual({ long: 8, short: 4 });
      expect(body.lastComputedAt).toBeTruthy();
    });

    it("exposes the collector's own candle download, not just our runs", async () => {
      // Закачку могли начать не отсюда (суточный таймер коллектора) — админка
      // должна её видеть, иначе показывала бы «Готово» от прошлого прогона.
      const res = await GET();
      const body = await res.json();
      expect(body.collectorScan).toMatchObject({ running: true, done: 333, total: 683 });
    });

    it("exposes idle progress when no recompute has run", async () => {
      const res = await GET();
      const body = await res.json();
      expect(body.progress).toMatchObject({ phase: "idle", running: false });
    });
  });

  describe("POST", () => {
    it("returns 404 when not an admin", async () => {
      asNonAdmin();
      const res = await POST();
      expect(res.status).toBe(404);
      expect(recompute.recomputeRecommendations).not.toHaveBeenCalled();
    });

    it("starts a background recompute and records an audit entry when it finishes", async () => {
      const res = await POST();
      expect(res.status).toBe(202);
      expect(recompute.recomputeRecommendations).toHaveBeenCalledTimes(1);
      const body = await res.json();
      expect(body.started).toBe(true);
      expect(body.total).toBe(12);

      await vi.waitFor(() =>
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.anything(),
          "recommendations.recompute",
          expect.objectContaining({ targetType: "LevelSetup" }),
        ),
      );
    });

    it("does not start a second recompute while one is running", async () => {
      // Пересчёт, который не завершается сам — держит job "в полёте".
      vi.mocked(recompute.recomputeRecommendations).mockReturnValueOnce(new Promise(() => {}));

      const first = await POST();
      expect(first.status).toBe(202);

      const second = await POST();
      expect(second.status).toBe(409);
      expect((await second.json()).started).toBe(false);
      expect(recompute.recomputeRecommendations).toHaveBeenCalledTimes(1);
    });
  });
});
