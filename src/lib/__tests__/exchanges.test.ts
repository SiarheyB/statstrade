/**
 * Тесты для normalizeFill из exchanges.ts.
 * Проверяем:
 *   • корректный парсинг количеств с разными десятичными знаками
 *   • нормализацию цены (предотвращение NaN от невалидных цен)
 *   • валидацию формата временной метки (ISO строка vs число)
 *   • типизацию опциональных полей сделки (fee, makerFee, realisedPnl)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeFill, type NormalizedFill } from "../exchanges";

// Замокаем ccxt чтобы не тянуть тяжелые криптографические зависимости
vi.mock("ccxt", () => ({
  default: {
    // пустой объект, так как нам не нужны реальные экземпляры
  },
}));

type MockExchange = {
  markets: Record<string, { id: string; symbol: string; base: string; quote: string; type: string }>;
  market: (symbol: string) => { base: string; quote: string; type: string };
  loadMarkets: () => Promise<void>;
  close: () => Promise<void>;
};

function createMockExchange(): MockExchange {
  const markets = {
    "BTC/USDT": { id: "BTC/USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", type: "spot" },
    "BTC/USDT:USDT": { id: "BTC/USDT:USDT", symbol: "BTC/USDT:USDT", base: "BTC", quote: "USDT", type: "swap" },
    "ETH/USDT": { id: "ETH/USDT", symbol: "ETH/USDT", base: "ETH", quote: "USDT", type: "spot" },
  };

  return {
    markets,
    market: (symbol: string) => markets[symbol] ?? { base: "", quote: "", type: "spot" },
    loadMarkets: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("normalizeFill", () => {
  let mockExchange: MockExchange;

  beforeEach(() => {
    mockExchange = createMockExchange();
  });

  // --------------------------------------------------------------------------
  // 1. Корректный парсинг количеств с разными десятичными знаками
  // --------------------------------------------------------------------------
  it("парсит количество 0.001 (3 знака после запятой)", () => {
    const trade = {
      id: "trade-1",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0.001",
      side: "buy",
      timestamp: Date.now(),
      cost: "50",
      fee: { cost: "0.0001", currency: "BTC" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(0.001);
    expect(result!.cost).toBe(50);
    expect(result!.fee).toBe(0.0001);
  });

  it("парсит количество 1.5 (1 знак после запятой)", () => {
    const trade = {
      id: "trade-2",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1.5",
      side: "sell",
      timestamp: Date.now(),
      cost: "75000",
      fee: { cost: "0.015", currency: "USDT" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1.5);
    expect(result!.cost).toBe(75000);
    expect(result!.fee).toBe(0.015);
  });

  it("парсит количество 100.0 (целое число с .0)", () => {
    const trade = {
      id: "trade-3",
      symbol: "ETH/USDT",
      price: "3000",
      amount: "100.0",
      side: "buy",
      timestamp: Date.now(),
      cost: "300000",
      fee: { cost: "3", currency: "USDT" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(100);
    expect(result!.cost).toBe(300000);
    expect(result!.fee).toBe(3);
  });

  it("парсит очень маленькое количество (научная нотация)", () => {
    const trade = {
      id: "trade-4",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1e-8",
      side: "buy",
      timestamp: Date.now(),
      cost: "0.0005",
      fee: { cost: "1e-10", currency: "BTC" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1e-8);
    expect(result!.cost).toBe(0.0005);
  });

  // --------------------------------------------------------------------------
  // 2. Нормализация цены (предотвращение NaN от невалидных цен)
  // --------------------------------------------------------------------------
  it("возвращает null при price = NaN", () => {
    const trade = {
      id: "trade-5",
      symbol: "BTC/USDT",
      price: "not-a-number",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  it("возвращает null при price = Infinity", () => {
    const trade = {
      id: "trade-6",
      symbol: "BTC/USDT",
      price: "Infinity",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  it("возвращает null при price = null", () => {
    const trade = {
      id: "trade-7",
      symbol: "BTC/USDT",
      price: null,
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  it("возвращает null при price = undefined", () => {
    const trade = {
      id: "trade-8",
      symbol: "BTC/USDT",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  it("корректно обрабатывает валидную цену как строку", () => {
    const trade = {
      id: "trade-9",
      symbol: "BTC/USDT",
      price: "50000.12345678",
      amount: "0.1",
      side: "buy",
      timestamp: Date.now(),
      cost: "5000.012345678",
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.price).toBe(50000.12345678);
    expect(Number.isFinite(result!.price)).toBe(true);
  });

  it("возвращает null при amount = 0", () => {
    const trade = {
      id: "trade-10",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "0",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  it("возвращает null при amount = NaN", () => {
    const trade = {
      id: "trade-11",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "not-a-number",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  it("возвращает null при отсутствующем symbol", () => {
    const trade = {
      id: "trade-12",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);
    expect(result).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 3. Валидация формата временной метки (ISO строка vs число)
  // --------------------------------------------------------------------------
  it("парсит timestamp как число (мс)", () => {
    const ts = Date.now();
    const trade = {
      id: "trade-13",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: ts,
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeInstanceOf(Date);
    expect(result!.timestamp.getTime()).toBe(ts);
  });

  it("парсит timestamp как ISO-строку", () => {
    const iso = "2024-01-15T12:30:45.123Z";
    const trade = {
      id: "trade-14",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: iso,
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeInstanceOf(Date);
    expect(result!.timestamp.toISOString()).toBe(iso);
  });

  it("фоллбэк на текущее время при отсутствующем timestamp", () => {
    const before = Date.now();
    const trade = {
      id: "trade-15",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
    };

    const result = normalizeFill(mockExchange as any, trade);
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeInstanceOf(Date);
    expect(result!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  // --------------------------------------------------------------------------
  // 4. Типизация опциональных полей (fee, makerFee, realisedPnl, orderId)
  // --------------------------------------------------------------------------
  it("извлекает fee.cost и fee.currency", () => {
    const trade = {
      id: "trade-16",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
      fee: { cost: "0.001", currency: "BTC" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.fee).toBe(0.001);
    expect(result!.feeCurrency).toBe("BTC");
  });

  it("устанавливает fee = 0 и feeCurrency = null при отсутствии fee", () => {
    const trade = {
      id: "trade-17",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.fee).toBe(0);
    expect(result!.feeCurrency).toBeNull();
  });

  it("обрабатывает fee с cost = undefined", () => {
    const trade = {
      id: "trade-18",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
      fee: { currency: "USDT" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.fee).toBe(0);
    expect(result!.feeCurrency).toBe("USDT");
  });

  it("извлекает orderId как строку", () => {
    const trade = {
      id: "trade-19",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
      order: "order-12345",
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.orderId).toBe("order-12345");
  });

  it("устанавливает orderId = null при отсутствии order", () => {
    const trade = {
      id: "trade-20",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.orderId).toBeNull();
  });

  it("извлекает realisedPnl из info", () => {
    const trade = {
      id: "trade-21",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
      info: { realizedPnl: "10.5" },
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.realizedPnl).toBe(10.5);
  });

  it("извлекает realisedPnl из альтернативных полей info", () => {
    const testCases = [
      { key: "realisedPnl", value: "5.25" },
      { key: "execPnl", value: "3.75" },
      { key: "closedPnl", value: "-2.5" },
      { key: "fillPnl", value: "0.1" },
      { key: "pnl", value: "100" },
    ];

    for (const { key, value } of testCases) {
      const trade = {
        id: `trade-${key}`,
        symbol: "BTC/USDT",
        price: "50000",
        amount: "1",
        side: "buy",
        timestamp: Date.now(),
        info: { [key]: value },
      };

      const result = normalizeFill(mockExchange as any, trade);
      expect(result).not.toBeNull();
      expect(result!.realizedPnl).toBe(Number(value));
    }
  });

  it("устанавливает realisedPnl = null при отсутствии info или невалидных данных", () => {
    const trade = {
      id: "trade-22",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.realizedPnl).toBeNull();
  });

  it("извлекает takerOrMaker", () => {
    const trade = {
      id: "trade-23",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
      takerOrMaker: "taker",
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.takerOrMaker).toBe("taker");
  });

  // --------------------------------------------------------------------------
  // 5. Определение market/base/quote через ccxt market()
  // --------------------------------------------------------------------------
  it("определяет market=spot для спотового символа", () => {
    const trade = {
      id: "trade-24",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.market).toBe("spot");
    expect(result!.base).toBe("BTC");
    expect(result!.quote).toBe("USDT");
  });

  it("определяет market=swap для фьючерсного символа (с двоеточием)", () => {
    const trade = {
      id: "trade-25",
      symbol: "BTC/USDT:USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.market).toBe("swap");
    expect(result!.base).toBe("BTC");
    expect(result!.quote).toBe("USDT");
  });

  it("фоллбэк парсинг символа если market() бросает ошибку", () => {
    const brokenExchange = createMockExchange();
    brokenExchange.market = () => { throw new Error("market not loaded"); };

    const trade = {
      id: "trade-26",
      symbol: "ETH/USDT",
      price: "3000",
      amount: "10",
      side: "sell",
      timestamp: Date.now(),
    };

    const result = normalizeFill(brokenExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.base).toBe("ETH");
    expect(result!.quote).toBe("USDT");
    expect(result!.market).toBe("spot");
  });

  it("генерирует tradeId при отсутствии id в сделке", () => {
    const trade = {
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "buy",
      timestamp: 1700000000000,
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.tradeId).toContain("BTC/USDT");
    expect(result!.tradeId).toContain("1700000000000");
    expect(result!.tradeId).toContain("buy");
  });

  // --------------------------------------------------------------------------
  // 6. Вычисление cost при отсутствии в исходных данных
  // --------------------------------------------------------------------------
  it("вычисляет cost = price * amount если cost отсутствует", () => {
    const trade = {
      id: "trade-27",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "2",
      side: "buy",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.cost).toBe(100000);
  });

  it("использует предоставленный cost если он валиден", () => {
    const trade = {
      id: "trade-28",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "2",
      side: "buy",
      timestamp: Date.now(),
      cost: "99999",
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.cost).toBe(99999);
  });

  it("фоллбэк на price * amount если cost = NaN", () => {
    const trade = {
      id: "trade-29",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "2",
      side: "buy",
      timestamp: Date.now(),
      cost: "not-a-number",
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.cost).toBe(100000);
  });

  // --------------------------------------------------------------------------
  // 7. Side нормализация
  // --------------------------------------------------------------------------
  it("нормализует side к строке", () => {
    const trade = {
      id: "trade-30",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      side: "SELL",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.side).toBe("SELL");
  });

  it("фоллбэк на 'buy' при отсутствующем side", () => {
    const trade = {
      id: "trade-31",
      symbol: "BTC/USDT",
      price: "50000",
      amount: "1",
      timestamp: Date.now(),
    };

    const result = normalizeFill(mockExchange as any, trade);

    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
  });
});