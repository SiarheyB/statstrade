import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockPrisma } from "@/lib/__tests__/helpers/routeMocks";

vi.mock("@/lib/recommendations/progress", () => ({
  startRecompute: vi.fn(() => ({ started: true, progress: {}, done: Promise.resolve({}) })),
}));

import { runDueRecommendationsRecompute } from "@/lib/scheduler";
import { startRecompute } from "@/lib/recommendations/progress";

const SLOT_PASSED = new Date("2026-08-13T00:07:00Z"); // после 00:05 UTC
const BEFORE_SLOT = new Date("2026-08-13T00:02:00Z");

describe("runDueRecommendationsRecompute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the recompute once today's slot has passed and nothing ran yet", async () => {
    mockPrisma.levelSetup.findFirst.mockResolvedValue(null);

    await expect(runDueRecommendationsRecompute(SLOT_PASSED)).resolves.toBe(true);
    expect(startRecompute).toHaveBeenCalledTimes(1);
  });

  it("does not start before the slot", async () => {
    mockPrisma.levelSetup.findFirst.mockResolvedValue(null);

    await expect(runDueRecommendationsRecompute(BEFORE_SLOT)).resolves.toBe(false);
    expect(startRecompute).not.toHaveBeenCalled();
  });

  it("does not run twice for the same day — a restart must not retrigger it", async () => {
    mockPrisma.levelSetup.findFirst.mockResolvedValue({ createdAt: new Date("2026-08-13T00:05:30Z") });

    await expect(runDueRecommendationsRecompute(SLOT_PASSED)).resolves.toBe(false);
    expect(startRecompute).not.toHaveBeenCalled();
  });

  it("catches up a slot missed while the app was down", async () => {
    mockPrisma.levelSetup.findFirst.mockResolvedValue({ createdAt: new Date("2026-08-11T00:05:00Z") });

    await expect(runDueRecommendationsRecompute(new Date("2026-08-13T14:00:00Z"))).resolves.toBe(true);
    expect(startRecompute).toHaveBeenCalledTimes(1);
  });
});
