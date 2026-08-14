import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/calendar/route";

const base = "https://example.com/api/calendar";
const range = "from=2026-03-01T00:00:00Z&to=2026-04-05T00:00:00Z";

// Час с ненулевыми суммами; поля повторяют select в роуте.
function hour(iso: string, over: Record<string, unknown> = {}) {
  return {
    hour: new Date(iso),
    netPnl: 0, wins: 0, losses: 0, winR: 0, lossR: 0, trades: 0, rTrades: 0,
    ...over,
  };
}

describe("GET /api/calendar", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([]);
    mockPrisma.tradeHourly.findMany.mockResolvedValue([]);
    mockPrisma.tradeHourly.aggregate.mockResolvedValue({ _max: { hour: null } });
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?${range}`));
    expect(res.status).toBe(401);
  });

  it("requires a from/to range", async () => {
    asUser();
    expect((await GET(new Request(base))).status).toBe(400);
    expect((await GET(new Request(`${base}?from=nonsense&to=also`))).status).toBe(400);
  });

  it("rejects an inverted or oversized range", async () => {
    asUser();
    const inverted = `from=2026-04-01T00:00:00Z&to=2026-03-01T00:00:00Z`;
    expect((await GET(new Request(`${base}?${inverted}`))).status).toBe(400);
    // Сетка календаря — максимум 6 недель; годовой запрос вытянул бы всю историю.
    const wide = `from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z`;
    expect((await GET(new Request(`${base}?${wide}`))).status).toBe(400);
  });

  it("returns empty days when the user has no accounts", async () => {
    asUser();
    const res = await GET(new Request(`${base}?${range}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ days: [], accounts: [], latest: null });
    expect(mockPrisma.tradeHourly.findMany).not.toHaveBeenCalled();
  });

  it("buckets hourly rows into local days using tzOffset", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit" },
    ]);
    mockPrisma.tradeHourly.findMany.mockResolvedValue([
      hour("2026-03-02T10:00:00Z", { netPnl: -100, losses: 1, trades: 1, lossR: -1, rTrades: 1 }),
      // 22:00Z второго марта для UTC+3 — это уже третье марта.
      hour("2026-03-02T22:00:00Z", { netPnl: -50, losses: 1, trades: 1, lossR: -0.5, rTrades: 1 }),
      hour("2026-03-03T01:00:00Z", { netPnl: 200, wins: 1, trades: 1, winR: 2, rTrades: 1 }),
    ]);

    const utc = await (await GET(new Request(`${base}?${range}&tzOffset=0`))).json();
    expect(utc.days.map((d: { date: string }) => d.date)).toEqual(["2026-03-02", "2026-03-03"]);
    expect(utc.days[0].netPnl).toBe(-150);

    const plus3 = await (await GET(new Request(`${base}?${range}&tzOffset=180`))).json();
    expect(plus3.days.map((d: { date: string }) => d.date)).toEqual(["2026-03-02", "2026-03-03"]);
    expect(plus3.days[0].netPnl).toBe(-100);
    expect(plus3.days[1].netPnl).toBe(150);
    expect(plus3.days[1].winR).toBe(2);
    expect(plus3.days[1].lossR).toBe(-0.5);
    expect(plus3.days[1].rTrades).toBe(2);
  });

  it("scopes the query to the requested account, ignoring foreign ids", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit" },
      { id: "acc-2", label: "Second", exchange: "binance" },
    ]);

    await GET(new Request(`${base}?${range}&accountId=acc-2`));
    expect(mockPrisma.tradeHourly.findMany.mock.calls[0][0].where.accountId).toEqual({ in: ["acc-2"] });

    mockPrisma.tradeHourly.findMany.mockClear();
    // Чужой id не должен расширять или подменять выборку — падаем на все свои.
    await GET(new Request(`${base}?${range}&accountId=someone-else`));
    expect(mockPrisma.tradeHourly.findMany.mock.calls[0][0].where.accountId).toEqual({
      in: ["acc-1", "acc-2"],
    });
  });

  it("filters by the requested window", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit" },
    ]);
    await GET(new Request(`${base}?${range}`));
    const where = mockPrisma.tradeHourly.findMany.mock.calls[0][0].where;
    expect((where.hour.gte as Date).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect((where.hour.lt as Date).toISOString()).toBe("2026-04-05T00:00:00.000Z");
  });

  it("reports the latest trading day in the caller timezone", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([
      { id: "acc-1", label: "Main", exchange: "bybit" },
    ]);
    mockPrisma.tradeHourly.aggregate.mockResolvedValue({
      _max: { hour: new Date("2026-03-02T22:00:00Z") },
    });

    const utc = await (await GET(new Request(`${base}?${range}&tzOffset=0`))).json();
    expect(utc.latest).toBe("2026-03-02");
    const plus3 = await (await GET(new Request(`${base}?${range}&tzOffset=180`))).json();
    expect(plus3.latest).toBe("2026-03-03");
  });

  it("returns 500 when prisma fails", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockRejectedValueOnce(new Error("DB error"));
    const res = await GET(new Request(`${base}?${range}`));
    expect(res.status).toBe(500);
  });
});
