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
    tradeHourly: { findMany: mocks.dailyFindMany },
  },
}));

import {
  rebuildTradeHourly,
  rebuildTradeHourlyForTrade,
} from "@/lib/analytics/hourly";

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

describe("rebuildTradeHourly", () => {
  beforeEach(resetMocks);

  it("выполняет DELETE и INSERT одной транзакцией", async () => {
    await rebuildTradeHourly("acc-1");
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("удаляет и пересобирает по accountId, без фильтра по дню", async () => {
    await rebuildTradeHourly("acc-1");
    // accountId уходит в DELETE и дважды в INSERT (Trade + ImportedTrade).
    expect(valuesOfCall(0)).toContain("acc-1");
    // Полная пересборка не ограничена датами.
    expect(datesOfCall(0)).toHaveLength(0);
    expect(datesOfCall(1)).toHaveLength(0);
  });
});

describe("rebuildTradeHourlyForTrade", () => {
  beforeEach(resetMocks);

  it("сводит время выхода к началу часа UTC", async () => {
    await rebuildTradeHourlyForTrade("acc-1", new Date("2024-06-15T23:40:00Z"));
    const [hour] = datesOfCall(0);
    expect(hour.getTime()).toBe(Date.UTC(2024, 5, 15, 23));
  });

  it("локальная таймзона машины не влияет — час считается по UTC", async () => {
    await rebuildTradeHourlyForTrade("acc-1", new Date("2024-01-01T00:05:00Z"));
    const [hour] = datesOfCall(0);
    expect(hour.getTime()).toBe(Date.UTC(2024, 0, 1, 0));
  });

  it("ограничивает выборку интервалом [час, час+1)", async () => {
    await rebuildTradeHourlyForTrade("acc-1", new Date("2024-06-15T12:30:00Z"));
    const dates = datesOfCall(1);
    // По две границы на каждую из двух таблиц-источников: Trade и ImportedTrade.
    expect(dates).toHaveLength(4);
    for (const d of dates) {
      expect([Date.UTC(2024, 5, 15, 12), Date.UTC(2024, 5, 15, 13)]).toContain(d.getTime());
    }
  });
});
