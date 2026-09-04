import { describe, it, expect } from "vitest";
import { calculateFees, calculateRealizedPnl, calculateUnrealizedPnl, settleClose } from "@/engine/economy/pnlCalculator";
import type { Position } from "@/engine/entities/types";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    assetId: "STK_TEST",
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: Date.now(),
    fees: 0,
    style: "day",
    ...overrides,
  };
}

describe("calculateFees", () => {
  it("считает комиссию с обеих сторон сделки плюс спред-косты (раздел 4.1)", () => {
    // (100*10 + 110*10) * 0.0008 + 5 = 2100*0.0008 + 5 = 1.68 + 5 = 6.68
    expect(calculateFees(100, 110, 10, 0.0008, 5)).toBeCloseTo(6.68, 5);
  });
});

describe("calculateRealizedPnl", () => {
  it("long: (close - entry) * size * leverage - fees", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, leverage: 1, fees: 2 });
    // (110-100)*10*1 - 2 = 98
    expect(calculateRealizedPnl(pos, 110)).toBeCloseTo(98, 5);
  });

  it("short: (entry - close) * size * leverage - fees", () => {
    const pos = makePosition({ side: "short", entryPrice: 100, size: 10, leverage: 1, fees: 2 });
    // (100-110)*10*1 - 2 = -102 (цена выросла — шорт в убытке)
    expect(calculateRealizedPnl(pos, 110)).toBeCloseTo(-102, 5);
  });

  it("плечо масштабирует PnL пропорционально (готовность к Фазе 2)", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, leverage: 5, fees: 0 });
    expect(calculateRealizedPnl(pos, 110)).toBeCloseTo((110 - 100) * 10 * 5, 5);
  });
});

describe("calculateUnrealizedPnl", () => {
  it("совпадает с realized-расчётом на той же цене (симметрия формул)", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, leverage: 2, fees: 3 });
    expect(calculateUnrealizedPnl(pos, 120)).toBe(calculateRealizedPnl(pos, 120));
  });
});

describe("settleClose", () => {
  it("сам считает fees по entry+exit (position.fees при открытии всегда 0 — формула 4.1 знает closePrice только в момент закрытия)", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, fees: 0 });
    const { fees, realizedPnl } = settleClose(pos, 110, 0.0008, 0);
    expect(fees).toBeCloseTo((100 * 10 + 110 * 10) * 0.0008, 5);
    expect(realizedPnl).toBeCloseTo((110 - 100) * 10 - fees, 5);
  });

  it("игнорирует любое ранее выставленное position.fees — не складывает старое со свежерасчитанным", () => {
    const pos = makePosition({ entryPrice: 100, size: 10, fees: 999 });
    const { realizedPnl } = settleClose(pos, 100, 0, 0);
    expect(realizedPnl).toBe(0); // без движения цены и без комиссии — PnL ровно 0
  });
});
