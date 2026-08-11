import { describe, it, expect, beforeEach, vi } from "vitest";

// Список сделок собирается сырым SQL поверх двух таблиц (Trade +
// ImportedTrade), поэтому проверяем не текст запроса, а поведение: чьи счета
// попали в выборку, какие фильтры доехали до параметров, где мы отвечаем
// пустой страницей не ходя в БД.

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  annotations: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    exchangeAccount: { findMany: mocks.accounts },
    tradeAnnotation: { findMany: mocks.annotations },
    $queryRaw: mocks.queryRaw,
  },
}));

import { queryTrades, querySymbols, UNSET, TRADE_SORTS } from "@/lib/analytics/tradeList";
import type { TradeFilters } from "@/lib/analytics/tradeList";

const ALL: TradeFilters = {
  accountId: "all",
  symbol: "all",
  market: "all",
  side: "all",
  result: "all",
  entryPoint: "all",
  entryType: "all",
  mistake: "all",
  pattern: "all",
};

const row = {
  id: "acc-1:t1",
  symbol: "BTC/USDT:USDT",
  base: "BTC",
  quote: "USDT",
  market: "swap",
  exchange: "bybit",
  accountId: "acc-1",
  side: "long",
  entryTime: new Date("2026-01-01T10:00:00Z"),
  exitTime: new Date("2026-01-01T12:00:00Z"),
  qty: 1,
  entryPrice: 100,
  exitPrice: 110,
  grossPnl: 10,
  fees: 1,
  netPnl: 9,
  returnPct: 9,
  fillCount: 2,
  result: "win",
  rr: 1.5,
  lots: null,
  pips: null,
  swap: null,
  commission: null,
  assetClass: null,
  accountCurrency: null,
  stopLoss: 95,
};

// Значения, подставленные в сырой запрос. Prisma.sql вкладывает фрагменты
// друг в друга, поэтому разворачиваем дерево до плоского списка параметров.
function flatten(values: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const v of values) {
    const nested = v as { values?: unknown[]; strings?: unknown[] };
    if (v && typeof v === "object" && Array.isArray(nested.values) && Array.isArray(nested.strings)) {
      out.push(...flatten(nested.values));
    } else {
      out.push(v);
    }
  }
  return out;
}

function valuesOf(callIndex: number): unknown[] {
  return flatten(mocks.queryRaw.mock.calls.at(callIndex)!.slice(1));
}

