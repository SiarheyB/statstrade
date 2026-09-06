import { describe, it, expect } from "vitest";
import {
  calculateRequiredMargin,
  calculateLiquidationPrice,
  calculateLiquidationPenalty,
  calculateMarginLevel,
  checkLiquidation,
  DEFAULT_MAINTENANCE_MARGIN_RATE,
} from "@/engine/economy/marginEngine";
import type { Position } from "@/engine/entities/types";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    assetId: "STK_TEST",
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 10,
    openedAt: Date.now(),
    fees: 0,
    style: "day",
    ...overrides,
  };
}

describe("calculateRequiredMargin", () => {
  it("= entryPrice*size/leverage", () => {
    expect(calculateRequiredMargin(100, 10, 10)).toBeCloseTo(100, 5);
  });

  it("при leverage=1 вырождается в полный номинал (совместимость с Фазой 1)", () => {
    expect(calculateRequiredMargin(100, 10, 1)).toBe(1000);
  });
});

describe("calculateLiquidationPrice", () => {
  it("long: entryPrice*(1 - 1/leverage + maintenanceMarginRate)", () => {
    // 100 * (1 - 1/10 + 0.005) = 100 * 0.905 = 90.5
    expect(calculateLiquidationPrice(100, 10, "long")).toBeCloseTo(90.5, 5);
  });

  it("short: entryPrice*(1 + 1/leverage - maintenanceMarginRate)", () => {
    // 100 * (1 + 1/10 - 0.005) = 100 * 1.095 = 109.5
    expect(calculateLiquidationPrice(100, 10, "short")).toBeCloseTo(109.5, 5);
  });

  it("принимает произвольный maintenanceMarginRate вместо дефолта", () => {
    expect(calculateLiquidationPrice(100, 10, "long", 0.01)).toBeCloseTo(91, 5);
  });

  it("при leverage=1 long почти не бывает ликвидации (цена должна уйти почти в ноль)", () => {
    // 100 * (1 - 1 + 0.005) = 0.5 — реалистичный шаг цены такого не даёт.
    expect(calculateLiquidationPrice(100, 1, "long")).toBeCloseTo(0.5, 5);
  });
});

describe("checkLiquidation", () => {
  it("long: срабатывает ровно на ликвидационной цене (±1 тик)", () => {
    const pos = makePosition({ side: "long", entryPrice: 100, leverage: 10 }); // liq ≈ 90.5
    const liq = calculateLiquidationPrice(100, 10, "long");
    expect(checkLiquidation(pos, liq)).toBe(true);
    expect(checkLiquidation(pos, liq + 0.01)).toBe(false);
    expect(checkLiquidation(pos, liq - 0.01)).toBe(true);
  });

  it("short: срабатывает ровно на ликвидационной цене (±1 тик)", () => {
    // Сверяем с фактически вычисленной ценой (не с 109.5 руками) — 100*(1.1-0.005)
    // в плавающей точке даёт 109.49999999999999, а не ровно 109.5.
    const pos = makePosition({ side: "short", entryPrice: 100, leverage: 10 });
    const liq = calculateLiquidationPrice(100, 10, "short");
    expect(checkLiquidation(pos, liq)).toBe(true);
    expect(checkLiquidation(pos, liq - 0.01)).toBe(false);
    expect(checkLiquidation(pos, liq + 0.01)).toBe(true);
  });

  it("не срабатывает, пока цена не дошла до ликвидационного уровня", () => {
    const pos = makePosition({ side: "long", entryPrice: 100, leverage: 10 });
    expect(checkLiquidation(pos, 95)).toBe(false);
  });
});

describe("calculateMarginLevel", () => {
  it("= equity/marginUsed*100", () => {
    expect(calculateMarginLevel(1000, 500)).toBe(200);
  });

  it("возвращает Infinity, если маржа не используется (нет открытых позиций с плечом)", () => {
    expect(calculateMarginLevel(1000, 0)).toBe(Infinity);
  });
});

describe("calculateLiquidationPenalty", () => {
  it("= 1% от номинала позиции", () => {
    expect(calculateLiquidationPenalty(100, 10)).toBeCloseTo(10, 5); // 1000 * 0.01
  });
});

describe("DEFAULT_MAINTENANCE_MARGIN_RATE", () => {
  it("равен 0.5% (раздел 4.2)", () => {
    expect(DEFAULT_MAINTENANCE_MARGIN_RATE).toBe(0.005);
  });
});
