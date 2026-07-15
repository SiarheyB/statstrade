import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  riskFindFirst: vi.fn(),
  getNetStopsCount: vi.fn(),
  parseRiskProfile: vi.fn(() => ({ enabled: true, riskPerTrade: { type: "amount", value: 1000, unit: "amount" } })),
  defaultRiskProfile: vi.fn(() => ({ enabled: true, riskPerTrade: { type: "amount", value: 1000, unit: "amount" } })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    riskProfile: { findFirst: mocks.riskFindFirst },
  },
}));
vi.mock("@/lib/risk", () => ({
  parseRiskProfile: mocks.parseRiskProfile,
  defaultRiskProfile: mocks.defaultRiskProfile,
  riskPerTradeAmount: vi.fn(() => 1000),
}));
vi.mock("@/lib/riskManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/riskManager")>();
  return { ...actual, getNetStopsCount: mocks.getNetStopsCount };
});

import { checkRiskLimits } from "@/lib/riskManager";

describe("checkRiskLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseRiskProfile.mockImplementation(() => ({ enabled: true, riskPerTrade: { type: "amount", value: 1000, unit: "amount" } }));
    mocks.defaultRiskProfile.mockImplementation(() => ({ enabled: true, riskPerTrade: { type: "amount", value: 1000, unit: "amount" } }));
  });

  it("пропускает не-stop ордера без обращения к БД", async () => {
    await checkRiskLimits("u", "e", "limit");
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("возвращает early, если пользователь не найден", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    await checkRiskLimits("u", "e", "stop");
    expect(mocks.riskFindFirst).not.toHaveBeenCalled();
  });

  it("не бросает, когда лимиты не заданы", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.riskFindFirst.mockResolvedValue(null);
    mocks.getNetStopsCount.mockResolvedValue(0);
    await expect(checkRiskLimits("u", "e", "stop")).resolves.toBeUndefined();
  });

  it("бросает при достижении дневного лимита стопов", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.riskFindFirst.mockResolvedValue({
      enabled: true,
      maxStopsPerDay: null,
      riskPerTrade: null,
      lossLimits: JSON.stringify({ day: { on: true, value: "3" } }),
    });
    mocks.getNetStopsCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    await expect(checkRiskLimits("u", "e", "stop")).rejects.toThrow(/Дневной лимит/);
  });

  it("бросает при достижении месячного лимита", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.riskFindFirst.mockResolvedValue({
      enabled: true,
      maxStopsPerDay: null,
      riskPerTrade: null,
      lossLimits: JSON.stringify({ month: { on: true, value: "5" } }),
    });
    mocks.getNetStopsCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    await expect(checkRiskLimits("u", "e", "stop")).rejects.toThrow(/Месячный лимит/);
  });

  it("не бросает, когда использовано меньше лимита", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.riskFindFirst.mockResolvedValue({
      enabled: true,
      maxStopsPerDay: null,
      riskPerTrade: null,
      lossLimits: JSON.stringify({ day: { on: true, value: "3" } }),
    });
    mocks.getNetStopsCount
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    await expect(checkRiskLimits("u", "e", "stop")).resolves.toBeUndefined();
  });

  it("пропускает, когда профиль риска выключен", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u" });
    mocks.riskFindFirst.mockResolvedValue({
      enabled: false,
      maxStopsPerDay: null,
      riskPerTrade: null,
      lossLimits: JSON.stringify({ day: { on: true, value: "1" } }),
    });
    mocks.parseRiskProfile.mockImplementation(() => ({ enabled: false }));
    mocks.getNetStopsCount.mockResolvedValue(0);
    await expect(checkRiskLimits("u", "e", "stop")).resolves.toBeUndefined();
    expect(mocks.getNetStopsCount).not.toHaveBeenCalled();
  });
});
