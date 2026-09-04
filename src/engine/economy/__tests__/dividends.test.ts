import { describe, it, expect } from "vitest";
import { calculateDividendPayment, processQuarterlyDividends, PAYMENTS_PER_YEAR } from "@/engine/economy/dividends";
import type { Account, Asset, Position } from "@/engine/entities/types";

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "STK_TEST",
    symbol: "TEST",
    name: "Test Co",
    assetClass: "stock",
    correlationGroup: "tech_stocks",
    baseVolatility: 0.2,
    baseDrift: 0.05,
    tickSize: 0.01,
    tradingHours: "session",
    dividendYield: 0.04,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "player",
    balance: 10000,
    equity: 10000,
    positions: [],
    pendingOrders: [],
    marginUsed: 0,
    marginLevel: Infinity,
    psychology: { stress: 0, confidence: 50, discipline: 0, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
    skills: {},
    reputation: 0,
    licenses: [],
    journal: [],
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    assetId: "STK_TEST",
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: 0,
    fees: 0,
    style: "investing",
    ...overrides,
  };
}

describe("calculateDividendPayment", () => {
  it("= holdingSize * currentPrice * (dividendYield / paymentsPerYear)", () => {
    // 10 * 100 * (0.04/4) = 10
    expect(calculateDividendPayment(10, 100, 0.04, 4)).toBeCloseTo(10, 5);
  });

  it("по умолчанию PAYMENTS_PER_YEAR=4 (квартал)", () => {
    expect(calculateDividendPayment(10, 100, 0.04)).toBeCloseTo(calculateDividendPayment(10, 100, 0.04, PAYMENTS_PER_YEAR), 10);
  });
});

describe("processQuarterlyDividends", () => {
  it("платит по открытым long-позициям с dividendYield и добавляет на баланс", () => {
    const account = makeAccount({ positions: [makePosition({ size: 10 })] });
    const paid = processQuarterlyDividends(account, [makeAsset()], { STK_TEST: 100 });
    expect(paid).toBeCloseTo(10, 5); // 10*100*(0.04/4)
    expect(account.balance).toBeCloseTo(10010, 5);
  });

  it("НЕ платит по short-позициям", () => {
    const account = makeAccount({ positions: [makePosition({ side: "short", size: 10 })] });
    const paid = processQuarterlyDividends(account, [makeAsset()], { STK_TEST: 100 });
    expect(paid).toBe(0);
    expect(account.balance).toBe(10000);
  });

  it("НЕ платит по закрытым позициям", () => {
    const account = makeAccount({ positions: [makePosition({ closedAt: Date.now() })] });
    const paid = processQuarterlyDividends(account, [makeAsset()], { STK_TEST: 100 });
    expect(paid).toBe(0);
  });

  it("НЕ платит по активам без dividendYield", () => {
    const account = makeAccount({ positions: [makePosition()] });
    const paid = processQuarterlyDividends(account, [makeAsset({ dividendYield: undefined })], { STK_TEST: 100 });
    expect(paid).toBe(0);
  });

  it("суммирует несколько открытых позиций по одному активу (докупка) в один holdingSize", () => {
    const account = makeAccount({
      positions: [makePosition({ id: "p1", size: 10 }), makePosition({ id: "p2", size: 5, entryPrice: 105 })],
    });
    const paid = processQuarterlyDividends(account, [makeAsset()], { STK_TEST: 100 });
    // (10+5)*100*(0.04/4) = 15
    expect(paid).toBeCloseTo(15, 5);
  });

  it("платит отдельно по каждому активу с холдингом", () => {
    const account = makeAccount({
      positions: [
        makePosition({ id: "p1", assetId: "A", size: 10 }),
        makePosition({ id: "p2", assetId: "B", size: 4 }),
      ],
    });
    const assets = [makeAsset({ id: "A", dividendYield: 0.04 }), makeAsset({ id: "B", dividendYield: 0.08 })];
    const paid = processQuarterlyDividends(account, assets, { A: 100, B: 50 });
    // A: 10*100*0.01=10; B: 4*50*0.02=4 → 14
    expect(paid).toBeCloseTo(14, 5);
  });
});
