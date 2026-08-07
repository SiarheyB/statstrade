import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  accFindFirst: vi.fn(),
  accFindUnique: vi.fn(),
  hourlyAggregate: vi.fn(),
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
    tradeHourly: { aggregate: mocks.hourlyAggregate },
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
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: 0 } });
    mocks.riskPerTradeAmount.mockReturnValue(0);
    mocks.accFindUnique.mockResolvedValue({ balance: 1000 });
    const r = await getNetStopsCount("u", "e", "day");
    expect(r).toBe(0);
    expect(mocks.cacheSet).toHaveBeenCalledWith("netStops:u:e:day:0", 0, 0);
  });

  it("считает использованные стопы из чистых убытков (неделя)", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: -2000 } });
    const r = await getNetStopsCount("u", "e", "week");
    expect(r).toBe(2);
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
  });

  it("возвращает 0, когда netR >= 0 (прибыль перекрывает стопы)", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: 2000 } });
    const r = await getNetStopsCount("u", "e", "month");
    expect(r).toBe(0);
  });

  it("считает годовой период (ветка year)", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: -2000 } }); // -2R
    const r = await getNetStopsCount("u", "e", "year");
    expect(r).toBe(2);
  });

  it("годовой период отсчитывается от 1 января, а не от начала месяца", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: 0 } });
    await getNetStopsCount("u", "e", "year");
    const from = mocks.hourlyAggregate.mock.calls[0][0].where.hour.gte as Date;
    expect(from.getTime()).toBe(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  });

  it("окно каждого периода совпадает с календарём riskManager", async () => {
    const now = new Date();
    const expected: Record<string, number> = {
      day: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      month: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      year: Date.UTC(now.getUTCFullYear(), 0, 1),
    };
    for (const period of ["day", "month", "year"] as const) {
      mocks.hourlyAggregate.mockClear();
      mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: 0 } });
      await getNetStopsCount("u", "e", period);
      const from = mocks.hourlyAggregate.mock.calls[0][0].where.hour.gte as Date;
      expect(from.getTime()).toBe(expected[period]);
    }
  });

  it("окно «сегодня» сдвигается вместе с таймзоной пользователя", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: 0 } });
    await getNetStopsCount("u", "e", "day", 180); // UTC+3
    const from = mocks.hourlyAggregate.mock.calls[0][0].where.hour.gte as Date;
    const now = new Date();
    const local = new Date(now.getTime() + 3 * 3600_000);
    const expected = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
      - 3 * 3600_000;
    expect(from.getTime()).toBe(expected);
  });

  it("кэш разделён по таймзонам — у разных сдвигов разные окна", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: -2000 } });
    await getNetStopsCount("u", "e", "day", 180);
    expect(mocks.cacheSet.mock.calls[0][0]).toBe("netStops:u:e:day:180");
  });

  it("TTL кэша не переживает конец периода", async () => {
    mocks.hourlyAggregate.mockResolvedValue({ _sum: { netPnl: -2000 } });
    const before = Date.now();
    await getNetStopsCount("u", "e", "year");
    const ttl = mocks.cacheSet.mock.calls[0][2] as number;
    const yearEnd = Date.UTC(new Date().getUTCFullYear() + 1, 0, 1);
    // Раньше TTL считался как "этот же месяц в следующем году" — значение
    // могло пережить 1 января и показать счётчик прошлого года.
    expect(before + ttl).toBeLessThanOrEqual(yearEnd);
    expect(ttl).toBeGreaterThan(0);
  });
});
