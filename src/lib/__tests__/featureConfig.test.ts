import { describe, it, expect, vi } from "vitest";

const { mockFindUnique, mockUpsert } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    featureConfig: { findUnique: mockFindUnique, upsert: mockUpsert },
  },
}));

import { getFeatureConfig, getAllFeatureConfigs, setFeatureConfig } from "@/lib/featureConfig";

describe("featureConfig", () => {
  it("returns defaults (enabled) when no DB row exists", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const cfg = await getFeatureConfig("exitEfficiency");
    expect(cfg.enabled).toBe(true);
    expect((cfg as any).maxTrades).toBe(60);
  });

  it("merges DB overrides over the static defaults", async () => {
    mockFindUnique.mockResolvedValueOnce({
      enabled: false,
      config: JSON.stringify({ maxTrades: 99 }),
    });
    const cfg = await getFeatureConfig("exitEfficiency");
    expect(cfg.enabled).toBe(false);
    expect((cfg as any).maxTrades).toBe(99);
  });

  it("falls back to defaults on corrupt config JSON", async () => {
    mockFindUnique.mockResolvedValueOnce({ enabled: true, config: "{bad" });
    const cfg = await getFeatureConfig("exitEfficiency");
    expect((cfg as any).maxTrades).toBe(60);
  });

  it("getAllFeatureConfigs returns one entry per key with label + value", async () => {
    mockFindUnique.mockResolvedValue(null);
    const all = await getAllFeatureConfigs();
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]).toHaveProperty("label");
    expect(all[0]).toHaveProperty("value");
  });

  it("setFeatureConfig upserts the key with serialized config", async () => {
    await setFeatureConfig("exitEfficiency", { enabled: false, config: { maxTrades: 10 } });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ key: "exitEfficiency" });
    expect(arg.create.config).toBe(JSON.stringify({ maxTrades: 10 }));
  });
});
