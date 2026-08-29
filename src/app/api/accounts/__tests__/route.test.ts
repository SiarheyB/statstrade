import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/exchanges", () => ({
  SUPPORTED_EXCHANGES: { binance: { needsPassphrase: false } },
  isExchangeId: vi.fn(() => true),
}));
vi.mock("@/lib/statsCache", () => ({ bumpStatsVersion: vi.fn() }));
vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskSecret: (s: string) => s.slice(0, 2) + "***",
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
  mockExchangeToggle,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/accounts/route";

const base = "https://example.com/api/accounts";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findMany.mockReset();
  mockPrisma.exchangeAccount.create.mockReset();
  mockExchangeToggle.isExchangeEnabled.mockReset();
  mockExchangeToggle.isExchangeEnabled.mockResolvedValue(true);
  mockPrisma.fill.groupBy.mockReset().mockResolvedValue([]);
  mockPrisma.importedTrade.groupBy.mockReset().mockResolvedValue([]);
});

const account = (over: Record<string, unknown> = {}) => ({
  id: "a1", exchange: "binance", label: "Main", source: "exchange",
  accountCurrency: null, marketType: "spot", demoTrading: false,
  balance: null, capital: null, apiKey: null, lastSyncAt: null,
  syncStatus: "idle", syncError: null, syncPhase: null, syncCursor: 0,
  syncTotal: 0, syncImported: 0, fullSyncAt: null, autoSync: true,
  syncIntervalMinutes: 60, createdAt: new Date(), ...over,
});

describe("GET /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns accounts for user", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([account()]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe("a1");
  });

  it("не тянет секреты и план синка — только то, что уезжает в ответ", async () => {
    // Без select Prisma тащила ВСЕ колонки: зашифрованные apiSecret и
    // passphrase (наружу они не отдаются) и syncPlan — JSON со списком всех
    // торговых пар, десятки килобайт на полном скане. И так на каждом опросе.
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([account()]);
    await GET(new Request(base));
    const select = mockPrisma.exchangeAccount.findMany.mock.calls[0][0].select;
    expect(select).toBeDefined();
    expect(select.apiSecret).toBeUndefined();
    expect(select.passphrase).toBeUndefined();
    expect(select.syncPlan).toBeUndefined();
    expect(select.apiKey).toBe(true); // нужен для маски
  });

  it("без ?counts=1 счётчики не считаются вовсе", async () => {
    // Это два COUNT по таблицам филлов и импортированных сделок. Показывает их
    // одна страница «Счета», а роут дёргают восемь мест — SyncProvider раз в
    // минуту с любой страницы кабинета.
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([account()]);
    const res = await GET(new Request(base));
    const body = await res.json();
    expect(mockPrisma.fill.groupBy).not.toHaveBeenCalled();
    expect(mockPrisma.importedTrade.groupBy).not.toHaveBeenCalled();
    // Форма ответа при этом не меняется.
    expect(body[0].fillCount).toBe(0);
    expect(body[0].importedCount).toBe(0);
  });

  it("с ?counts=1 счётчики приходят одним групповым запросом на все счета", async () => {
    asUser();
    mockPrisma.exchangeAccount.findMany.mockResolvedValue([account(), account({ id: "a2" })]);
    mockPrisma.fill.groupBy.mockResolvedValue([{ accountId: "a1", _count: { _all: 7 } }]);
    mockPrisma.importedTrade.groupBy.mockResolvedValue([{ accountId: "a2", _count: { _all: 3 } }]);
    const res = await GET(new Request(`${base}?counts=1`));
    const body = await res.json();
    expect(mockPrisma.fill.groupBy).toHaveBeenCalledTimes(1);
    expect(mockPrisma.importedTrade.groupBy).toHaveBeenCalledTimes(1);
    expect(body[0].fillCount).toBe(7);
    expect(body[0].importedCount).toBe(0);
    expect(body[1].fillCount).toBe(0);
    expect(body[1].importedCount).toBe(3);
  });
});

describe("POST /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "binance", label: "Main", apiKey: "k", apiSecret: "s" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when exchange disabled", async () => {
    asUser();
    mockExchangeToggle.isExchangeEnabled.mockResolvedValueOnce(false);
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "binance", label: "Main", apiKey: "k", apiSecret: "s" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates an exchange account", async () => {
    asUser();
    mockPrisma.exchangeAccount.create.mockResolvedValue({ id: "a1" });
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "binance", label: "Main", apiKey: "k", apiSecret: "s" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("a1");
  });

  it("creates an mt4 account without keys", async () => {
    asUser();
    mockPrisma.exchangeAccount.create.mockResolvedValue({ id: "m1" });
    const res = await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ exchange: "mt4", source: "mt4", label: "MT4", accountCurrency: "USD" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("m1");
  });
});
