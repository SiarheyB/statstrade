/**
 * Тесты для exchanges.ts — покрытие экспортированных функций:
 * createExchange, fetchBalanceUsdt, getPublicExchange, normalizeFill.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Состояние, к которому обращается mock-фабрика ccxt (должно быть доступно
// до выполнения фабрики — поэтому через vi.hoisted).
const shared = vi.hoisted(() => ({
  created: [] as any[],
  nextBalance: { total: {} as Record<string, number> } as any,
}));

// Мокаем ccxt: default-экспорт — это объект, по ключам id биржи лежат
// конструкторы. createExchange/getPublicExchange делают new ccxt[id](cfg),
// поэтому каждый конструктор возвращает экземпляр с нужными методами.
vi.mock("ccxt", () => {
  const makeInstance = (id: string, config: Record<string, unknown>) => {
    const instance: any = {
      __id: id,
      __config: config,
      market: vi.fn().mockReturnValue({ base: "BTC", quote: "USDT", type: "spot" }),
      markets: {} as Record<string, unknown>,
      loadMarkets: vi.fn().mockImplementation(async () => {
        instance.markets = { "BTC/USDT": { base: "BTC", quote: "USDT", type: "spot" } };
      }),
      close: vi.fn().mockResolvedValue(undefined),
      fetchBalance: vi.fn().mockImplementation(async () => shared.nextBalance),
      setSandboxMode: vi.fn(),
      enableDemoTrading: vi.fn(),
    };
    return instance;
  };

  const ctorFor = (id: string) =>
    vi.fn().mockImplementation((config: Record<string, unknown>) => {
      const instance = makeInstance(id, config ?? {});
      shared.created.push(instance);
      return instance;
    });

  return {
    default: {
      binance: ctorFor("binance"),
      bybit: ctorFor("bybit"),
      okx: ctorFor("okx"),
      kraken: ctorFor("kraken"),
    },
  };
});

import {
  normalizeFill,
  createExchange,
  fetchBalanceUsdt,
  getPublicExchange,
} from "@/lib/exchanges";

describe("exchanges - normalizeFill", () => {
  const mockExchange = {
    market: vi.fn().mockReturnValue({ base: "BTC", quote: "USDT", type: "spot" }),
    markets: { "BTC/USDT": { base: "BTC", quote: "USDT", type: "spot" } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes basic trade", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
      cost: "5000",
      fee: { cost: "0.001", currency: "BTC" },
    };
    const result = normalizeFill(mockExchange as any, trade);
    expect(result).not.toBeNull();
    expect(result!.tradeId).toBe("123");
    expect(result!.price).toBe(50000);
    expect(result!.amount).toBe(0.1);
  });

  it("returns null for invalid price", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "NaN",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
    };
    expect(normalizeFill(mockExchange as any, trade)).toBeNull();
  });

  it("returns null for zero amount", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0",
      side: "buy",
      timestamp: Date.now(),
    };
    expect(normalizeFill(mockExchange as any, trade)).toBeNull();
  });

  it("handles swap symbol format", () => {
    const mockSwapExchange = {
      market: vi.fn().mockReturnValue({ base: "BTC", quote: "USDT", type: "swap" }),
      markets: { "BTC/USDT:USDT": { base: "BTC", quote: "USDT", type: "swap" } },
    };
    const trade = {
      id: "123",
      symbol: "BTC/USDT:USDT",
      price: "50000",
      amount: "0.1",
      side: "sell",
      timestamp: Date.now(),
      cost: "5000",
    };
    const result = normalizeFill(mockSwapExchange as any, trade);
    expect(result).not.toBeNull();
    expect(result!.market).toBe("swap");
  });

  it("extracts realized PnL from info", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
      cost: "5000",
      info: { realizedPnl: "100.5" },
    };
    const result = normalizeFill(mockExchange as any, trade);
    expect(result).not.toBeNull();
    expect(result!.realizedPnl).toBe(100.5);
  });

  it("handles missing fee object", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
      cost: "5000",
    };
    const result = normalizeFill(mockExchange as any, trade);
    expect(result).not.toBeNull();
    expect(result!.fee).toBe(0);
    expect(result!.feeCurrency).toBeNull();
  });

  it("calculates cost from price * amount if missing", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
    };
    const result = normalizeFill(mockExchange as any, trade);
    expect(result).not.toBeNull();
    expect(result!.cost).toBe(5000);
  });

  it("parses timestamp from string number", () => {
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.1",
      side: "buy",
      timestamp: "1700000000000",
    };
    const result = normalizeFill(mockExchange as any, trade);
    expect(result).not.toBeNull();
    expect(result!.timestamp.getTime()).toBe(1700000000000);
  });

  it("falls back to parsing symbol when exchange.market throws", () => {
    const mockExchangeThrows = {
      market: vi.fn().mockImplementation(() => { throw new Error("market not found"); }),
      markets: {},
    };
    const trade = {
      id: "123",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
      cost: "5000",
    };
    const result = normalizeFill(mockExchangeThrows as any, trade);
    expect(result).not.toBeNull();
    expect(result!.base).toBe("BTC");
    expect(result!.quote).toBe("USDT");
    expect(result!.market).toBe("spot");
  });
});

describe("exchanges - createExchange", () => {
  beforeEach(() => {
    shared.created.length = 0;
    vi.clearAllMocks();
  });

  it("creates exchange with spot kind and credentials", () => {
    const creds = { apiKey: "key", apiSecret: "secret", passphrase: "pass" };
    const ex = createExchange("binance", creds, "spot", false);
    expect(ex).toBeDefined();
    expect(shared.created.length).toBe(1);
    expect(shared.created[0].__id).toBe("binance");
    expect(shared.created[0].__config.apiKey).toBe("key");
    expect(shared.created[0].__config.secret).toBe("secret");
    expect(shared.created[0].__config.password).toBe("pass");
    expect(shared.created[0].__config.enableRateLimit).toBe(true);
    expect(shared.created[0].__config.options?.defaultType).toBe("spot");
  });

  it("creates exchange with swap kind", () => {
    const creds = { apiKey: "key", apiSecret: "secret" };
    createExchange("bybit", creds, "swap", false);
    expect(shared.created[0].__config.options?.defaultType).toBe("swap");
  });

  it("enables sandbox mode for non-Bybit demo", () => {
    const creds = { apiKey: "key", apiSecret: "secret" };
    createExchange("okx", creds, "spot", true);
    expect(shared.created[0].setSandboxMode).toHaveBeenCalledWith(true);
    expect(shared.created[0].enableDemoTrading).not.toHaveBeenCalled();
  });

  it("enables demo trading for Bybit demo", () => {
    const creds = { apiKey: "key", apiSecret: "secret" };
    createExchange("bybit", creds, "spot", true);
    expect(shared.created[0].enableDemoTrading).toHaveBeenCalledWith(true);
  });

  it("handles undefined passphrase", () => {
    const creds = { apiKey: "key", apiSecret: "secret" };
    createExchange("binance", creds, "spot", false);
    expect(shared.created[0].__config.password).toBeUndefined();
  });
});

describe("exchanges - fetchBalanceUsdt", () => {
  beforeEach(() => {
    shared.created.length = 0;
    shared.nextBalance = { total: {} };
    vi.clearAllMocks();
  });

  it("sums USDT and USDC balances", async () => {
    shared.nextBalance = { total: { USDT: 1000.5, USDC: 500.0, BTC: 1.2 } };
    const creds = { apiKey: "key", apiSecret: "secret" };
    const bal = await fetchBalanceUsdt("binance", creds, "spot", false);
    expect(bal).toBe(1500.5);
    expect(shared.created[0].fetchBalance).toHaveBeenCalled();
    expect(shared.created[0].close).toHaveBeenCalled();
  });

  it("returns 0 when no stablecoins present", async () => {
    shared.nextBalance = { total: { BTC: 1.2, ETH: 5.0 } };
    const creds = { apiKey: "key", apiSecret: "secret" };
    const bal = await fetchBalanceUsdt("binance", creds, "spot", false);
    expect(bal).toBe(0);
  });

  it("returns null on fetchBalance error", async () => {
    shared.nextBalance = Promise.reject(new Error("network error"));
    const creds = { apiKey: "key", apiSecret: "secret" };
    const bal = await fetchBalanceUsdt("binance", creds, "spot", false);
    expect(bal).toBeNull();
    expect(shared.created[0].close).toHaveBeenCalled();
  });

  it("works for swap kind", async () => {
    shared.nextBalance = { total: { USDT: 2000 } };
    const creds = { apiKey: "key", apiSecret: "secret" };
    const bal = await fetchBalanceUsdt("bybit", creds, "swap", false);
    expect(bal).toBe(2000);
  });

  it("handles empty totals object", async () => {
    shared.nextBalance = { total: {} };
    const creds = { apiKey: "key", apiSecret: "secret" };
    const bal = await fetchBalanceUsdt("binance", creds, "spot", false);
    expect(bal).toBe(0);
  });
});

describe("exchanges - getPublicExchange", () => {
  beforeEach(() => {
    shared.created.length = 0;
    shared.nextBalance = { total: {} };
    vi.clearAllMocks();
  });

  it("returns an Exchange instance", async () => {
    const ex = await getPublicExchange("binance", "spot");
    expect(ex).toBeDefined();
    expect(typeof ex).toBe("object");
    expect(ex.market).toBeInstanceOf(Function);
    expect(ex.fetchBalance).toBeInstanceOf(Function);
    expect(ex.close).toBeInstanceOf(Function);
  });

  it("uses enableRateLimit: true and correct defaultType in options", async () => {
    const exBinance = await getPublicExchange("binance", "spot");
    expect((exBinance as any).__config.enableRateLimit).toBe(true);
    expect((exBinance as any).__config.options?.defaultType).toBe("spot");

    const exBybit = await getPublicExchange("bybit", "swap");
    expect((exBybit as any).__config.enableRateLimit).toBe(true);
    expect((exBybit as any).__config.options?.defaultType).toBe("swap");
  });

  it("loads markets if not already loaded", async () => {
    const ex1 = await getPublicExchange("okx", "spot");
    expect(ex1.loadMarkets).toHaveBeenCalled();
    expect(ex1.markets).toEqual({ "BTC/USDT": { base: "BTC", quote: "USDT", type: "spot" } });

    const ex2 = await getPublicExchange("okx", "spot");
    expect(ex2).toBeDefined();
  });

  it("handles exchange and kind parameters correctly", async () => {
    const exBinance = await getPublicExchange("binance", "spot");
    expect((exBinance as any).__id).toBe("binance");
    expect((exBinance as any).__config.options?.defaultType).toBe("spot");

    const exBybit = await getPublicExchange("bybit", "swap");
    expect((exBybit as any).__id).toBe("bybit");
    expect((exBybit as any).__config.options?.defaultType).toBe("swap");
  });
});
