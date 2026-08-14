import { describe, it, expect, beforeEach, vi } from "vitest";

// backfillMissingRR() запускается один раз при старте процесса
// (instrumentation.ts) и досчитывает rr сделкам, у которых он ещё NULL —
// точечные триггеры на них не сработают, пока в сделке что-то не изменится.
// Проверяем именно этот сценарий: кого он находит и переживает ли он сбой на
// отдельном аккаунте.

const mocks = vi.hoisted(() => ({
  tradeFindMany: vi.fn(),
  importedFindMany: vi.fn(),
  accountFindUnique: vi.fn(),
  riskProfileFindMany: vi.fn(),
  annotationFindMany: vi.fn(),
  transaction: vi.fn(),
  rebuildTradeHourly: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    trade: { findMany: mocks.tradeFindMany, update: vi.fn() },
    importedTrade: { findMany: mocks.importedFindMany, update: vi.fn() },
    exchangeAccount: { findUnique: mocks.accountFindUnique },
    riskProfile: { findMany: mocks.riskProfileFindMany },
    tradeAnnotation: { findMany: mocks.annotationFindMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../hourly", () => ({
  rebuildTradeHourly: mocks.rebuildTradeHourly,
  rebuildTradeHourlyForTrade: vi.fn(),
}));

import { backfillMissingRR } from "../rr";

describe("backfillMissingRR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tradeFindMany.mockResolvedValue([]);
    mocks.importedFindMany.mockResolvedValue([]);
    // Аккаунт есть, сделок в нём не осталось — короткий путь пересчёта.
    mocks.accountFindUnique.mockResolvedValue({ userId: "u1", balance: 10000 });
    mocks.riskProfileFindMany.mockResolvedValue([]);
    mocks.annotationFindMany.mockResolvedValue([]);
    mocks.rebuildTradeHourly.mockResolvedValue(undefined);
  });

  it("does nothing when every trade already has an rr", async () => {
    expect(await backfillMissingRR()).toEqual({ accounts: 0 });
    expect(mocks.rebuildTradeHourly).not.toHaveBeenCalled();
  });

  it("collects accounts from both crypto and imported trades without duplicates", async () => {
    mocks.tradeFindMany
      .mockResolvedValueOnce([{ accountId: "acc-1" }, { accountId: "acc-2" }])
      .mockResolvedValue([]);
    mocks.importedFindMany
      .mockResolvedValueOnce([{ accountId: "acc-2" }, { accountId: "acc-3" }])
      .mockResolvedValue([]);

    expect(await backfillMissingRR()).toEqual({ accounts: 3 });
    expect(mocks.rebuildTradeHourly).toHaveBeenCalledTimes(3);
  });

  it("keeps going when one account fails", async () => {
    mocks.tradeFindMany
      .mockResolvedValueOnce([{ accountId: "acc-1" }, { accountId: "acc-2" }])
      .mockResolvedValue([]);
    mocks.importedFindMany.mockResolvedValue([]);
    // Первый аккаунт падает на чтении риск-контекста.
    mocks.accountFindUnique
      .mockRejectedValueOnce(new Error("db is down"))
      .mockResolvedValue({ userId: "u1", balance: 10000 });

    await expect(backfillMissingRR()).resolves.toEqual({ accounts: 2 });
    // Второй аккаунт всё равно обработан.
    expect(mocks.rebuildTradeHourly).toHaveBeenCalledTimes(1);
  });

  it("skips an account that no longer exists", async () => {
    mocks.tradeFindMany.mockResolvedValueOnce([{ accountId: "gone" }]).mockResolvedValue([]);
    mocks.importedFindMany.mockResolvedValue([]);
    mocks.accountFindUnique.mockResolvedValue(null);

    expect(await backfillMissingRR()).toEqual({ accounts: 1 });
    expect(mocks.rebuildTradeHourly).not.toHaveBeenCalled();
  });
});
