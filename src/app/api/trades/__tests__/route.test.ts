import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/trades/route";

vi.mock("@/lib/analytics/materialize", () => ({
  ensureAccountTrades: vi.fn().mockResolvedValue(undefined),
}));

const mockQueryTrades = vi.fn();
const mockQuerySymbols = vi.fn();
vi.mock("@/lib/analytics/tradeList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/tradeList")>();
  return {
    ...actual,
    queryTrades: (...args: unknown[]) => mockQueryTrades(...args),
    querySymbols: (...args: unknown[]) => mockQuerySymbols(...args),
  };
});

const base = "https://example.com/api/trades";

// Аргументы, с которыми роут позвал слой выборки.
function callArgs() {
  const [, filters, sort, dir, opts] = mockQueryTrades.mock.calls[0];
  return { filters, sort, dir, opts };
}

describe("GET /api/trades", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([]);
    mockQueryTrades.mockReset().mockResolvedValue({ trades: [], total: 0 });
    mockQuerySymbols.mockReset().mockResolvedValue(["BTCUSDT"]);
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("defaults to page 0, 25 per page, sorted by exitTime desc", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const { sort, dir, opts } = callArgs();
    expect(sort).toBe("exitTime");
    expect(dir).toBe("desc");
    expect(opts).toEqual({ page: 0, pageSize: 25 });
  });

  it("passes every filter through", async () => {
    await GET(new Request(
      `${base}?accountId=acc1&symbol=BTCUSDT&market=futures&side=long&result=win` +
      `&entryPoint=Retest&entryType=Limit&mistake=__unset__&pattern=Breakout`,
    ));
    expect(callArgs().filters).toEqual({
      accountId: "acc1", symbol: "BTCUSDT", market: "futures", side: "long",
      result: "win", entryPoint: "Retest", entryType: "Limit",
      mistake: "__unset__", pattern: "Breakout", from: null, to: null,
    });
  });

  it("passes the exit-time window through (день в «Календаре»)", async () => {
    asUser();
    await GET(new Request(
      `${base}?from=2026-03-02T21:00:00Z&to=2026-03-03T21:00:00Z`,
    ));
    const f = callArgs().filters;
    expect(f.from).toBe("2026-03-02T21:00:00Z");
    expect(f.to).toBe("2026-03-03T21:00:00Z");
  });

  it("falls back to exitTime for an unknown sort key (no SQL injection surface)", async () => {
    await GET(new Request(`${base}?sort=netPnl%22%3B+DROP+TABLE+%22Trade`));
    expect(callArgs().sort).toBe("exitTime");
  });

  it("accepts only the whitelisted sort keys", async () => {
    for (const key of ["entryTime", "exitTime", "netPnl", "returnPct", "durationMs", "fees"]) {
      mockQueryTrades.mockClear();
      await GET(new Request(`${base}?sort=${key}`));
      expect(callArgs().sort).toBe(key);
    }
  });

  it("clamps pageSize and rejects negative pages", async () => {
    await GET(new Request(`${base}?pageSize=100000&page=-5`));
    expect(callArgs().opts).toEqual({ page: 0, pageSize: 200 });
  });

  it("returns the whole filtered set when all=1 (CSV export)", async () => {
    mockQueryTrades.mockResolvedValue({ trades: [{ id: "t1" }, { id: "t2" }], total: 2 });
    const res = await GET(new Request(`${base}?all=1`));
    expect(callArgs().opts).toEqual({ all: true });
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.pageSize).toBe(2); // вся выборка = одна «страница»
  });

  it("includes the ticker list only when withMeta=1", async () => {
    const plain = await (await GET(new Request(base))).json();
    expect(plain.symbols).toBeUndefined();
    expect(mockQuerySymbols).not.toHaveBeenCalled();

    const withMeta = await (await GET(new Request(`${base}?withMeta=1`))).json();
    expect(withMeta.symbols).toEqual(["BTCUSDT"]);
  });

  it("returns 500 when the query layer throws", async () => {
    mockQueryTrades.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(new Request(base));
    expect(res.status).toBe(500);
  });
});
