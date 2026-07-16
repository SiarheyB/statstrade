import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  accFindFirst: vi.fn(),
  accFindUnique: vi.fn(),
  tradeFindMany: vi.fn(),
  riskFindFirst: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  parseRiskProfile: vi.fn(() => ({ enabled: true, riskPerTrade: { type: "amount", value: 1000, unit: "amount" } })),
  defaultRiskProfile: vi.fn(() => ({ enabled: true, riskPerTrade: { type: "amount", value: 1000, unit: "amount" } })),
  riskPerTradeAmount: vi.fn(() => 1000),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    exchangeAccount: { findFirst: mocks.accFindFirst, findUnique: mocks.accFindUnique },
    trade: { findMany: mocks.tradeFindMany },
    riskProfile: { findFirst: mocks.riskFindFirst },
  },
}));
vi.mock("@/lib/cache", () => ({ Cache: { get: mocks.cacheGet, set: mocks.cacheSet } }));
vi.mock("@/lib/risk", () => ({
  parseRiskProfile: mocks.parseRiskProfile,
  defaultRiskProfile: mocks.defaultRiskProfile,
  riskPerTradeAmount: mocks.riskPerTradeAmount,
}));

import { getNetStopsCount } from "@/lib/riskManager";

describe("getNetStopsCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheGet.mockReturnValue(undefined);
    mocks.riskPerTradeAmount.mockReturnValue(1000);
    mocks.parseRiskProfile.mockImplementation(() => ({ enabled: true }));
    mocks.accFindFirst.mockResolvedValue({ id: "acc" });
    mocks.riskFindFirst.mockResolvedValue(null);
    mocks.accFindUnique.mockResolvedValue({ capital: 10000 });
  });

  it("возвращает закэшированное значение без обращения к БД", async () => {
    mocks.cacheGet.mockReturnValue(7);
    const r = await getNetStopsCount("u", "e", "day");
    expect(r).toBe(7);
    expect(mocks.accFindFirst).not.toHaveBeenCalled();
  });

  it("возвращает 0, если аккаунт не найден", async () => {
    mocks.accFindFirst.mockResolvedValue(null);
    const r = await getNetStopsCount("u", "e", "day");
    expect(r).toBe(0);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("возвращает 0 и кэширует, когда rAmount <= 0 (нет ограничений)", async () => {
    mocks.tradeFindMany.mockResolvedValue([]);
    mocks.riskPerTradeAmount.mockReturnValue(0);
    mocks.accFindUnique.mockResolvedValue({ balance: 1000 });
    const r = await getNetStopsCount("u", "e", "day");
    expect(r).toBe(0);
    expect(mocks.cacheSet).toHaveBeenCalledWith("netStops:u:e:day", 0, 0);
  });

  it("считает использованные стопы из чистых убытков (неделя)", async () => {
    mocks.tradeFindMany.mockResolvedValue([
      { netPnl: -3000, result: "loss" },
      { netPnl: 1000, result: "win" }, // -3R +1R = -2R -> used 2
    ]);
    const r = await getNetStopsCount("u", "e", "week");
    expect(r).toBe(2);
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
  });

  it("возвращает 0, когда netR >= 0 (прибыль перекрывает стопы)", async () => {
    mocks.tradeFindMany.mockResolvedValue([
      { netPnl: -1000, result: "loss" },
      { netPnl: 3000, result: "win" }, // -1R +3R = +2R -> 0
    ]);
    const r = await getNetStopsCount("u", "e", "month");
    expect(r).toBe(0);
  });

  it("считает годовой период (ветка year)", async () => {
    mocks.tradeFindMany.mockResolvedValue([{ netPnl: -2000, result: "loss" }]); // -2R
    const r = await getNetStopsCount("u", "e", "year");
    expect(r).toBe(2);
  });
});
