import { describe, it, expect, beforeEach, vi } from "vitest";

// Одна колонка netPnl для Monte Carlo. Проверяем, что выборка ограничена
// счетами пользователя и что маркет-фильтр решает, из каких таблиц читаем:
// крипта живёт в Trade, форекс — в ImportedTrade.

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    exchangeAccount: { findMany: mocks.accounts },
    $queryRaw: mocks.queryRaw,
  },
}));

import { tradeNetPnls } from "@/lib/analytics/tradeReturns";

// Текст запроса вместе с текстом всех вложенных фрагментов.
function sqlText(): string {
  const [strings, ...values] = mocks.queryRaw.mock.calls.at(-1)!;
  const nested = values
    .map((v) => {
      const frag = v as { strings?: string[] };
      return Array.isArray(frag?.strings) ? frag.strings.join(" ") : "";
    })
    .join(" ");
  return [strings.join(" "), nested].join(" ");
}

describe("tradeNetPnls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([{ id: "acc-1" }, { id: "acc-2" }]);
    mocks.queryRaw.mockResolvedValue([{ netPnl: 10 }, { netPnl: -5 }]);
  });

  it("returns an empty list when the user has no accounts", async () => {
    mocks.accounts.mockResolvedValue([]);
    expect(await tradeNetPnls("u1", "all", "all")).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns the netPnl column", async () => {
    expect(await tradeNetPnls("u1", "all", "all")).toEqual([10, -5]);
  });

  it("reads both tables for market=all", async () => {
    await tradeNetPnls("u1", "all", "all");
    const sql = sqlText();
    expect(sql).toContain('"Trade"');
    expect(sql).toContain('"ImportedTrade"');
  });

  it("reads only crypto trades for spot and futures", async () => {
    await tradeNetPnls("u1", "all", "spot");
    expect(sqlText()).toContain("'spot'");
    expect(sqlText()).not.toContain('"ImportedTrade"');

    await tradeNetPnls("u1", "all", "futures");
    expect(sqlText()).toContain("'swap'");
    expect(sqlText()).not.toContain('"ImportedTrade"');
  });

  it("reads only imported trades for forex", async () => {
    await tradeNetPnls("u1", "all", "forex");
    const sql = sqlText();
    expect(sql).toContain('"ImportedTrade"');
    expect(sql).not.toContain('FROM "Trade"');
  });

  it("ignores an accountId the user does not own", async () => {
    await tradeNetPnls("u1", "someone-elses", "all");
    const values = mocks.queryRaw.mock.calls.at(-1)!.slice(1);
    const flat = JSON.stringify(values);
    expect(flat).toContain("acc-1");
    expect(flat).toContain("acc-2");
    expect(flat).not.toContain("someone-elses");
  });

  it("narrows to a single account the user owns", async () => {
    await tradeNetPnls("u1", "acc-2", "all");
    const flat = JSON.stringify(mocks.queryRaw.mock.calls.at(-1)!.slice(1));
    expect(flat).toContain("acc-2");
    expect(flat).not.toContain("acc-1");
  });
});