describe("queryTrades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([{ id: "acc-1" }, { id: "acc-2" }]);
    mocks.annotations.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([row]);
  });

  it("returns an empty page when the user has no accounts, without touching the DB", async () => {
    mocks.accounts.mockResolvedValue([]);
    const res = await queryTrades("u1", ALL, "exitTime", "desc", { page: 0, pageSize: 50 });
    expect(res).toEqual({ trades: [], total: 0 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("ignores an accountId that belongs to somebody else", async () => {
    await queryTrades("u1", { ...ALL, accountId: "someone-elses" }, "exitTime", "desc", {
      page: 0,
      pageSize: 50,
    });
    // Чужой счёт не сузил выборку до себя — остались только свои два.
    const values = valuesOf(0);
    expect(values).toContain("acc-1");
    expect(values).toContain("acc-2");
    expect(values).not.toContain("someone-elses");
  });

  it("narrows the query to one account the user does own", async () => {
    await queryTrades("u1", { ...ALL, accountId: "acc-2" }, "exitTime", "desc", {
      page: 0,
      pageSize: 50,
    });
    const values = valuesOf(0);
    expect(values).toContain("acc-2");
    expect(values).not.toContain("acc-1");
  });

  it("passes symbol, side and result filters to the query", async () => {
    await queryTrades(
      "u1",
      { ...ALL, symbol: "BTCUSDT", side: "short", result: "loss" },
      "netPnl",
      "asc",
      { page: 0, pageSize: 50 },
    );
    const values = valuesOf(0);
    expect(values).toContain("BTCUSDT");
    expect(values).toContain("short");
    expect(values).toContain("loss");
  });

  it("passes a valid date window and drops an unparsable one", async () => {
    await queryTrades("u1", { ...ALL, from: "2026-01-01", to: "не дата" }, "exitTime", "desc", {
      page: 0,
      pageSize: 50,
    });
    const dates = valuesOf(0).filter((v) => v instanceof Date);
    expect(dates).toHaveLength(1);
    expect((dates[0] as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns an empty page when an annotation filter matches nothing", async () => {
    mocks.annotations.mockResolvedValue([{ tradeKey: "acc-1:t1", pattern: "Breakout" }]);
    const res = await queryTrades("u1", { ...ALL, pattern: "Range" }, "exitTime", "desc", {
      page: 0,
      pageSize: 50,
    });
    expect(res).toEqual({ trades: [], total: 0 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("filters by a concrete annotation value", async () => {
    mocks.annotations.mockResolvedValue([
      { tradeKey: "acc-1:t1", pattern: "Breakout" },
      { tradeKey: "acc-1:t2", pattern: "Range" },
    ]);
    await queryTrades("u1", { ...ALL, pattern: "Breakout" }, "exitTime", "desc", {
      page: 0,
      pageSize: 50,
    });
    const values = valuesOf(0);
    expect(values).toContain("acc-1:t1");
    expect(values).not.toContain("acc-1:t2");
  });

  it("treats «not set» as excluding trades where the field is filled", async () => {
    mocks.annotations.mockResolvedValue([
      { tradeKey: "acc-1:t1", mistake: "Ранний вход" },
      { tradeKey: "acc-1:t2", mistake: null },
    ]);
    await queryTrades("u1", { ...ALL, mistake: UNSET }, "exitTime", "desc", {
      page: 0,
      pageSize: 50,
    });
    const values = valuesOf(0);
    expect(values).toContain("acc-1:t1");
    expect(values).not.toContain("acc-1:t2");
  });

  it("skips the second query when nothing matched the count", async () => {
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValueOnce([{ n: 0 }]);
    const res = await queryTrades("u1", ALL, "exitTime", "desc", { page: 0, pageSize: 50 });
    expect(res).toEqual({ trades: [], total: 0 });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("paginates with limit and offset", async () => {
    await queryTrades("u1", ALL, "exitTime", "desc", { page: 2, pageSize: 25 });
    const values = valuesOf(-1);
    expect(values).toContain(25); // LIMIT
    expect(values).toContain(50); // OFFSET = page * pageSize
  });

  it("omits limit/offset in export mode", async () => {
    await queryTrades("u1", ALL, "exitTime", "desc", { all: true });
    const sql = mocks.queryRaw.mock.calls.at(-1)![0].join("");
    expect(sql).not.toContain("LIMIT");
  });

  it("serializes a trade and merges its annotation", async () => {
    mocks.annotations.mockResolvedValue([
      { tradeKey: "acc-1:t1", pattern: "Breakout", note: "чистый пробой", stopLoss: 90 },
    ]);
    const res = await queryTrades("u1", ALL, "exitTime", "desc", { page: 0, pageSize: 50 });
    expect(res.total).toBe(1);
    const t = res.trades[0];
    expect(t.id).toBe("acc-1:t1");
    expect(t.entryTime).toBe("2026-01-01T10:00:00.000Z");
    expect(t.durationMs).toBe(2 * 60 * 60 * 1000);
    expect(t.pattern).toBe("Breakout");
    expect(t.note).toBe("чистый пробой");
    // Ручной стоп из аннотации перекрывает импортированный.
    expect(t.stopLoss).toBe(90);
    // Форекс-полей у крипто-сделки быть не должно.
    expect(t).not.toHaveProperty("lots");
  });

  it("keeps the imported stop-loss when the user has not overridden it", async () => {
    const res = await queryTrades("u1", ALL, "exitTime", "desc", { page: 0, pageSize: 50 });
    expect(res.trades[0].stopLoss).toBe(95);
    expect(res.trades[0].pattern).toBeNull();
  });

  it("adds forex-only fields when the row has them", async () => {
    mocks.queryRaw.mockReset();
    mocks.queryRaw
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([
        { ...row, lots: 0.5, pips: 12, swap: -1, commission: 2, assetClass: "forex", accountCurrency: "USD" },
      ]);
    const res = await queryTrades("u1", ALL, "exitTime", "desc", { page: 0, pageSize: 50 });
    expect(res.trades[0]).toMatchObject({
      lots: 0.5,
      pips: 12,
      swap: -1,
      commission: 2,
      assetClass: "forex",
      accountCurrency: "USD",
    });
  });

  it("accepts every whitelisted sort column", async () => {
    for (const sort of TRADE_SORTS) {
      mocks.queryRaw.mockReset();
      mocks.queryRaw.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([row]);
      const res = await queryTrades("u1", ALL, sort, "asc", { page: 0, pageSize: 10 });
      expect(res.total).toBe(1);
    }
  });
});

describe("querySymbols", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([{ id: "acc-1" }]);
  });

  it("returns an empty list when the user has no accounts", async () => {
    mocks.accounts.mockResolvedValue([]);
    expect(await querySymbols("u1")).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns canonical symbols from the DB", async () => {
    mocks.queryRaw.mockResolvedValue([{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }]);
    expect(await querySymbols("u1")).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});
