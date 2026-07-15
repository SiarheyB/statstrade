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
    },
    trade: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    exchangeAccount: {
      update: vi.fn(),
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

    prisma.fill.findMany.mockResolvedValueOnce(mockFills);
    prisma.trade.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.trade.createMany.mockResolvedValueOnce({ count: 1 });
    prisma.exchangeAccount.update.mockResolvedValueOnce({});
    prisma.$transaction.mockImplementation(async (txs) => {
      for (const tx of txs) {
        if (typeof tx === "function") await tx();
        else await tx;
      }
    });

    await rebuildAccountTrades("acc1");

    expect(prisma.fill.findMany).toHaveBeenCalledWith({
      where: { accountId: "acc1" },
      orderBy: { timestamp: "asc" },
      select: expect.any(Object),
    });
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
    prisma.fill.findMany.mockResolvedValueOnce([]);
    prisma.trade.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.trade.createMany.mockResolvedValueOnce({ count: 0 });
    prisma.exchangeAccount.update.mockResolvedValueOnce({});
    prisma.$transaction.mockImplementation(async (txs) => {
      for (const tx of txs) {
        if (typeof tx === "function") await tx();
        else await tx;
      }
    });

    await ensureAccountTrades(accounts);

    // First account (tradesRebuiltAt set) should be skipped - no findMany call for it
    // Second account (null tradesRebuiltAt) should be processed - one findMany call
    expect(prisma.fill.findMany).toHaveBeenCalledTimes(1);
  });
});