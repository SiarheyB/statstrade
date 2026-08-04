import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    featureConfig: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import { getExchangeGuides, saveExchangeGuide, DEFAULT_EXCHANGE_GUIDES } from "@/lib/exchange-guides";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getExchangeGuides", () => {
  it("returns defaults when no DB row", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const guides = await getExchangeGuides();
    expect(guides).toEqual(DEFAULT_EXCHANGE_GUIDES);
  });

  it("merges DB overrides on top of defaults", async () => {
    mocks.findUnique.mockResolvedValue({ config: JSON.stringify({ binance: "custom guide" }) });
    const guides = await getExchangeGuides();
    expect(guides.binance).toBe("custom guide");
    expect(guides.bybit).toBe(DEFAULT_EXCHANGE_GUIDES.bybit);
  });

  it("falls back to defaults on corrupt JSON", async () => {
    mocks.findUnique.mockResolvedValue({ config: "{not json" });
    const guides = await getExchangeGuides();
    expect(guides).toEqual(DEFAULT_EXCHANGE_GUIDES);
  });
});

describe("saveExchangeGuide", () => {
  it("upserts merged guides including the new override", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({});
    await saveExchangeGuide("kraken", "new kraken guide");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: "exchange_setup_guides" },
      create: expect.objectContaining({
        key: "exchange_setup_guides",
        enabled: true,
        config: expect.stringContaining("new kraken guide"),
      }),
      update: expect.objectContaining({
        config: expect.stringContaining("new kraken guide"),
      }),
    });
    const savedConfig = JSON.parse(mocks.upsert.mock.calls[0][0].create.config);
    expect(savedConfig.kraken).toBe("new kraken guide");
    expect(savedConfig.binance).toBe(DEFAULT_EXCHANGE_GUIDES.binance);
  });
});
