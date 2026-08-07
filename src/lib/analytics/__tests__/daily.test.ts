import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn().mockResolvedValue(1),
  transaction: vi.fn().mockResolvedValue([]),
  tradeFindMany: vi.fn().mockResolvedValue([]),
  importedFindMany: vi.fn().mockResolvedValue([]),
  dailyFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
    trade: { findMany: mocks.tradeFindMany },
    importedTrade: { findMany: mocks.importedFindMany },
    tradeDaily: { findMany: mocks.dailyFindMany },
  },
}));

import {
  rebuildTradeDaily,
  rebuildTradeDailyForDay,
  backfillMissingTradeDaily,
} from "@/lib/analytics/daily";

// Значения, подставленные в шаблоны $executeRaw (tagged template: первый
// аргумент — строки, остальные — интерполяции). Фрагменты Prisma.sql приходят
// вложенными объектами Sql со своим .values — настоящий Prisma их разворачивает,
// в тесте разворачиваем сами.
function flattenSqlValues(values: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const v of values) {
    const nested = (v as { values?: unknown[] } | null)?.values;
    if (Array.isArray(nested)) out.push(...flattenSqlValues(nested));
    else out.push(v);
  }
  return out;
}

function valuesOfCall(idx: number): unknown[] {
  return flattenSqlValues(mocks.executeRaw.mock.calls[idx].slice(1));
}

function datesOfCall(idx: number): Date[] {
  return valuesOfCall(idx).filter((v): v is Date => v instanceof Date);
}

// clearAllMocks() чистит вызовы, но СОХРАНЯЕТ реализации — без явного сброса
// mockResolvedValue из одного теста протекал бы в следующие.
function resetMocks() {
  vi.clearAllMocks();
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.transaction.mockReset().mockResolvedValue([]);
  mocks.tradeFindMany.mockReset().mockResolvedValue([]);
  mocks.importedFindMany.mockReset().mockResolvedValue([]);
  mocks.dailyFindMany.mockReset().mockResolvedValue([]);
}

describe("rebuildTradeDaily", () => {
  beforeEach(resetMocks);

  it("выполняет DELETE и INSERT одной транзакцией", async () => {
    await rebuildTradeDaily("acc-1");
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("удаляет и пересобирает по accountId, без фильтра по дню", async () => {
    await rebuildTradeDaily("acc-1");
    // accountId уходит в DELETE и дважды в INSERT (Trade + ImportedTrade).
    expect(valuesOfCall(0)).toContain("acc-1");
    // Полная пересборка не ограничена датами.
    expect(datesOfCall(0)).toHaveLength(0);
    expect(datesOfCall(1)).toHaveLength(0);
  });
});

describe("rebuildTradeDailyForDay", () => {
  beforeEach(resetMocks);

  it("сводит время выхода к полуночи UTC этого дня", async () => {
    await rebuildTradeDailyForDay("acc-1", new Date("2024-06-15T23:40:00Z"));
    const [day] = datesOfCall(0);
    expect(day.getTime()).toBe(Date.UTC(2024, 5, 15));
  });

  it("поздний вечер по UTC не уезжает на следующий день", async () => {
    // Локальная таймзона машины не должна влиять: день считается по UTC.
    await rebuildTradeDailyForDay("acc-1", new Date("2024-01-01T00:05:00Z"));
    const [day] = datesOfCall(0);
    expect(day.getTime()).toBe(Date.UTC(2024, 0, 1));
  });

  it("ограничивает выборку полусуточным интервалом [день, день+1)", async () => {
    await rebuildTradeDailyForDay("acc-1", new Date("2024-06-15T12:00:00Z"));
    const dates = datesOfCall(1);
    // По границе на каждую из двух таблиц-источников: Trade и ImportedTrade.
    expect(dates).toHaveLength(4);
    for (const d of dates) {
      expect([Date.UTC(2024, 5, 15), Date.UTC(2024, 5, 16)]).toContain(d.getTime());
    }
  });
});

describe("backfillMissingTradeDaily", () => {
  beforeEach(resetMocks);

  it("не трогает аккаунты, у которых агрегаты уже есть", async () => {
    mocks.tradeFindMany.mockResolvedValue([{ accountId: "acc-1" }, { accountId: "acc-2" }]);
    mocks.dailyFindMany.mockResolvedValue([{ accountId: "acc-1" }]);

    const res = await backfillMissingTradeDaily();
    expect(res.accounts).toBe(1);
    expect(valuesOfCall(0)).toContain("acc-2");
  });

  it("покрывает аккаунты с импортированными сделками", async () => {
    mocks.importedFindMany.mockResolvedValue([{ accountId: "mt-1" }]);

    const res = await backfillMissingTradeDaily();
    expect(res.accounts).toBe(1);
    expect(valuesOfCall(0)).toContain("mt-1");
  });

  it("аккаунт с обеими видами сделок пересобирается один раз", async () => {
    mocks.tradeFindMany.mockResolvedValue([{ accountId: "acc-1" }]);
    mocks.importedFindMany.mockResolvedValue([{ accountId: "acc-1" }]);

    const res = await backfillMissingTradeDaily();
    expect(res.accounts).toBe(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("ничего не делает, когда сделок нет", async () => {
    const res = await backfillMissingTradeDaily();
    expect(res.accounts).toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("сбой на одном аккаунте не роняет весь бэкафилл", async () => {
    mocks.tradeFindMany.mockResolvedValue([{ accountId: "acc-1" }, { accountId: "acc-2" }]);
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));

    await expect(backfillMissingTradeDaily()).resolves.toEqual({ accounts: 2 });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});
