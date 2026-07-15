import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("ccxt", () => ({ default: {} }));

vi.mock("@/lib/db", () => ({
  prisma: {
    exchangeToggle: { findMany: mocks.mockFindMany, findUnique: mocks.mockFindUnique },
  },
}));

import { isExchangeEnabled, getEnabledExchangeMetas, getAllExchangeToggles } from "@/lib/exchangeToggle";

describe("exchangeToggle", () => {
  it("isExchangeEnabled defaults to true when no DB row exists", async () => {
    mocks.mockFindUnique.mockResolvedValueOnce(null);
    expect(await isExchangeEnabled("binance")).toBe(true);
  });

  it("isExchangeEnabled honours the DB row", async () => {
    mocks.mockFindUnique.mockResolvedValueOnce({ enabled: false });
    expect(await isExchangeEnabled("binance")).toBe(false);
  });

  it("getEnabledExchangeMetas drops disabled exchanges", async () => {
    mocks.mockFindMany.mockResolvedValueOnce([
      { exchange: "binance", enabled: false, demoEnabled: null },
    ]);
    const metas = await getEnabledExchangeMetas();
    expect(metas.find((m) => m.id === "binance")).toBeUndefined();
    expect(metas.length).toBeGreaterThan(0);
  });

  it("getAllExchangeToggles returns every exchange with the DB demo override applied", async () => {
    mocks.mockFindMany.mockResolvedValueOnce([
      { exchange: "binance", enabled: true, demoEnabled: false },
    ]);
    const all = await getAllExchangeToggles();
    const b = all.find((m) => m.id === "binance");
    expect(b?.enabled).toBe(true);
    expect(b?.demoEnabled).toBe(false);
  });
});
