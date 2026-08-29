import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { rebuildTradeGroups, rebuildAccountTrades, ensureAccountTrades } from "../materialize";
import type { TradeGroup } from "../materialize";

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    fill: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      // Полная пересборка идёт по группам (пара + рынок), а не одной выборкой
      // всех филлов счёта — см. rebuildAccountTrades.
      groupBy: vi.fn().mockResolvedValue([]),
    },
    trade: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    exchangeAccount: {
      update: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    riskProfile: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    importedTrade: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    tradeAnnotation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (txs: any[]) => {
      // Execute all transactions
      for (const tx of txs) {
        if (typeof tx === "function") await tx();
        else await tx;
      }
    }),
  };
  return {
    prisma: mockPrisma,
  };
});

describe("materialize functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockGroups: TradeGroup[] = [
    { symbol: "BTCUSDT", market: "spot" },
    { symbol: "ETHUSDT", market: "spot" },
  ];

  it("rebuildTradeGroups correctly groups fills and rebuilds trades", async () => {
    // Mock fills response
    const mockFills = [
      {
        id: "fill1",
        accountId: "acc1",
        symbol: "BTC/USDT",
        market: "spot",
        price: 100,
        amount: 1,
        side: "buy",
        timestamp: new Date().getTime(),
        exchange: "binance",
        takerOrMaker: "taker",
        base: "BTC",
        quote: "USDT",
        fee: 0.001,
        feeCurrency: "BTC",
        realizedPnl: null,
      },
    ] as any;

    prisma.fill.findMany.mockResolvedValueOnce(mockFills);
    prisma.trade.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.trade.createMany.mockResolvedValueOnce({ count: 1 });
    prisma.exchangeAccount.update.mockResolvedValueOnce({});
    prisma.$transaction.mockImplementation(async (txs) => {
      for (const tx of txs) {
        if (typeof tx === "function") await tx();
        else await tx;
      }
    });

    await rebuildTradeGroups("acc1", mockGroups);

    expect(prisma.fill.findMany).toHaveBeenCalledWith({
      where: {
        accountId: "acc1",
        OR: [
          { symbol: "BTCUSDT", market: "spot" },
          { symbol: "ETHUSDT", market: "spot" },
        ],
      },
      orderBy: { timestamp: "asc" },
      select: expect.any(Object),
    });
  });

  it("rebuildAccountTrades correctly rebuilds all trades for an account", async () => {
    const mockFills = [
      {
        id: "fill1",
        accountId: "acc1",
        symbol: "BTC/USDT",
        market: "spot",
        price: 100,
        amount: 1,
        side: "buy",
        timestamp: new Date().getTime(),
        exchange: "binance",
        takerOrMaker: "taker",
        base: "BTC",
        quote: "USDT",
        fee: 0.001,
        feeCurrency: "BTC",
        realizedPnl: null,
      },
    ] as any;

    prisma.fill.groupBy.mockResolvedValueOnce([{ symbol: "BTC/USDT", market: "spot" }]);
    prisma.fill.findMany.mockResolvedValueOnce(mockFills);
    prisma.trade.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.trade.createMany.mockResolvedValueOnce({ count: 1 });
    prisma.exchangeAccount.update.mockResolvedValueOnce({});

    await rebuildAccountTrades("acc1");

    // Филлы читаются ПО ОДНОЙ группе: раньше сюда поднимались все филлы счёта
    // разом — сотни тысяч строк в куче Node внутри HTTP-запроса.
    expect(prisma.fill.findMany).toHaveBeenCalledWith({
      where: { accountId: "acc1", symbol: "BTC/USDT", market: "spot" },
      orderBy: { timestamp: "asc" },
      select: expect.any(Object),
    });
    // Старые строки счёта сносятся целиком — иначе у группы, где филлов уже
    // не осталось (откат импорта), повисли бы прежние сделки.
    expect(prisma.trade.deleteMany).toHaveBeenCalledWith({ where: { accountId: "acc1" } });
  });

  it("rebuildAccountTrades держит в памяти одну группу за раз", async () => {
    prisma.fill.groupBy.mockResolvedValueOnce([
      { symbol: "BTC/USDT", market: "spot" },
      { symbol: "ETH/USDT", market: "swap" },
    ]);
    prisma.fill.findMany.mockResolvedValue([]);
    prisma.trade.deleteMany.mockResolvedValue({ count: 0 });
    prisma.exchangeAccount.update.mockResolvedValue({});

    await rebuildAccountTrades("acc1");

    expect(prisma.fill.findMany).toHaveBeenCalledTimes(2);
    const wheres = prisma.fill.findMany.mock.calls.map((c: any) => c[0].where);
    expect(wheres).toEqual([
      { accountId: "acc1", symbol: "BTC/USDT", market: "spot" },
      { accountId: "acc1", symbol: "ETH/USDT", market: "swap" },
    ]);
    // Пересчёт RR — один на счёт, а не на каждую группу.
    expect(prisma.exchangeAccount.update).toHaveBeenCalledTimes(1);
  });

  it("ensureAccountTrades skips accounts that are already rebuilt", async () => {
    const accounts = [
      {
        id: "acc1",
        tradesRebuiltAt: new Date(),
      } as any,
      {
        id: "acc2",
        tradesRebuiltAt: null,
      } as any,
    ];

    // Mock for the second account
    prisma.fill.groupBy.mockResolvedValue([]);
    prisma.trade.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.exchangeAccount.update.mockResolvedValueOnce({});

    await ensureAccountTrades(accounts);

    // Первый счёт (tradesRebuiltAt проставлен) пропускается, второй — нет.
    expect(prisma.fill.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.fill.groupBy).toHaveBeenCalledWith({
      by: ["symbol", "market"],
      where: { accountId: "acc2" },
    });
  });
});