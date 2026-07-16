import { describe, it, expect, vi, beforeEach } from "vitest";

// Use simple mocks for everything - don't mock the internal functions
const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  riskProfileFindFirst: vi.fn(),
  exchangeAccountFindFirst: vi.fn(),
  exchangeAccountFindUnique: vi.fn(),
  tradeFindMany: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    riskProfile: { findFirst: mocks.riskProfileFindFirst },
    exchangeAccount: { findFirst: mocks.exchangeAccountFindFirst, findUnique: mocks.exchangeAccountFindUnique },
    trade: { findMany: mocks.tradeFindMany },
  },
}));

vi.mock("@/lib/risk", () => ({
  parseRiskProfile: vi.fn((row) => {
    if (!row) return { enabled: false, maxStopsPerDay: null, riskPerTrade: { on: false, value: 0, unit: "pct" }, lossLimits: {} };
    // parseRiskProfile processes the row from DB - return the enabled flag
    return { enabled: !!row.enabled, maxStopsPerDay: row.maxStopsPerDay, riskPerTrade: row.riskPerTrade, lossLimits: {} };
  }),
  defaultRiskProfile: vi.fn(() => ({ enabled: true, lossLimits: { day: { on: false, value: 0 }, week: { on: false, value: 0 }, month: { on: false, value: 0 }, year: { on: false, value: 0 } } })),
  riskPerTradeAmount: vi.fn().mockReturnValue(1000),
}));

vi.mock("@/lib/cache", () => ({ Cache: { get: mocks.cacheGet, set: mocks.cacheSet } }));

import { checkRiskLimits } from "@/lib/riskManager";

describe("checkRiskLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Basic successful mocks
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.exchangeAccountFindFirst.mockResolvedValue({ id: "acc" });
    mocks.exchangeAccountFindUnique.mockResolvedValue({ capital: 10000 });
    mocks.tradeFindMany.mockResolvedValue([]);
    mocks.cacheGet.mockReturnValue(undefined);
  });

  it("пропускает не‑stop ордера без обращения к БД", async () => {
    await checkRiskLimits("u", "e", "limit");
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("возвращает early, если пользователь не найден", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    await checkRiskLimits("u", "e", "stop");
    expect(mocks.riskProfileFindFirst).not.toHaveBeenCalled();
  });

  it("не бросает, когда лимиты не заданы", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.riskProfileFindFirst.mockResolvedValue(null);
    await expect(checkRiskLimits("u", "u", "stop")).resolves.toBeUndefined();
  });

  it("бросает при достижении дневного лимита стопов", async () => {
    // Setup risk profile with daily limit of 3
    mocks.riskProfileFindFirst.mockResolvedValue({
      enabled: true,
      maxStopsPerDay: null,
      riskPerTrade: null,
      lossLimits: JSON.stringify({
        day: { on: true, value: "3", unit: "pct" },
        week: { on: false, value: 0, unit: "pct" },
        month: { on: false, value: 0, unit: "pct" },
        year: { on: false, value: 0, unit: "pct" },
      }),
    });

    // getNetStopsCount internal flow: find account -> find trades -> find risk profile -> get balance
    mocks.exchangeAccountFindFirst.mockResolvedValue({ id: "acc" });
    mocks.exchangeAccountFindUnique.mockResolvedValue({ capital: 10000 });

    // Trade data that results in exactly 3 stops used
    // R = 1000, so -1000 = -1R each. 3 losses = -3R -> ceil(3) = 3 used
    mocks.tradeFindMany.mockResolvedValue([
      { netPnl: -1000, result: "loss" },
      { netPnl: -1000, result: "loss" },
      { netPnl: -1000, result: "loss" },
    ]);

    // Should reject because dayUsage (3) >= dailyLimit (3)
    await expect(checkRiskLimits("u", "e", "stop")).rejects.toThrow(/Дневной лимит стоп‑ордеров \(3\) уже достигнут/);
  });

  it("не бросает, когда использовано меньше лимита", async () => {
    // Setup risk profile with daily limit of 3
    mocks.riskProfileFindFirst.mockResolvedValue({
      enabled: true,
      maxStopsPerDay: null,
      riskPerTrade: null,
      lossLimits: JSON.stringify({
        day: { on: true, value: "3", unit: "pct" },
        week: { on: false, value: 0, unit: "pct" },
        month: { on: false, value: 0, unit: "pct" },
        year: { on: false, value: 0, unit: "pct" },
      }),
    });

    mocks.exchangeAccountFindFirst.mockResolvedValue({ id: "acc" });
    mocks.exchangeAccountFindUnique.mockResolvedValue({ capital: 10000 });

    // Trade data that results in 2 stops used (below limit)
    mocks.tradeFindMany.mockResolvedValue([
      { netPnl: -1000, result: "loss" },
      { netPnl: -1000, result: "loss" },
    ]);

    // Should resolve because dayUsage (2) < dailyLimit (3)
    await expect(checkRiskLimits("u", "e", "stop")).resolves.toBeUndefined();
  });

  it("пропускает, когда профиль риска выключен", async () => {
    // Need to mock parseRiskProfile to return disabled
    vi.doMock("@/lib/risk", () => ({
      parseRiskProfile: vi.fn(() => ({ enabled: false } as any)),
      defaultRiskProfile: vi.fn(() => ({ enabled: true })),
      riskPerTradeAmount: vi.fn().mockReturnValue(1000),
    }));

    await expect(checkRiskLimits("u", "e", "stop")).resolves.toBeUndefined();
  });
});