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

  it("lists every feature with its admin-facing meta", async () => {
    mockFindUnique.mockResolvedValue(null);
    const rows = await getAllFeatureConfigs();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.label).toBeTruthy();
      expect(typeof row.description).toBe("string");
      expect(row.fieldHelp).toBeTypeOf("object");
      expect(row.value.enabled).toBe(true);
      // Мета не должна протекать в значения, которые уходят в приложение.
      expect(row.value).not.toHaveProperty("label");
      expect(row.value).not.toHaveProperty("fieldHelp");
    }
  });

  it("updates only the fields it was given", async () => {
    mockUpsert.mockClear();
    await setFeatureConfig("playbooks", { enabled: false });
    let arg = mockUpsert.mock.calls[0][0];
    expect(arg.update).toEqual({ enabled: false });
    expect(arg.create.enabled).toBe(false);
    expect(arg.create.config).toBeNull();

    mockUpsert.mockClear();
    await setFeatureConfig("playbooks", { config: { maxPerUser: 5 } });
    arg = mockUpsert.mock.calls[0][0];
    expect(arg.update).toEqual({ config: JSON.stringify({ maxPerUser: 5 }) });
    // Новая строка создаётся включённой, если про enabled ничего не сказано.
    expect(arg.create.enabled).toBe(true);
  });
});
